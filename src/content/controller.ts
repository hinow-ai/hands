/**
 * Máquina de estados que traduz gestos em interação com a página.
 *
 * Regras que definem o comportamento:
 *
 * - A pinça é ambígua por natureza: fechar e abrir rápido é um clique, fechar e
 *   mover é um arraste. Não dá para decidir no instante em que a pinça fecha,
 *   então o clique fica pendente e só é emitido na abertura, se o cursor tiver
 *   ficado praticamente parado. É a mesma convenção do toque em tela.
 *
 * - Todo comando é resolvido contra o frame certo. Se o alvo sob o cursor é um
 *   iframe, o comando viaja por postMessage em vez de ser executado aqui, com
 *   as coordenadas já convertidas.
 *
 * - Nenhuma ação é disparada enquanto o gesto não estiver estável. O
 *   reconhecedor já entrega gestos confirmados por alguns frames, o que evita
 *   cliques fantasmas durante a transição entre uma pose e outra.
 */

import { GESTURE_LABELS, GestureName } from '../core/gestures'
import { FrameSnapshot, TuningConfig } from '../core/wire'
import { PointerMapper, ScrollMomentum } from '../core/pointer'
import { clamp } from '../core/filters'
import { Overlay } from './overlay'
import { ImageViewer } from './imageZoom'
import { Magnet } from './magnet'
import {
  HoverTracker,
  deepElementFromPoint,
  historyBack,
  historyForward,
  synthClick,
  synthDragEnd,
  synthDragMove,
  synthDragStart,
  synthScroll,
  synthZoom,
} from './synth'
import { sendToFrame, toFrameCoords } from './frames'

/** Deslocamento a partir do qual a pinça deixa de ser clique e vira arraste. */
const DRAG_THRESHOLD_PX = 26

/** Quanto o movimento da mão é ampliado ao rolar a página. */
const SCROLL_GAIN = 2.6

/** Intervalo mínimo entre navegações no histórico. */
const HISTORY_COOLDOWN_MS = 1200

/** Tempo de punho mantido que fecha o visualizador de imagem. */
const FIST_CLOSE_MS = 650

/**
 * Força de pinça que arma o clique.
 *
 * Bem antes de a pinça fechar de fato já dá para saber que ela está fechando.
 * Nesse instante congelamos a posição, e é ela que o clique usa: o ato de unir
 * os dedos desloca a mão inteira alguns pixels, então mirar e clicar na mesma
 * coordenada seria impossível. É o defeito clássico de qualquer interface por
 * gesto ou olhar — o gesto de confirmar move o que ele deveria confirmar.
 */
const PINCH_ARM_STRENGTH = 0.32

/** Elementos que valem a pena realçar como alvo clicável. */
const INTERACTIVE_SELECTOR =
  'a[href], button, input, select, textarea, summary, label, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="option"], [onclick], [tabindex]:not([tabindex="-1"])'

type Mode = 'idle' | 'pointing' | 'pinch' | 'drag' | 'scroll' | 'clutch' | 'zoom'

export interface ControllerOptions {
  onStatus?: (text: string) => void
}

export class GestureController {
  private overlay = new Overlay()
  private viewer = new ImageViewer()
  private pointer = new PointerMapper()
  private hover = new HoverTracker()
  private momentum = new ScrollMomentum()
  private magnet = new Magnet()

  /** Posição efetiva do cursor: já suavizada, interpolada e magnetizada. */
  private cursorX = 0
  private cursorY = 0
  private lastLoopTime = 0

  /** Posição congelada quando a pinça começou a fechar; usada pelo clique. */
  private armedX: number | null = null
  private armedY: number | null = null

  private mode: Mode = 'idle'
  private enabled = false

  private lastFrame: FrameSnapshot | null = null
  private rafHandle = 0
  private previousGesture: GestureName | 'none' = 'none'
  private scrollGain = SCROLL_GAIN

  // Estado da pinça
  private pinchStartX = 0
  private pinchStartY = 0
  private pinchMoved = false
  private dragTarget: Element | null = null
  private dragFrame: HTMLIFrameElement | null = null

  // Estado da rolagem
  private scrollAnchorY: number | null = null


  // Estado do zoom com duas mãos
  private zoomBaseSpread: number | null = null
  private zoomBaseScale = 1

  // Punho mantido
  private fistSince = 0

