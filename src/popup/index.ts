/**
 * Painel da extensão: liga/desliga, ensina o vocabulário e ajusta o que muda
 * de pessoa para pessoa.
 *
 * A lista de gestos é MONTADA a partir de `COMMANDS_*`, não escrita à mão no
 * HTML. É a mesma fonte que alimenta as instruções na tela, então as duas não
 * têm como divergir — e o modo canhoto só precisa trocar a ordem das colunas.
 */

import {
  COMMANDS_ACTION,
  COMMANDS_BOTH,
  COMMANDS_SCROLL,
  CommandEntry,
} from '../core/gestures'
import { CameraStatus, DEFAULT_TUNING, RuntimeMessage, ThemeMode, TuningConfig } from '../core/wire'

/**
 * Texto na língua do navegador. `chrome.i18n` escolhe a pasta de `_locales`
 * pelo idioma da interface do Chrome e cai no `default_locale` (inglês) quando
 * não há tradução — nada a detectar nem a persistir do nosso lado.
 */
const t = (key: string, ...args: string[]): string => chrome.i18n.getMessage(key, args) || key

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T

const toggleBtn = $<HTMLButtonElement>('toggle')
const statusEl = $<HTMLDivElement>('status')
const areaInput = $<HTMLInputElement>('area')
const areaVal = $<HTMLElement>('areaVal')
const smoothInput = $<HTMLInputElement>('smooth')
const smoothVal = $<HTMLElement>('smoothVal')
const scrollInput = $<HTMLInputElement>('scroll')
const scrollVal = $<HTMLElement>('scrollVal')
const hudInput = $<HTMLInputElement>('hud')
const guideInput = $<HTMLInputElement>('guide')
const tipsInput = $<HTMLInputElement>('tips')
const leftyInput = $<HTMLInputElement>('lefty')
const themeSeg = $<HTMLDivElement>('themeSeg')
const grantBox = $<HTMLDivElement>('grantBox')
const grantBtn = $<HTMLButtonElement>('grant')
const capLeft = $<HTMLElement>('capLeft')
const capRight = $<HTMLElement>('capRight')
const colLeft = $<HTMLElement>('colLeft')
const colRight = $<HTMLElement>('colRight')
const footer = $<HTMLElement>('footer')
const infoBtn = $<HTMLButtonElement>('info')
const about = $<HTMLDivElement>('about')
const aboutClose = $<HTMLButtonElement>('aboutClose')
const versionEl = $<HTMLElement>('version')

const STATUS_KEY: Record<CameraStatus, string> = {
  off: 'statusOff',
  starting: 'statusStarting',
  running: 'statusRunning',
  denied: 'statusDenied',
  error: 'statusError',
}

/** Preenche todo texto marcado com `data-i18n` no HTML. */
function translateStatic(): void {
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-i18n]'))) {
    el.textContent = t(el.dataset.i18n as string)
  }
  document.documentElement.lang = chrome.i18n.getUILanguage?.() ?? 'en'
  // O atalho vai como <kbd>, então o texto é montado em volta de um marcador.
  // O marcador precisa ser um caractere que não apareça em tradução nenhuma —
  // dividir por espaço quebraria a frase inteira em palavras.
  const MARK = '\u2400'
  const [before, after] = t('footer', MARK).split(MARK)
  const kbd = document.createElement('kbd')
  kbd.textContent = 'Alt+Shift+G'
  footer.replaceChildren(before ?? '', kbd, after ?? '')

  infoBtn.title = t('infoButton')
  infoBtn.setAttribute('aria-label', t('infoButton'))

  // No cabeçalho o seletor de tema não tem rótulo visível ao lado: o nome vem
  // por atributo, para quem navega por leitor de tela não achar dois botões
  // soltos escritos "Claro" e "Escuro".
  themeSeg.title = t('setAppearance')
  themeSeg.setAttribute('aria-label', t('setAppearance'))

  // `version_name` é o número que a pessoa cita ao relatar um problema, e ele
  // vem do manifest para não haver duas versões a manter em sincronia.
  const manifest = chrome.runtime.getManifest() as chrome.runtime.Manifest & { version_name?: string }
  versionEl.textContent = `${t('aboutBeta')} · ${manifest.version_name ?? manifest.version}`
}

