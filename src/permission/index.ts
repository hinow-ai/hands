/**
 * Aba de concessão da câmera.
 *
 * Um documento offscreen não tem interface, e o Chrome não exibe a caixa de
 * permissão para um contexto sem interface: `getUserMedia` lá dentro falha
 * direto com `NotAllowedError` enquanto a origem da extensão não tiver a
 * permissão já registrada. Como a permissão é gravada por origem, basta pedi-la
 * uma vez de dentro de uma página visível da própria extensão — esta — e o
 * offscreen passa a abrir a câmera sem prompt nenhum, em qualquer site.
 *
 * O stream é encerrado no mesmo instante em que chega: aqui só interessa o
 * efeito colateral de registrar a permissão, e manter a webcam presa numa aba
 * esquecida acenderia o LED sem motivo.
 *
 * É também a primeira tela do produto para muita gente — daí seguir a mesma
 * identidade e o mesmo tema do painel, e dizer o que acontece com a imagem
 * antes de pedir o acesso.
 */

import { DEFAULT_TUNING, RuntimeMessage, TuningConfig } from '../core/wire'

/** Texto na língua do navegador; cai no inglês quando não há tradução. */
const t = (key: string): string => chrome.i18n.getMessage(key) || key

const grantBtn = document.getElementById('grant') as HTMLButtonElement
const msgEl = document.getElementById('msg') as HTMLDivElement
const blockedHelp = document.getElementById('blockedHelp') as HTMLDivElement

/** Onde o Chrome guarda a lista de sites bloqueados para a câmera. */
const CAMERA_SETTINGS = 'chrome://settings/content/camera'

function translateStatic(): void {
  document.documentElement.lang = chrome.i18n.getUILanguage?.() ?? 'en'

  for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-i18n]'))) {
    el.textContent = t(el.dataset.i18n as string)
  }
  // Só para as poucas mensagens com ênfase no meio da frase. O HTML vem dos
  // nossos próprios arquivos de tradução, empacotados na extensão — não há
  // entrada de terceiro passando por aqui.
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-i18n-html]'))) {
    el.innerHTML = t(el.dataset.i18nHtml as string)
  }

  // O endereço das configurações não é um link: `chrome://` não pode ser
  // aberto por clique de uma página. Fica como texto para copiar.
  const code = document.createElement('code')
  code.textContent = CAMERA_SETTINGS
  blockedHelp.replaceChildren(t('permBlockedBefore'), code, t('permBlockedAfter'))
}

/** A tela segue o tema escolhido no painel; sem nada gravado, o padrão. */
async function applyTheme(): Promise<void> {
  try {
    const stored = await chrome.storage.local.get('tuning')
    const tuning: TuningConfig = { ...DEFAULT_TUNING, ...(stored.tuning ?? {}) }
    document.documentElement.dataset.theme = tuning.theme
  } catch {
    document.documentElement.dataset.theme = DEFAULT_TUNING.theme
  }
}

function say(text: string, kind: 'ok' | 'err'): void {
  msgEl.textContent = text
  msgEl.className = `msg ${kind}`
  msgEl.hidden = false
}

/** Avisa o service worker e sai de cena; a extensão religa sozinha. */
function finish(): void {
  chrome.runtime.sendMessage({ type: 'GN_PERMISSION_GRANTED' } satisfies RuntimeMessage).catch(() => {})
  say(t('permGranted'), 'ok')
  grantBtn.disabled = true
  setTimeout(() => window.close(), 1800)
}

async function request(): Promise<void> {
  grantBtn.disabled = true
  blockedHelp.hidden = true

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
    for (const track of stream.getTracks()) track.stop()
    finish()
  } catch (err) {
    const name = (err as Error)?.name
    grantBtn.disabled = false

    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
      say(t('permDenied'), 'err')
      blockedHelp.hidden = false
    } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      say(t('permNoCamera'), 'err')
    } else if (name === 'NotReadableError') {
      // Driver ocupado: outro programa (ou outra aba) está com a webcam presa.
      say(t('permBusy'), 'err')
    } else {
      say((err as Error)?.message ?? t('permFail'), 'err')
    }
  }
}

grantBtn.addEventListener('click', () => void request())

/**
 * Se a permissão já estiver concedida, não há nada a pedir — o caso comum de
 * reabrir esta aba depois de uma falha passageira da câmera.
 */
async function checkExisting(): Promise<void> {
  try {
    const status = await navigator.permissions.query({
      name: 'camera' as PermissionName,
    })
    if (status.state === 'granted') finish()
    else if (status.state === 'denied') blockedHelp.hidden = false
  } catch {
    // Nem todo navegador expõe 'camera' no Permissions API; o botão cobre.
  }
}

translateStatic()
void applyTheme()
void checkExisting()