  private lastHistoryAt = 0
  private lastHoverElement: Element | null = null

  constructor(private options: ControllerOptions = {}) {}

  enable(): void {
    if (this.enabled) return
    this.enabled = true
    this.overlay.attach()
    this.overlay.setHudVisible(true)
    this.overlay.setHud('Procurando mão', 'Levante a mão em frente à câmera')
    this.loop()
  }

  disable(): void {
    if (!this.enabled) return
    this.enabled = false
    cancelAnimationFrame(this.rafHandle)
    this.releaseEverything()
    this.overlay.detach()
    this.viewer.hide()
    this.hover.clear()
    this.pointer.reset()
    this.mode = 'idle'
  }

  get isEnabled(): boolean {
    return this.enabled
  }

  /** Recebe um frame do reconhecedor. Chamado na taxa do modelo (~30Hz). */
  onGestureFrame(frame: FrameSnapshot): void {
    if (!this.enabled) return
    this.lastFrame = frame

    // A mão que comanda o ponteiro é a direita quando existe; a esquerda
    // assume sozinha se for a única no quadro, para que canhotos e quem estiver
    // com uma das mãos ocupada não fiquem sem controle.
    const primary = frame.right ?? frame.left
    const viewport = { width: window.innerWidth, height: window.innerHeight }

    const clutch = primary?.gesture === 'fist'
    this.pointer.update(
      primary ? primary.pointer : null,
      frame.timestamp,
      viewport,
      clutch,
    )

    // Arma o clique assim que os dedos começam a se aproximar, muito antes de
    // a pinça ser reconhecida. A posição de agora é a que o usuário está
    // mirando; a de daqui a três frames já terá sido contaminada pelo próprio
    // movimento de fechar a mão.
    const strength = primary?.pinchStrength ?? 0
    if (strength >= PINCH_ARM_STRENGTH) {
      if (this.armedX === null) {
        this.armedX = this.cursorX
        this.armedY = this.cursorY
      }
    } else {
      this.armedX = null
      this.armedY = null
    }

    // A saída de um gesto é tão significativa quanto a entrada: é ao ABRIR a
    // pinça que o clique acontece. Detectar a transição aqui, e não no laço
    // visual, garante que ela seja processada uma única vez.
    const current: GestureName | 'none' = primary?.gesture ?? 'none'
    if (current !== this.previousGesture) {
      this.onGestureTransition(this.previousGesture, current)
      this.previousGesture = current
    }
  }

  private onGestureTransition(previous: GestureName | 'none', next: GestureName | 'none'): void {
    const x = this.cursorX
    const y = this.cursorY

    if (previous === 'pinch' && next !== 'pinch') {
      // O clique vai para onde o cursor estava quando a pinça começou a
      // fechar, não para onde a mão o levou durante o fechamento.
      this.resolvePinchRelease(this.armedX ?? x, this.armedY ?? y)
    }
    if (previous === 'two' && next !== 'two') {
      this.endScroll()
    }
    if (previous === 'fist' && next !== 'fist') {
      this.fistSince = 0
    }
  }

  /** Aplica ajustes vindos do popup sem recriar o controlador. */
  applyTuning(config: Partial<TuningConfig>): void {
    if (config.scrollGain !== undefined) this.scrollGain = config.scrollGain
    if (config.showHud !== undefined) this.overlay.setHudVisible(config.showHud)

    const pointerConfig: Record<string, number> = {}
    if (config.activeWidth !== undefined) pointerConfig.activeWidth = config.activeWidth
    if (config.activeHeight !== undefined) pointerConfig.activeHeight = config.activeHeight
    if (config.minCutoff !== undefined) pointerConfig.minCutoff = config.minCutoff
    if (config.beta !== undefined) pointerConfig.beta = config.beta
    if (Object.keys(pointerConfig).length) this.pointer.updateConfig(pointerConfig)
  }