/** Um cartão de gesto: desenho da mão, o que faz e a pose que o forma. */
function card(entry: CommandEntry, duo?: CommandEntry): HTMLElement {
  const row = document.createElement('div')
  row.className = 'row'

  const icons = duo ? [duo, entry] : [entry]
  const art = icons
    .map((e) => `<div class="ico${e.flip ? ' flip' : ''}" style="-webkit-mask-image:url('img/hand-${e.art}.png');mask-image:url('img/hand-${e.art}.png')"></div>`)
    .join('')

  row.innerHTML = `
    ${duo ? `<div class="duo">${art}</div>` : art}
    <div class="txt"><strong>${t(entry.action)}</strong><span>${t(entry.fingers)}</span></div>
  `
  return row
}

/**
 * Monta as duas colunas de gestos.
 *
 * A coluna da esquerda descreve sempre a mão ESQUERDA — quem lê "mão esquerda"
 * na coluna da direita hesita antes de cada gesto. O que o modo canhoto troca
 * é o PAPEL de cada coluna, não o lado de que ela fala.
 */
function renderCommands(leftHanded: boolean): void {
  const leftRole = leftHanded ? 'roleAction' : 'roleScroll'
  const rightRole = leftHanded ? 'roleScroll' : 'roleAction'
  capLeft.textContent = `${t('handLeft')}: ${t(leftRole)}`
  capRight.textContent = `${t('handRight')}: ${t(rightRole)}`

  const leftCmds = leftHanded ? COMMANDS_ACTION : COMMANDS_SCROLL
  const rightCmds = leftHanded ? COMMANDS_SCROLL : COMMANDS_ACTION

  // A troca de página fecha cada coluna, do lado para onde ela leva: voltar à
  // esquerda, avançar à direita — as mesmas setas do navegador. Embaixo, numa
  // faixa própria, o gesto perdia essa correspondência com a direção.
  const confirm = COMMANDS_SCROLL[0]
  const back = COMMANDS_BOTH.find((c) => c.id === 'page_prev')!
  const forward = COMMANDS_BOTH.find((c) => c.id === 'page_next')!

  const cap = () => {
    const el = document.createElement('div')
    el.className = 'cap gap'
    el.textContent = t('bothHands')
    return el
  }

  colLeft.replaceChildren(...leftCmds.map((e) => card(e)), cap(), card(back, confirm))
  colRight.replaceChildren(...rightCmds.map((e) => card(e)), cap(), card(forward, confirm))
}

function paintState(enabled: boolean, status: CameraStatus, error?: string): void {
  toggleBtn.textContent = t(enabled ? 'btnDeactivate' : 'btnActivate')
  toggleBtn.classList.toggle('on', enabled && status === 'running')

  statusEl.textContent = error ?? t(STATUS_KEY[status] ?? 'statusOff')
  statusEl.classList.toggle('on', status === 'running')
  statusEl.classList.toggle('err', status === 'denied' || status === 'error')

  // O caminho de saída da câmera negada é conceder a permissão numa aba visível;
  // oferecê-lo aqui evita que o estado vire um beco sem saída.
  grantBox.hidden = status !== 'denied'
}

grantBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'GN_REQUEST_PERMISSION' } satisfies RuntimeMessage)
  window.close()
})

/** Acende a opção escolhida num segmentado. */
function paintSeg(seg: HTMLElement, value: string): void {
  for (const button of Array.from(seg.querySelectorAll('button'))) {
    button.classList.toggle('on', button.dataset.value === value)
  }
}

