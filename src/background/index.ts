/**
 * Service worker: coordena o ciclo de vida e roteia os gestos.
 *
 * O documento offscreen produz gestos sem saber para onde eles vão; o content
 * script age sem saber de onde vêm. Este módulo é a única peça que conhece as
 * duas pontas — e a única que pode criar o documento offscreen, consultar qual
 * aba está ativa e reagir ao clique no ícone da extensão.
 *
 * A aba ativa fica em cache. Consultar `chrome.tabs.query` a cada frame seria
 * uma chamada de IPC trinta vezes por segundo só para descobrir algo que muda
 * uma vez a cada vários segundos.
 */

import { CameraStatus, DEFAULT_TUNING, RuntimeMessage, TuningConfig } from '../core/wire'

const OFFSCREEN_PATH = 'offscreen.html'

let enabled = false
let cameraStatus: CameraStatus = 'off'
let cameraError: string | undefined
let activeTabId: number | null = null

/** Páginas onde content scripts não podem ser injetados. */
function isRestrictedUrl(url: string | undefined): boolean {
  if (!url) return true
  return (
    url.startsWith('chrome://') ||
    url.startsWith('chrome-extension://') ||
    url.startsWith('edge://') ||
    url.startsWith('about:') ||
    url.startsWith('devtools://') ||
    url.startsWith('https://chrome.google.com/webstore') ||
    url.startsWith('https://chromewebstore.google.com')
  )
}

async function refreshActiveTab(): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
    activeTabId = tab && !isRestrictedUrl(tab.url) ? (tab.id ?? null) : null
  } catch {
    activeTabId = null
  }
}

// ------------------------------------------------------------ offscreen

async function hasOffscreen(): Promise<boolean> {
  // getContexts é a forma suportada de checar; algumas versões antigas não a
  // possuem, e nesse caso tentar criar e tratar o erro é o caminho.
  if (chrome.runtime.getContexts) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType],
    })
    return contexts.length > 0
  }
  return false
}

async function ensureOffscreen(): Promise<void> {
  if (await hasOffscreen()) return
  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_PATH,
      reasons: ['USER_MEDIA' as chrome.offscreen.Reason],
      justification: 'Captura da webcam para reconhecimento de gestos de mão.',
    })
  } catch (err) {
    // Uma corrida entre dois pedidos simultâneos cai aqui; se o documento já
    // existe, seguir em frente é o comportamento correto.
    if (!String(err).includes('Only a single offscreen')) throw err
  }
}

async function closeOffscreen(): Promise<void> {
  if (await hasOffscreen()) {
    await chrome.offscreen.closeDocument().catch(() => {})
  }
}

// ------------------------------------------------------------ estado

async function getTuning(): Promise<TuningConfig> {
  const stored = await chrome.storage.local.get('tuning')
  return { ...DEFAULT_TUNING, ...(stored.tuning ?? {}) }
}

function broadcastState(): void {
  const message: RuntimeMessage = {
    type: 'GN_STATE',
    enabled,
    cameraStatus,
    error: cameraError,
  }
  // O popup pode não estar aberto; a falha de entrega é esperada.
  chrome.runtime.sendMessage(message).catch(() => {})
  updateBadge()
}

function updateBadge(): void {
  const on = enabled && cameraStatus === 'running'
  chrome.action.setBadgeText({ text: on ? 'ON' : '' }).catch(() => {})
  chrome.action.setBadgeBackgroundColor({ color: on ? '#22c55e' : '#64748b' }).catch(() => {})
}

async function enable(): Promise<void> {
  if (enabled) return
  enabled = true
  cameraError = undefined

  await ensureOffscreen()
  await refreshActiveTab()

  chrome.runtime.sendMessage({ type: 'GN_START_CAMERA' } satisfies RuntimeMessage).catch(() => {})

  const tuning = await getTuning()
  if (activeTabId !== null) {
    chrome.tabs
      .sendMessage(activeTabId, { type: 'GN_ENABLE' } satisfies RuntimeMessage)
      .catch(() => {})
    chrome.tabs
      .sendMessage(activeTabId, { type: 'GN_SET_CONFIG', config: tuning } satisfies RuntimeMessage)
      .catch(() => {})
  }
  broadcastState()
}

