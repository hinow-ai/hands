/**
 * Máquina de estados que traduz gestos em interação com a página.
 *
 * O vocabulário é UM comando: **mão aberta rola a página para baixo**. Punho
 * fechado — ou a mão fora do quadro — para. Nada mais age na página.
 *
 * Por que encolher para um: o vocabulário anterior exigia uma conjunção de
 * condições simultâneas (mão esquerda presente E aberta, direita apontando com
 * três dedos no estado certo, direção do dedo passando dois limiares, tudo
 * estável por 3 frames cada). Cada condição acertava a maioria dos frames; o
 * produto de todas falhava com frequência, e qualquer frame ruim zerava os
 * contadores de estabilidade. Um comando formado pelo par de poses mais
 * separável que o rastreador conhece — aberta contra punho — não tem o que
 * confundir: é o degrau de 100% sobre o qual os próximos comandos voltam,
 * um a um.
 *
 * A mão de comando é a direita quando o modelo a rotula assim, mas qualquer
 * mão detectada serve: o rótulo esquerda/direita do rastreador erra com
 * frequência, e com um só comando no vocabulário não há ambiguidade a
 * resolver — condicionar ao rótulo só reintroduziria a falha dele.
 */

import { CommandId } from '../core/gestures'
import { FrameSnapshot, HandSnapshot, TuningConfig } from '../core/wire'
import { PointerMapper } from '../core/pointer'
import { Overlay } from './overlay'
import { deepElementFromPoint, synthScroll } from './synth'
import { sendToFrame, toFrameCoords } from './frames'

/**
 * Velocidade base da rolagem, em pixels por segundo, antes do ganho do popup.
 * Com o ganho padrão dá cerca de 900 px/s: percorre uma tela em pouco mais de
 * um segundo, que é rápido o bastante para não cansar e lento o bastante para
 * a pessoa conseguir parar onde quer.
 */
const SCROLL_PX_PER_SEC = 340

export interface ControllerOptions {
  onStatus?: (text: string) => void
}

export class GestureController {
  private overlay = new Overlay()
  private pointer = new PointerMapper()

  private cursorX = 0
  private cursorY = 0
  private lastLoopTime = 0

  private enabled = false
  private lastFrame: FrameSnapshot | null = null
  private rafHandle = 0
  private scrollGain = 2.6

  constructor(private options: ControllerOptions = {}) {}

  enable(): void {
    if (this.enabled) return
    this.enabled = true
    this.overlay.attach()
    this.overlay.setHudVisible(true)
    this.overlay.setHud('Procurando a mão', 'Levante uma mão em frente à câmera')
    this.loop()
  }

  disable(): void {
    if (!this.enabled) return
    this.enabled = false
    cancelAnimationFrame(this.rafHandle)
    this.overlay.detach()
    this.pointer.reset()
  }

  get isEnabled(): boolean {
    return this.enabled
  }

  /**
   * A mão que comanda. Preferimos o rótulo "direita" quando as duas aparecem,
   * mas uma mão sozinha comanda seja qual for o rótulo que o modelo lhe deu.
   */
  private commandHand(frame: FrameSnapshot | null): HandSnapshot | null {
    if (!frame) return null
    return frame.right ?? frame.left
  }

  /** Recebe um frame do reconhecedor. Chamado na taxa do modelo (~30Hz). */
  onGestureFrame(frame: FrameSnapshot): void {
    if (!this.enabled) return
    this.lastFrame = frame

    const hand = this.commandHand(frame)
    this.pointer.update(
      hand ? hand.pointer : null,
      frame.timestamp,
      { width: window.innerWidth, height: window.innerHeight },
      false,
    )
  }

  /** Aplica ajustes vindos do popup sem recriar o controlador. */
  applyTuning(config: Partial<TuningConfig>): void {
    if (config.scrollGain !== undefined) this.scrollGain = config.scrollGain
    if (config.showHud !== undefined) this.overlay.setHudVisible(config.showHud)
    if (config.showGuide !== undefined) this.overlay.setGuideVisible(config.showGuide)
    if (config.showTips !== undefined) this.overlay.setTipsVisible(config.showTips)

    const pointerConfig: Record<string, number> = {}
    if (config.activeWidth !== undefined) pointerConfig.activeWidth = config.activeWidth
    if (config.activeHeight !== undefined) pointerConfig.activeHeight = config.activeHeight
    if (config.minCutoff !== undefined) pointerConfig.minCutoff = config.minCutoff
    if (config.beta !== undefined) pointerConfig.beta = config.beta
    if (Object.keys(pointerConfig).length) this.pointer.updateConfig(pointerConfig)
  }