function paintTuning(t2: TuningConfig): void {
  // O tema do próprio painel é aplicado na raiz do documento: as variáveis de
  // cor vivem lá, e todo o resto do CSS as segue.
  document.documentElement.dataset.theme = t2.theme
  paintSeg(themeSeg, t2.theme)

  areaInput.value = String(Math.round(t2.activeWidth * 100))
  areaVal.textContent = `${Math.round(t2.activeWidth * 100)}%`

  // O controle de estabilidade mostra o valor real do corte do filtro; o slider
  // trabalha em centésimos para ter uma resolução utilizável.
  smoothInput.value = String(Math.round(t2.minCutoff * 100))
  smoothVal.textContent = t2.minCutoff.toFixed(2)

  scrollInput.value = String(Math.round(t2.scrollGain * 10))
  scrollVal.textContent = `${t2.scrollGain.toFixed(1)}×`

  hudInput.checked = t2.showHud
  guideInput.checked = t2.showGuide
  tipsInput.checked = t2.showTips
  leftyInput.checked = t2.leftHanded
}

/** O que está valendo agora — base para pintar de novo após cada mudança. */
let current: TuningConfig = { ...DEFAULT_TUNING }

function pushConfig(config: Partial<TuningConfig>): void {
  current = { ...current, ...config }
  chrome.runtime.sendMessage({ type: 'GN_SET_CONFIG', config } satisfies RuntimeMessage)
}

toggleBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'GN_TOGGLE' } satisfies RuntimeMessage)
})

infoBtn.addEventListener('click', () => {
  about.hidden = false
})
aboutClose.addEventListener('click', () => {
  about.hidden = true
})
// Clicar fora da folha fecha, como em qualquer modal; Esc também, porque o
// popup não tem barra de título para se fechar de outro jeito.
about.addEventListener('click', (event) => {
  if (event.target === about) about.hidden = true
})
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !about.hidden) about.hidden = true
})

/** Liga um segmentado a um campo de tema. */
function wireSeg(seg: HTMLElement, apply: (value: ThemeMode) => void): void {
  seg.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest('button')
    const value = button?.dataset.value
    if (value !== 'light' && value !== 'dark') return
    apply(value)
    paintTuning(current)
  })
}

wireSeg(themeSeg, (theme) => pushConfig({ theme }))

areaInput.addEventListener('input', () => {
  const pct = Number(areaInput.value) / 100
  areaVal.textContent = `${areaInput.value}%`
  // A altura acompanha a largura numa proporção fixa: o quadro da webcam é mais
  // largo que alto, e o alcance vertical confortável do braço é menor.
  pushConfig({ activeWidth: pct, activeHeight: pct * 0.9 })
})

smoothInput.addEventListener('input', () => {
  const cutoff = Number(smoothInput.value) / 100
  smoothVal.textContent = cutoff.toFixed(2)
  pushConfig({ minCutoff: cutoff })
})

scrollInput.addEventListener('input', () => {
  const gain = Number(scrollInput.value) / 10
  scrollVal.textContent = `${gain.toFixed(1)}×`
  pushConfig({ scrollGain: gain })
})

hudInput.addEventListener('change', () => pushConfig({ showHud: hudInput.checked }))
tipsInput.addEventListener('change', () => pushConfig({ showTips: tipsInput.checked }))

guideInput.addEventListener('change', () => pushConfig({ showGuide: guideInput.checked }))

leftyInput.addEventListener('change', () => {
  pushConfig({ leftHanded: leftyInput.checked })
  renderCommands(leftyInput.checked)
})

chrome.runtime.onMessage.addListener((message: RuntimeMessage) => {
  if (message?.type === 'GN_STATE') {
    paintState(message.enabled, message.cameraStatus, message.error)
  }
  return false
})

async function init(): Promise<void> {
  translateStatic()

  const stored = await chrome.storage.local.get('tuning')
  current = { ...DEFAULT_TUNING, ...(stored.tuning ?? {}) }
  paintTuning(current)
  renderCommands(current.leftHanded)
  paintState(false, 'off')

  chrome.runtime.sendMessage({ type: 'GN_QUERY_STATE' } satisfies RuntimeMessage, (response) => {
    if (chrome.runtime.lastError || !response) {
      paintState(false, 'off')
      return
    }
    paintState(response.enabled, response.cameraStatus, response.error)
  })
}

void init()
