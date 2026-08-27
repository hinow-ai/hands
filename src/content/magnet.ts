/**
 * Magnetismo em alvos clicáveis.
 *
 * A área ativa amplia o quadro da câmera em cerca de cinco vezes até a tela, e
 * nenhuma quantidade de filtragem faz um erro de rastreamento de dois pixels
 * valer menos de dez na tela. Em vez de perseguir uma precisão que o sensor não
 * entrega, reduzimos a precisão exigida: chegar perto de um link passa a bastar.
 *
 * A busca por candidatos não varre a página. Varrer significaria
 * `querySelectorAll` sobre um seletor largo mais um `getBoundingClientRect` por
 * elemento — caro numa página grande, e desatualizado assim que algo se move.
 * Em vez disso sondamos alguns pontos num círculo ao redor do cursor: o custo
 * não depende do tamanho da página, e o resultado é sempre o estado atual.
 *
 * O ajuste é aplicado só à posição visível, nunca ao alvo interno do ponteiro.
 * Mexer no alvo prenderia o cursor: a atração competiria com o movimento da mão
 * a cada frame. Deixando o alvo livre, sair de um elemento é tão fácil quanto
 * entrar, e o que gruda é apenas o que se vê e o que recebe o clique.
 */

import { damp } from '../core/filters'
import { deepElementFromPoint } from './synth'

/** Distância máxima, em pixels, a que um alvo ainda atrai. */
const RADIUS = 30

/**
 * Fração máxima do caminho até o alvo percorrida pela atração.
 *
 * Precisa ser alta. A atração só serve para alguma coisa se levar o cursor
 * para DENTRO do alvo — puxá-lo um terço do caminho deixa o clique errando do
 * mesmo jeito, com o agravante de ter desviado o cursor à toa. Prender não é
 * um risco aqui porque o ajuste é aplicado só ao que se vê: o alvo interno do
 * ponteiro continua seguindo a mão, então afastar-se sempre funciona.
 */
const MAX_PULL = 0.95

/** Pontos sondados no círculo ao redor do cursor. */
const PROBES = 10

/** A sondagem roda a cada N frames; 60fps não exige 60 varreduras por segundo. */
const PROBE_INTERVAL = 3

const INTERACTIVE =
  'a[href], button, input, select, textarea, summary, label, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="option"], [role="checkbox"], [role="radio"], [onclick]'

/**
 * Contextos em que a posição livre importa mais que acertar um controle.
 *
 * Num mapa ou num canvas de desenho, o ponto exato é o conteúdo — puxar o
 * cursor para o botão de zoom mais próximo atrapalharia em vez de ajudar.
 */
const FREE_FORM = 'canvas, svg, video, [role="application"], [role="img"], .gm-style, .leaflet-container'

export class Magnet {
  private enabled = true
  private frame = 0
  private target: DOMRect | null = null
  private targetEl: Element | null = null