  /** Laço visual, na taxa do monitor. Aqui a página rola. */
  private loop = (): void => {
    if (!this.enabled) return
    this.rafHandle = requestAnimationFrame(this.loop)

    const now = performance.now()
    let dt = this.lastLoopTime ? (now - this.lastLoopTime) / 1000 : 1 / 60
    this.lastLoopTime = now
    if (!(dt > 0) || dt > 0.25) dt = 1 / 60

    const state = this.pointer.render(now)
    this.cursorX = state.x
    this.cursorY = state.y
    this.overlay.moveCursor(this.cursorX, this.cursorY)

    const frame = this.lastFrame
    const hand = this.commandHand(frame)
    this.overlay.setCursorMode(hand ? 'normal' : 'hidden')

    // O gesto chega já estabilizado pelo reconhecedor (3 frames consecutivos),
    // e só troca quando OUTRA leitura se sustenta por 3 frames — um frame ruim
    // no meio de uma rolagem não a interrompe, e um frame espúrio de mão aberta
    // não a inicia.
    const scrolling = hand?.gesture === 'open'

    this.paintHands(frame, hand, scrolling)

    if (scrolling) {
      const dy = SCROLL_PX_PER_SEC * this.scrollGain * dt
      this.dispatchScroll(this.cursorX, this.cursorY, 0, dy)
    }

    this.updateHud(hand, scrolling)
  }

  private dispatchScroll(x: number, y: number, dx: number, dy: number): boolean {
    const target = deepElementFromPoint(x, y)
    if (target instanceof HTMLIFrameElement) {
      const local = toFrameCoords(target, x, y)
      sendToFrame(target, { kind: 'scroll', x: local.x, y: local.y, dx, dy })
      return true
    }
    return synthScroll(x, y, dx, dy)
  }

  /**
   * Feedback do que a câmera está enxergando: as pontas de cada mão e o guia.
   *
   * Roda também quando não há mão alguma — é exatamente aí que ver o quadro
   * vazio explica por que nada acontece. Quem não sabe se o problema é a mão, a
   * luz ou o enquadramento fica sem o que ajustar.
   *
   * As pontas passam pela mesma conversão do cursor, e não pelo quadro inteiro:
   * assim a bolinha do indicador cai sobre o cursor que ela comanda, em vez de
   * andar num espaço próprio e desmentir a relação entre mão e ponteiro.
   */
  private paintHands(
    frame: FrameSnapshot | null,
    hand: HandSnapshot | null,
    scrolling: boolean,
  ): void {
    const w = window.innerWidth
    const h = window.innerHeight
    const toScreen = (tips: { x: number; y: number }[] | undefined) =>
      tips?.map((t) => this.pointer.toScreen(t.x, t.y, w, h)) ?? null

    this.overlay.setFingertips(toScreen(frame?.left?.tips), toScreen(frame?.right?.tips))

    let active: CommandId | null = null
    if (scrolling) active = 'scroll_down'
    else if (hand?.gesture === 'fist') active = 'stop'

    this.overlay.setGuide({ present: hand !== null, active })
  }

  private updateHud(hand: HandSnapshot | null, scrolling: boolean): void {
    let state: string
    let hint: string

    if (!hand) {
      state = 'Procurando a mão'
      hint = 'Levante uma mão em frente à câmera'
    } else if (scrolling) {
      state = 'Rolando para baixo'
      hint = 'Feche a mão para parar'
    } else {
      state = 'Parado'
      hint = 'Abra a mão para rolar a página'
    }

    this.overlay.setHud(state, hint, 'ok')
    this.options.onStatus?.(state)
  }

  destroy(): void {
    this.disable()
  }
}