  /** Laço visual, na taxa do monitor. Aqui o cursor anda e as ações saem. */
  private loop = (): void => {
    if (!this.enabled) return
    this.rafHandle = requestAnimationFrame(this.loop)

    const now = performance.now()
    let dt = this.lastLoopTime ? (now - this.lastLoopTime) / 1000 : 1 / 60
    this.lastLoopTime = now
    if (!(dt > 0) || dt > 0.25) dt = 1 / 60

    const state = this.pointer.render(now)
    const frame = this.lastFrame

    // Durante um arraste o magnetismo é desligado: arrastar exige a posição
    // que a mão realmente pede — um mapa sendo deslocado não pode ser puxado
    // para o botão mais próximo no meio do movimento.
    this.magnet.setEnabled(this.mode !== 'drag' && this.mode !== 'zoom' && !this.viewer.isOpen)
    const adjusted = this.magnet.apply(state.x, state.y, dt)
    this.cursorX = adjusted.x
    this.cursorY = adjusted.y

    this.overlay.moveCursor(this.cursorX, this.cursorY)
    this.applyMomentum(now)

    if (!frame || frame.hands.length === 0) {
      this.handleNoHands()
      return
    }

    const primary = frame.right ?? frame.left
    if (!primary) {
      this.handleNoHands()
      return
    }

    // Zoom com as duas mãos tem prioridade: é um gesto deliberado e não deve
    // ser interpretado como duas pinças independentes.
    if (frame.twoHandPinch && frame.twoHandSpread !== null) {
      this.handleTwoHandZoom(frame.twoHandSpread, this.cursorX, this.cursorY)
      this.updateHud(primary.gesture, 'Zoom')
      return
    }
    this.zoomBaseSpread = null

    switch (primary.gesture) {
      case 'pinch':
        this.handlePinch(this.cursorX, this.cursorY)
        break
      case 'two':
        this.handleScroll(this.cursorX, this.cursorY, primary.pointer.y, now)
        break
      case 'fist':
        this.handleFist(now)
        break
      case 'thumb_left':
        this.handleHistory('back', now)
        break
      case 'thumb_right':
        this.handleHistory('forward', now)
        break
      case 'point':
      case 'open':
      default:
        this.handleNeutral(this.cursorX, this.cursorY)
        break
    }

    this.updateHud(primary.gesture, this.hintFor(primary.gesture))
  }

  // ------------------------------------------------------------ estados

  private handleNoHands(): void {
    if (this.mode === 'drag') this.endDrag(this.cursorX, this.cursorY)
    if (this.mode === 'scroll') this.endScroll()
    this.magnet.reset()
    this.armedX = null
    this.armedY = null
    this.mode = 'idle'
    this.overlay.setCursorMode('hidden')
    this.overlay.showHighlight(null)
    this.overlay.setDwellProgress(0)
    this.hover.clear()
    this.overlay.setHud('Procurando mão', 'Levante a mão em frente à câmera')
  }

  private handleNeutral(x: number, y: number): void {
    if (this.mode === 'drag') this.endDrag(x, y)
    if (this.mode === 'scroll') this.endScroll()
    this.fistSince = 0

    this.mode = 'pointing'
    this.overlay.setCursorMode('normal')
    this.overlay.setDwellProgress(0)
    this.updateHover(x, y)
  }

  private handlePinch(x: number, y: number): void {
    if (this.mode === 'scroll') this.endScroll()
    this.fistSince = 0

    // Entrada na pinça: guarda a âncora e deixa o clique pendente.
    if (this.mode !== 'pinch' && this.mode !== 'drag') {
      this.pinchStartX = x
      this.pinchStartY = y
      this.pinchMoved = false
      this.mode = 'pinch'
      this.overlay.setCursorMode('pinching')
      return
    }

    const dx = x - this.pinchStartX
    const dy = y - this.pinchStartY
    const travelled = Math.sqrt(dx * dx + dy * dy)

    if (this.mode === 'pinch' && travelled > DRAG_THRESHOLD_PX) {
      this.beginDrag(this.pinchStartX, this.pinchStartY)
      this.pinchMoved = true
    }

    if (this.mode === 'drag') {
      this.overlay.setCursorMode('dragging')
      this.dispatchDragMove(x, y)
    }
  }

  /**
   * Repassa o movimento do arraste para onde ele começou.
   *
   * Se o arraste nasceu dentro de um iframe, todos os passos seguintes precisam
   * continuar indo para lá, mesmo que o cursor já tenha saído do retângulo do
   * iframe — é o que mantém o pan de um mapa acompanhando a mão até o fim do
   * gesto, em vez de travar na borda.
   */
  private dispatchDragMove(x: number, y: number): void {
    if (this.dragFrame) {
      const local = toFrameCoords(this.dragFrame, x, y)
      sendToFrame(this.dragFrame, { kind: 'dragmove', x: local.x, y: local.y })
      return
    }
    synthDragMove(this.dragTarget, x, y)
  }