  /** Deslocamento aplicado, suavizado para o encaixe não parecer um salto. */
  private offsetX = 0
  private offsetY = 0

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    if (!enabled) this.clear()
  }

  private clear(): void {
    this.target = null
    this.targetEl = null
  }

  /** Ponto do retângulo mais próximo de (x,y), e a distância até ele. */
  private static closestPoint(rect: DOMRect, x: number, y: number) {
    const cx = Math.max(rect.left, Math.min(x, rect.right))
    const cy = Math.max(rect.top, Math.min(y, rect.bottom))
    const dx = cx - x
    const dy = cy - y
    return { x: cx, y: cy, distance: Math.sqrt(dx * dx + dy * dy) }
  }

  /**
   * Procura o alvo interativo mais próximo sondando um círculo ao redor do
   * cursor. Devolve `null` quando não há nenhum ao alcance, ou quando o cursor
   * está sobre conteúdo em que a posição livre deve ser preservada.
   */
  private findTarget(x: number, y: number): Element | null {
    const under = deepElementFromPoint(x, y)
    if (under?.closest?.(FREE_FORM)) return null

    // Cursor já sobre um elemento interativo: ele é o alvo, sem sondagem.
    const direct = under?.closest?.(INTERACTIVE)
    if (direct) return direct

    let best: Element | null = null
    let bestDistance = Infinity

    for (let i = 0; i < PROBES; i++) {
      const angle = (i / PROBES) * Math.PI * 2
      const px = x + Math.cos(angle) * RADIUS
      const py = y + Math.sin(angle) * RADIUS

      const el = deepElementFromPoint(px, py)
      const candidate = el?.closest?.(INTERACTIVE)
      if (!candidate) continue

      // Um alvo enorme — um <a> envolvendo um bloco inteiro — não deve atrair:
      // o cursor já estaria dentro dele se fosse a intenção, e puxá-lo para a
      // borda mais próxima só desviaria o movimento.
      const rect = candidate.getBoundingClientRect()
      if (rect.width > 400 || rect.height > 260) continue

      const { distance } = Magnet.closestPoint(rect, x, y)
      if (distance < bestDistance) {
        bestDistance = distance
        best = candidate
      }
    }

    return best
  }

  /**
   * Ajusta a posição do cursor. Recebe e devolve pixels de viewport.
   * `dt` em segundos, para a suavização não depender da taxa de quadros.
   */
  apply(x: number, y: number, dt: number): { x: number; y: number; target: Element | null } {
    if (!this.enabled) {
      return { x, y, target: null }
    }

    if (this.frame++ % PROBE_INTERVAL === 0) {
      this.targetEl = this.findTarget(x, y)
      this.target = this.targetEl?.getBoundingClientRect() ?? null
    } else if (this.targetEl) {
      // Entre sondagens, o retângulo ainda precisa acompanhar rolagem e
      // animações, senão a atração aponta para onde o elemento estava.
      this.target = this.targetEl.getBoundingClientRect()
    }

    let desiredX = 0
    let desiredY = 0

    if (this.target) {
      const closest = Magnet.closestPoint(this.target, x, y)

      // Dentro do alvo a distância é zero e não há o que corrigir; o cursor já
      // está onde o clique vai acontecer.
      if (closest.distance > 0.5 && closest.distance < RADIUS) {
        // Atração plena na maior parte do raio, com uma rampa curta no limite.
        //
        // Uma curva que decai gradualmente ao longo de todo o raio produz uma
        // faixa em que o cursor é puxado mas não o suficiente para entrar no
        // alvo — o pior dos dois mundos, porque desvia o cursor e o clique erra
        // do mesmo jeito. Ou a atração resolve, ou não deveria acontecer.
        //
        // A rampa final existe só para que entrar e sair do raio não seja um
        // degrau; a suavização temporal aplicada adiante cuida do resto.
        const t = closest.distance / RADIUS
        // Medido: com a rampa em 0.82 a atração morria antes de vencer os
        // últimos pixels, e a faixa dos 24 aos 30px puxava sem entregar.
        const RAMP_START = 0.9
        const pull =
          t <= RAMP_START ? MAX_PULL : MAX_PULL * (1 - (t - RAMP_START) / (1 - RAMP_START))

        // Mirar exatamente na borda deixaria o cursor em cima da divisa, onde o
        // hit-testing pode cair no elemento vizinho. A margem garante que ele
        // pouse dentro do alvo de fato.
        const inset = Math.min(8, this.target.width / 3, this.target.height / 3)
        const nudgeX = closest.x + Math.sign(this.target.left + this.target.width / 2 - closest.x) * inset
        const nudgeY = closest.y + Math.sign(this.target.top + this.target.height / 2 - closest.y) * inset

        desiredX = (nudgeX - x) * pull
        desiredY = (nudgeY - y) * pull
      }
    }

    this.offsetX = damp(this.offsetX, desiredX, 22, dt)
    this.offsetY = damp(this.offsetY, desiredY, 22, dt)

    return {
      x: x + this.offsetX,
      y: y + this.offsetY,
      target: this.target ? this.targetEl : null,
    }
  }

  reset(): void {
    this.clear()
    this.offsetX = 0
    this.offsetY = 0
  }
}