async function disable(): Promise<void> {
  if (!enabled) return
  enabled = false

  chrome.runtime.sendMessage({ type: 'GN_STOP_CAMERA' } satisfies RuntimeMessage).catch(() => {})
  await closeOffscreen()

  if (activeTabId !== null) {
    chrome.tabs
      .sendMessage(activeTabId, { type: 'GN_DISABLE' } satisfies RuntimeMessage)
      .catch(() => {})
  }
  cameraStatus = 'off'
  broadcastState()
}

// ------------------------------------------------------------ eventos

chrome.action.onClicked.addListener(() => {
  void (enabled ? disable() : enable())
})

chrome.commands?.onCommand.addListener((command) => {
  if (command === 'toggle-gesture-nav') {
    void (enabled ? disable() : enable())
  }
})

chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
  switch (message?.type) {
    case 'GN_FRAME': {
      // Caminho quente: roda 30 vezes por segundo. Nada de await aqui.
      if (enabled && activeTabId !== null) {
        chrome.tabs.sendMessage(activeTabId, message, { frameId: 0 }).catch(() => {
          // Aba sem content script (navegou para uma página restrita, ou ainda
          // está carregando). Ignorar é melhor que desligar tudo.
        })
      }
      return false
    }

    case 'GN_CAMERA_STATUS': {
      cameraStatus = message.status
      cameraError = message.error
      // A câmera negada torna a extensão inútil; desligar evita deixar o
      // usuário com o badge aceso sem nada funcionando.
      if (message.status === 'denied' || message.status === 'error') {
        enabled = false
        void closeOffscreen()
      }
      broadcastState()
      return false
    }

    case 'GN_TOGGLE': {
      void (enabled ? disable() : enable())
      return false
    }

    case 'GN_ENABLE': {
      void enable()
      return false
    }

    case 'GN_DISABLE': {
      void disable()
      return false
    }

    case 'GN_QUERY_STATE': {
      sendResponse({ type: 'GN_STATE', enabled, cameraStatus, error: cameraError })
      return true
    }

    case 'GN_SET_CONFIG': {
      void (async () => {
        const tuning = { ...(await getTuning()), ...message.config }
        await chrome.storage.local.set({ tuning })
        if (activeTabId !== null) {
          chrome.tabs
            .sendMessage(activeTabId, {
              type: 'GN_SET_CONFIG',
              config: tuning,
            } satisfies RuntimeMessage)
            .catch(() => {})
        }
      })()
      return false
    }

    default:
      return false
  }
})

/**
 * Ao trocar de aba, a anterior precisa parar de receber gestos e limpar o
 * overlay — senão fica um cursor congelado na página que ficou para trás.
 */
async function handleTabChange(): Promise<void> {
  const previous = activeTabId
  await refreshActiveTab()
  if (previous === activeTabId) return

  if (previous !== null) {
    chrome.tabs
      .sendMessage(previous, { type: 'GN_DISABLE' } satisfies RuntimeMessage)
      .catch(() => {})
  }
  if (enabled && activeTabId !== null) {
    const tuning = await getTuning()
    chrome.tabs
      .sendMessage(activeTabId, { type: 'GN_ENABLE' } satisfies RuntimeMessage)
      .catch(() => {})
    chrome.tabs
      .sendMessage(activeTabId, { type: 'GN_SET_CONFIG', config: tuning } satisfies RuntimeMessage)
      .catch(() => {})
  }
}

chrome.tabs.onActivated.addListener(() => void handleTabChange())
chrome.windows.onFocusChanged.addListener(() => void handleTabChange())

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  // Uma navegação recria o content script, que sobe desligado; se a extensão
  // está ativa, precisa ser religada na nova página.
  if (changeInfo.status === 'complete' && enabled && tabId === activeTabId) {
    void (async () => {
      const tuning = await getTuning()
      chrome.tabs.sendMessage(tabId, { type: 'GN_ENABLE' } satisfies RuntimeMessage).catch(() => {})
      chrome.tabs
        .sendMessage(tabId, { type: 'GN_SET_CONFIG', config: tuning } satisfies RuntimeMessage)
        .catch(() => {})
    })()
  }
})

chrome.runtime.onStartup.addListener(() => {
  enabled = false
  cameraStatus = 'off'
  updateBadge()
})

void refreshActiveTab()
updateBadge()