  /**
   * Fim da pinça. Vem do laço quando o gesto deixa de ser `pinch`, então
   * precisa ser chamado de qualquer transição de saída.
   */
  private resolvePinchRelease(x: number, y: number): void {
    if (this.mode === 'drag') {
      this.endDrag(x, y)
      return
    }
    if (this.mode === 'pinch' && !this.pinchMoved) {
      this.performClick(x, y)
    }
    this.mode = 'pointing'
  }

  private beginDrag(x: number, y: number): void {
    this.mode = 'drag'
    const target = deepElementFromPoint(x, y)

    if (target instanceof HTMLIFrameElement) {
      this.dragFrame = target
      const local = toFrameCoords(target, x, y)
      sendToFrame(target, { kind: 'dragstart', x: local.x, y: local.y })
      this.dragTarget = null
      return
    }

    this.dragFrame = null
    this.dragTarget = synthDragStart(x, y)
  }

  private endDrag(x: number, y: number): void {
    if (this.dragFrame) {
      const local = toFrameCoords(this.dragFrame, x, y)
      sendToFrame(this.dragFrame, { kind: 'dragend', x: local.x, y: local.y, moved: true })
    } else {
      synthDragEnd(this.dragTarget, x, y, true)
    }
    this.dragTarget = null
    this.dragFrame = null
    this.mode = 'pointing'
    this.overlay.setCursorMode('normal')
  }

  private performClick(x: number, y: number): void {
    if (this.viewer.isOpen) {
      const closeRect = this.viewer.closeButtonRect()
      if (
        x >= closeRect.left &&
        x <= closeRect.right &&
        y >= closeRect.top &&
        y <= closeRect.bottom
      ) {
        this.viewer.hide()
        this.overlay.showToast('Imagem fechada')
        return
      }
    }

    const target = deepElementFromPoint(x, y)
    if (target instanceof HTMLIFrameElement) {
      const local = toFrameCoords(target, x, y)
      sendToFrame(target, { kind: 'click', x: local.x, y: local.y })
      return
    }

    synthClick(x, y)
  }

  private handleScroll(x: number, y: number, handY: number, now: number): void {
    if (this.mode === 'drag') this.endDrag(x, y)
    this.fistSince = 0

    if (this.mode !== 'scroll') {
      this.mode = 'scroll'
      this.scrollAnchorY = handY
      this.momentum.stop()
      this.overlay.setCursorMode('normal')
      return
    }

    if (this.scrollAnchorY === null) {
      this.scrollAnchorY = handY
      return
    }

    // Mão sobe -> conteúdo sobe -> a página desce. O sinal aqui reproduz o
    // scroll natural do trackpad, que é o que a mão espera fazer.
    const deltaNorm = handY - this.scrollAnchorY
    this.scrollAnchorY = handY

    const delta = deltaNorm * window.innerHeight * this.scrollGain
    if (Math.abs(delta) < 0.4) return

    this.momentum.push(delta, now)
    this.dispatchScroll(x, y, 0, delta)
  }

  private endScroll(): void {
    this.momentum.release()
    this.scrollAnchorY = null
    this.mode = 'pointing'
  }

