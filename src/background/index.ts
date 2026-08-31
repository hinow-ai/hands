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
const PERMISSION_PATH = 'permission.html'

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

// ------------------------------------------------------------ permissão

/**
 * Abre a aba que pede acesso à câmera.
 *
 * O documento offscreen não tem interface, e o Chrome não mostra a caixa de
 * permissão para um contexto que não pode exibi-la — de lá, `getUserMedia`
 * volta negado sem nunca perguntar nada. A permissão é gravada por origem, então
 * pedi-la numa página visível da extensão resolve para todos os sites de uma vez.
 *
 * Reaproveitamos uma aba já aberta: sem isso, cada tentativa de ativar com a
 * câmera bloqueada empilharia mais uma.
 */
async function openPermissionTab(): Promise<void> {
  const url = chrome.runtime.getURL(PERMISSION_PATH)
  try {
    const [existing] = await chrome.tabs.query({ url })
    if (existing?.id !== undefined) {
      await chrome.tabs.update(existing.id, { active: true })
      if (existing.windowId !== undefined) {
        await chrome.windows.update(existing.windowId, { focused: true }).catch(() => {})
      }
      return
    }
  } catch {
    // A consulta pode falhar sem a permissão de tabs para a própria origem;
    // criar uma aba nova é a saída boa o bastante.
  }
  await chrome.tabs.create({ url }).catch(() => {})
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

/**
 * Garante que a aba tenha o content script antes de receber comandos.
 *
 * Uma mensagem enviada a uma aba sem content script simplesmente se perde. Em
 * vez de confiar que a injeção declarativa já ocorreu — o que não vale para
 * abas abertas antes da instalação —, sondamos e injetamos se necessário. A
 * marca de inicialização do lado do content script torna a injeção extra
 * inofensiva, então errar para o lado de injetar é seguro.
 */
async function ensureInjected(tabId: number): Promise<void> {
  try {
    const reply = await chrome.tabs.sendMessage(tabId, { type: 'GN_PING' } satisfies RuntimeMessage)
    if (reply?.present) return
  } catch {
    // Envio rejeitado: não há content script nesta aba.
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ['content.js'],
    })
  } catch {
    // Página protegida pelo navegador; nada a fazer.
  }
}

/** Liga uma aba: injeta se preciso, ativa e envia os ajustes atuais. */
async function activateTab(tabId: number): Promise<void> {
  await ensureInjected(tabId)
  const tuning = await getTuning()
  chrome.tabs.sendMessage(tabId, { type: 'GN_ENABLE' } satisfies RuntimeMessage).catch(() => {})
  chrome.tabs
    .sendMessage(tabId, { type: 'GN_SET_CONFIG', config: tuning } satisfies RuntimeMessage)
    .catch(() => {})
}

async function enable(): Promise<void> {
  if (enabled) return
  enabled = true
  cameraError = undefined

  await ensureOffscreen()
  await refreshActiveTab()

  chrome.runtime.sendMessage({ type: 'GN_START_CAMERA' } satisfies RuntimeMessage).catch(() => {})

  if (activeTabId !== null) await activateTab(activeTabId)
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
      // Negado quase sempre significa que a origem da extensão nunca recebeu a
      // permissão — o offscreen não consegue pedi-la. A aba de concessão é o
      // único caminho, então abri-la é a resposta útil, não uma mensagem de erro.
      if (message.status === 'denied') void openPermissionTab()
      broadcastState()
      return false
    }

    case 'GN_OFFSCREEN_READY': {
      // Chega depois de um `enable()` que já mandou iniciar cedo demais, e
      // também quando o documento é recriado por conta própria. Reenviar o
      // comando é inofensivo: iniciar duas vezes só reafirma o status.
      if (enabled) {
        chrome.runtime
          .sendMessage({ type: 'GN_START_CAMERA' } satisfies RuntimeMessage)
          .catch(() => {})
      }
      return false
    }

    case 'GN_REQUEST_PERMISSION': {
      void openPermissionTab()
      return false
    }

    case 'GN_PERMISSION_GRANTED': {
      // A origem foi liberada; a ativação que falhou agora tem como completar.
      cameraStatus = 'off'
      cameraError = undefined
      void enable()
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
    await activateTab(activeTabId)
  }
}

chrome.tabs.onActivated.addListener(() => void handleTabChange())
chrome.windows.onFocusChanged.addListener(() => void handleTabChange())

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  // Uma navegação recria o content script, que sobe desligado; se a extensão
  // está ativa, precisa ser religada na nova página.
  if (changeInfo.status === 'complete' && enabled && tabId === activeTabId) {
    void activateTab(tabId)
  }
})

/**
 * Injeta o content script nas abas que já estavam abertas.
 *
 * Content scripts declarados no manifest só entram em páginas carregadas
 * DEPOIS que a extensão foi instalada ou recarregada. Sem esta injeção
 * retroativa, toda aba já aberta fica sem o script até um F5 manual — e o
 * sintoma, de fora, é indistinguível de "a extensão não funciona neste site".
 */
async function injectIntoExistingTabs(): Promise<void> {
  let tabs: chrome.tabs.Tab[]
  try {
    tabs = await chrome.tabs.query({})
  } catch {
    return
  }

  await Promise.all(
    tabs.map(async (tab) => {
      if (tab.id === undefined || isRestrictedUrl(tab.url)) return
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id, allFrames: true },
          files: ['content.js'],
        })
      } catch {
        // Páginas que o Chrome protege recusam a injeção mesmo passando pelo
        // filtro de URL — por exemplo, uma aba exibindo um PDF ou um erro de
        // rede. Não há o que fazer, e falhar uma aba não pode abortar as outras.
      }
    }),
  )
}

chrome.runtime.onInstalled.addListener(() => {
  void injectIntoExistingTabs()
})

chrome.runtime.onStartup.addListener(() => {
  enabled = false
  cameraStatus = 'off'
  updateBadge()
})

void refreshActiveTab()
updateBadge()
