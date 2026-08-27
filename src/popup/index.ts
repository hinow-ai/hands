/**
 * Painel da extensão: liga/desliga e ajusta o que muda de pessoa para pessoa.
 *
 * Os três controles expostos são justamente os que dependem do corpo e do
 * espaço de quem usa — distância da câmera, tremor da mão e tolerância a
 * velocidade. O resto dos parâmetros tem um bom valor único e só faria ruído
 * aqui.
 */

import { CameraStatus, DEFAULT_TUNING, RuntimeMessage, TuningConfig } from '../core/wire'

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

const STATUS_TEXT: Record<CameraStatus, string> = {
  off: 'Desligado',
  starting: 'Iniciando a câmera…',
  running: 'Ativo — mostre a mão',
  denied: 'Permissão de câmera negada',
  error: 'Erro na câmera',
}

function paintState(enabled: boolean, status: CameraStatus, error?: string): void {
  toggleBtn.textContent = enabled ? 'Desativar' : 'Ativar'
  toggleBtn.classList.toggle('on', enabled && status === 'running')

  statusEl.textContent = error ?? STATUS_TEXT[status] ?? 'Desligado'
  statusEl.classList.toggle('on', status === 'running')
  statusEl.classList.toggle('err', status === 'denied' || status === 'error')
}

function paintTuning(t: TuningConfig): void {
  areaInput.value = String(Math.round(t.activeWidth * 100))
  areaVal.textContent = `${Math.round(t.activeWidth * 100)}%`

  // O controle de estabilidade mostra o valor real do corte do filtro; o slider
  // trabalha em centésimos para ter uma resolução utilizável.
  smoothInput.value = String(Math.round(t.minCutoff * 100))
  smoothVal.textContent = t.minCutoff.toFixed(2)

  scrollInput.value = String(Math.round(t.scrollGain * 10))
  scrollVal.textContent = `${t.scrollGain.toFixed(1)}×`

  hudInput.checked = t.showHud
}

function pushConfig(config: Partial<TuningConfig>): void {
  chrome.runtime.sendMessage({ type: 'GN_SET_CONFIG', config } satisfies RuntimeMessage)
}

toggleBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'GN_TOGGLE' } satisfies RuntimeMessage)
})

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

hudInput.addEventListener('change', () => {
  pushConfig({ showHud: hudInput.checked })
})

chrome.runtime.onMessage.addListener((message: RuntimeMessage) => {
  if (message?.type === 'GN_STATE') {
    paintState(message.enabled, message.cameraStatus, message.error)
  }
  return false
})

async function init(): Promise<void> {
  const stored = await chrome.storage.local.get('tuning')
  paintTuning({ ...DEFAULT_TUNING, ...(stored.tuning ?? {}) })

  chrome.runtime.sendMessage({ type: 'GN_QUERY_STATE' } satisfies RuntimeMessage, (response) => {
    if (chrome.runtime.lastError || !response) {
      paintState(false, 'off')
      return
    }
    paintState(response.enabled, response.cameraStatus, response.error)
  })
}

void init()