  private applyMomentum(now: number): void {
    // Sem inércia dentro do visualizador: lá a rolagem não faz sentido.
    if (this.viewer.isOpen) return

    const delta = this.momentum.step(now)
    if (delta === 0) return

    this.dispatchScroll(this.cursorX, this.cursorY, 0, delta)
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

  private handleFist(now: number): void {
    if (this.mode === 'drag') this.endDrag(this.cursorX, this.cursorY)
    if (this.mode === 'scroll') this.endScroll()

    if (!this.fistSince) this.fistSince = now

    if (this.viewer.isOpen && now - this.fistSince > FIST_CLOSE_MS) {
      this.viewer.hide()
      this.overlay.showToast('Imagem fechada')
      this.fistSince = 0
      return
    }

    this.mode = 'clutch'
    this.overlay.setCursorMode('clutch')
    this.overlay.showHighlight(null)
  }

  private handleHistory(direction: 'back' | 'forward', now: number): void {
    if (now - this.lastHistoryAt < HISTORY_COOLDOWN_MS) return
    this.lastHistoryAt = now

    if (this.viewer.isOpen) {
      this.viewer.hide()
      return
    }

    if (direction === 'back') {
      this.overlay.showToast('Voltando')
      historyBack()
    } else {
      this.overlay.showToast('Avançando')
      historyForward()
    }
  }

  /**
   * Zoom pela distância entre as duas mãos.
   *
   * A escala é sempre relativa à abertura registrada no início do gesto, e não
   * ao frame anterior. Assim o erro não se acumula, e voltar as mãos à posição
   * inicial devolve exatamente o zoom inicial.
   */
  private handleTwoHandZoom(spread: number, x: number, y: number): void {
    if (this.mode === 'drag') this.endDrag(x, y)
    if (this.mode === 'scroll') this.endScroll()

    if (this.zoomBaseSpread === null) {
      this.zoomBaseSpread = spread
      this.zoomBaseScale = this.viewer.isOpen ? this.viewer.zoom : 1

      // Ao iniciar o zoom sobre uma imagem numa página que não trata zoom,
      // abrimos o visualizador — senão o gesto não teria efeito visível.
      if (!this.viewer.isOpen) {
        const handled = synthZoom(x, y, -60)
        if (!handled) {
          const src = ImageViewer.findImageAt(x, y)
          if (src) {
            this.viewer.show(src)
            this.zoomBaseScale = 1
            this.overlay.showToast('Afaste as mãos para ampliar')
          }
        }
      }
      this.mode = 'zoom'
      this.overlay.setCursorMode('pinching')
      return
    }

    const ratio = spread / Math.max(this.zoomBaseSpread, 1e-6)

    if (this.viewer.isOpen) {
      this.viewer.setZoom(this.zoomBaseScale * ratio)
      return
    }

    // Fora do visualizador, convertemos a variação em passos de roda com ctrl,
    // que é a representação de pinch-zoom que os mapas entendem.
    const step = clamp((ratio - 1) * -240, -120, 120)
    if (Math.abs(step) > 4) {
      const target = deepElementFromPoint(x, y)
      if (target instanceof HTMLIFrameElement) {
        const local = toFrameCoords(target, x, y)
        sendToFrame(target, { kind: 'zoom', x: local.x, y: local.y, delta: step })
      } else {
        synthZoom(x, y, step)
      }
      this.zoomBaseSpread = spread
    }
  }

  // ------------------------------------------------------------ auxiliares

  private updateHover(x: number, y: number): void {
    const el = deepElementFromPoint(x, y)

    if (el instanceof HTMLIFrameElement) {
      const local = toFrameCoords(el, x, y)
      sendToFrame(el, { kind: 'move', x: local.x, y: local.y })
      this.overlay.showHighlight(null)
      this.hover.clear()
      return
    }

    this.hover.move(el, x, y)

    // Realçamos o ancestral interativo, não o nó exato sob o cursor: acertar o
    // <span> dentro de um <button> deve destacar o botão inteiro.
    const interactive = el?.closest?.(INTERACTIVE_SELECTOR) ?? null
    if (interactive !== this.lastHoverElement) {
      this.lastHoverElement = interactive
    }
    this.overlay.showHighlight(interactive ? interactive.getBoundingClientRect() : null)
  }

  private hintFor(gesture: string): string {
    if (this.viewer.isOpen) return 'Pinça dupla: zoom · Punho: fechar'
    switch (gesture) {
      case 'point':
        return 'Pinça para clicar'
      case 'pinch':
        return this.mode === 'drag' ? 'Arrastando' : 'Solte para clicar'
      case 'two':
        return 'Mova para rolar'
      case 'fist':
        return 'Cursor travado — reposicione a mão'
      case 'open':
        return 'Repouso'
      default:
        return 'Aponte para mover o cursor'
    }
  }

  private updateHud(gesture: string, hint: string): void {
    const label = GESTURE_LABELS[gesture as keyof typeof GESTURE_LABELS] ?? gesture
    this.overlay.setHud(label, hint)
    this.options.onStatus?.(label)
  }

  private releaseEverything(): void {
    if (this.mode === 'drag') synthDragEnd(this.dragTarget, this.cursorX, this.cursorY, true)
    this.momentum.stop()
    this.dragTarget = null
    this.dragFrame = null
    this.zoomBaseSpread = null
    this.scrollAnchorY = null
  }

  destroy(): void {
    this.disable()
    this.viewer.destroy()
  }
}
