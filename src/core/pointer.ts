/**
 * Mapeamento da mão para a tela.
 *
 * Quatro decisões definem a sensação de controle aqui:
 *
 * 1. ÁREA ATIVA reduzida. Só a região central do quadro mapeia para a tela
 *    inteira, então os cantos da tela ficam alcançáveis sem esticar o braço
 *    até a borda do campo de visão — onde o rastreamento degrada.
 *
 * 2. Suavização adaptativa. Com a mão quase parada, o One Euro corta forte e o
 *    cursor fica cravado; num movimento amplo ele quase não filtra, e o cursor
 *    acompanha sem arrasto.
 *
 * 3. GANHO adaptativo. A área ativa amplia o quadro em cerca de cinco vezes até
 *    a tela, e nenhum filtro desfaz isso: filtrar remove o tremor, não a
 *    amplificação. Movimento lento recebe ganho reduzido — a mão anda mais que
 *    o cursor — e é daí que vem a precisão de mira. A correspondência com a
 *    posição absoluta é restaurada durante movimentos rápidos, quando a atenção
 *    não está na mira e o reposicionamento passa despercebido. Sem essa
 *    reancoragem, o esquema viraria um mapeamento relativo, com o drift que ele
 *    traz; sem o ganho reduzido, seria absoluto puro, sem precisão fina.
 *
 * 4. Interpolação a cada frame de animação, enquanto o modelo entrega só ~30
 *    amostras por segundo. Sem isso o movimento fica visivelmente escalonado
 *    num monitor de 60Hz.
 */

import { OneEuroFilter, clamp, damp, mapRange } from './filters'

export interface PointerConfig {
  /** Fração do quadro usada como área ativa, por eixo. 0.6 = 60% central. */
  activeWidth: number
  activeHeight: number
  /** Deslocamento vertical da área ativa. Positivo sobe a zona confortável. */
  verticalBias: number
  /** Suavização com a mão parada. Menor = mais estável, mais lag. */
  minCutoff: number
  /** Ganho de resposta à velocidade. Maior = menos lag no movimento rápido. */
  beta: number
  /** Velocidade da interpolação visual. Maior = mais direto, menos macio. */
  followLambda: number
  /**
   * Ganho aplicado no movimento lento, como fração do mapeamento absoluto.
   * 0.35 significa que mover a mão devagar move o cursor a ~1/3 da distância —
   * o que multiplica a precisão por 3 na mira fina.
   */
  precisionGain: number
  /** Abaixo desta velocidade (px/s) vale o ganho de precisão integral. */
  slowSpeed: number
  /** Acima desta velocidade (px/s) o ganho volta a ser o absoluto. */
  fastSpeed: number
}

export const DEFAULT_POINTER_CONFIG: PointerConfig = {
  activeWidth: 0.55,
  activeHeight: 0.5,
  verticalBias: 0.04,
  minCutoff: 0.8,
  beta: 0.02,
  followLambda: 28,
  precisionGain: 0.35,
  slowSpeed: 70,
  fastSpeed: 850,
}

export interface PointerState {
  /** Posição em pixels do viewport, já suavizada e interpolada. */
  x: number
  y: number
  /** Velocidade em px/s — usada para decidir se o cursor está "parado". */
  speed: number
  /** Falso enquanto o clutch está ativo ou não há mão rastreada. */
  active: boolean
}

export class PointerMapper {
  private config: PointerConfig
  private fx: OneEuroFilter
  private fy: OneEuroFilter

  /** Alvo suavizado, em pixels. É para onde o cursor visual caminha. */
  private targetX = 0
  private targetY = 0
  /** Posição renderizada, interpolada a cada frame de animação. */
  private renderX = 0
  private renderY = 0

  private lastRenderTime = 0
  private speed = 0
  private hasTarget = false

  /** Última amostra absoluta, base para calcular o deslocamento do frame. */
  private lastRawX = 0
  private lastRawY = 0
  private clutching = false

  constructor(config: Partial<PointerConfig> = {}) {
    this.config = { ...DEFAULT_POINTER_CONFIG, ...config }
    this.fx = new OneEuroFilter({ minCutoff: this.config.minCutoff, beta: this.config.beta })
    this.fy = new OneEuroFilter({ minCutoff: this.config.minCutoff, beta: this.config.beta })
  }

  updateConfig(config: Partial<PointerConfig>): void {
    this.config = { ...this.config, ...config }
    this.fx = new OneEuroFilter({ minCutoff: this.config.minCutoff, beta: this.config.beta })
    this.fy = new OneEuroFilter({ minCutoff: this.config.minCutoff, beta: this.config.beta })
  }

  /** Converte coordenada normalizada do quadro para pixel do viewport. */
  private frameToScreen(nx: number, ny: number, width: number, height: number) {
    const { activeWidth, activeHeight, verticalBias } = this.config

    const halfW = activeWidth / 2
    const halfH = activeHeight / 2
    const cx = 0.5
    const cy = 0.5 - verticalBias

    const tx = (nx - (cx - halfW)) / activeWidth
    const ty = (ny - (cy - halfH)) / activeHeight

    return {
      x: clamp(tx, 0, 1) * width,
      y: clamp(ty, 0, 1) * height,
    }
  }

  /**
   * Alimenta uma amostra do rastreamento. Chamar na taxa do modelo (~30Hz).
   * `clutch` congela o cursor e permite reposicionar a mão.
   *
   * O cursor não segue a posição absoluta diretamente: segue o DESLOCAMENTO da
   * mão, multiplicado por um ganho que depende da velocidade. Movimento lento
   * recebe ganho reduzido, e é isso que dá precisão fina — a área ativa amplia
   * o quadro em cerca de cinco vezes até a tela, então sem esse freio cada
   * pixel de ruído do rastreamento viraria cinco na tela.
   *
   * Reduzir o ganho, porém, faz o cursor ficar para trás da posição absoluta.
   * A correspondência é restaurada durante os movimentos rápidos, quando a
   * atenção não está na mira: o alvo é puxado de volta para a posição absoluta
   * com uma taxa que cresce com a velocidade. O resultado é preciso de perto e
   * previsível de longe, sem o drift de um mapeamento puramente relativo.
   */
  update(
    normalized: { x: number; y: number } | null,
    timestamp: number,
    viewport: { width: number; height: number },
    clutch = false,
  ): void {
    if (!normalized) {
      this.hasTarget = false
      this.fx.reset()
      this.fy.reset()
      this.clutching = false
      return
    }

    const raw = this.frameToScreen(normalized.x, normalized.y, viewport.width, viewport.height)
    const sx = this.fx.filter(raw.x, timestamp)
    const sy = this.fy.filter(raw.y, timestamp)

    // Primeira amostra: cursor nasce onde a mão está, sem deslocamento.
    if (!this.hasTarget) {
      this.targetX = sx
      this.targetY = sy
      this.renderX = sx
      this.renderY = sy
      this.lastRawX = sx
      this.lastRawY = sy
      this.hasTarget = true
      return
    }

    const dx = sx - this.lastRawX
    const dy = sy - this.lastRawY
    this.lastRawX = sx
    this.lastRawY = sy

    // Durante o clutch a mão anda mas o cursor não. Como trabalhamos com
    // deslocamentos, basta descartar este frame: ao soltar, o movimento segue
    // do ponto onde o cursor parou, sem salto algum.
    if (clutch) {
      this.clutching = true
      return
    }
    this.clutching = false

    const dt = 1 / 30
    const speed = Math.sqrt(dx * dx + dy * dy) / dt

    const { precisionGain, slowSpeed, fastSpeed } = this.config
    const gain = mapRange(speed, slowSpeed, fastSpeed, precisionGain, 1)

    this.targetX += dx * gain
    this.targetY += dy * gain

    // Reancoragem: só atua em movimento amplo, onde um reposicionamento suave
    // passa despercebido. Em movimento lento a taxa é zero, senão o puxão
    // desfaria a precisão que o ganho reduzido acabou de conquistar.
    const reanchor = mapRange(speed, fastSpeed, fastSpeed * 2.5, 0, 4)
    if (reanchor > 0) {
      this.targetX = damp(this.targetX, sx, reanchor, dt)
      this.targetY = damp(this.targetY, sy, reanchor, dt)
    }

    this.targetX = clamp(this.targetX, 0, viewport.width)
    this.targetY = clamp(this.targetY, 0, viewport.height)
  }

  /**
   * Avança a interpolação visual. Chamar dentro de requestAnimationFrame, na
   * taxa do monitor — é isto que remove o degrau entre amostras do modelo.
   */
  render(now: number): PointerState {
    let dt = this.lastRenderTime ? (now - this.lastRenderTime) / 1000 : 1 / 60
    this.lastRenderTime = now
    if (!(dt > 0) || dt > 0.25) dt = 1 / 60

    const prevX = this.renderX
    const prevY = this.renderY

    if (this.hasTarget) {
      this.renderX = damp(this.renderX, this.targetX, this.config.followLambda, dt)
      this.renderY = damp(this.renderY, this.targetY, this.config.followLambda, dt)
    }

    const dx = this.renderX - prevX
    const dy = this.renderY - prevY
    this.speed = Math.sqrt(dx * dx + dy * dy) / dt

    return {
      x: this.renderX,
      y: this.renderY,
      speed: this.speed,
      active: this.hasTarget && !this.clutching,
    }
  }

  get position(): { x: number; y: number } {
    return { x: this.renderX, y: this.renderY }
  }

  /** Cursor praticamente parado — condição para confirmar um clique. */
  isSettled(threshold = 90): boolean {
    return this.speed < threshold
  }

  /**
   * Reposiciona o cursor sem passar pela suavização.
   *
   * Usado pelo magnetismo, que precisa deslocar o cursor por conta própria: se
   * o ajuste fosse aplicado só na posição renderizada, o alvo continuaria no
   * lugar antigo e puxaria o cursor de volta no frame seguinte.
   */
  nudge(x: number, y: number): void {
    this.targetX = x
    this.targetY = y
  }

  reset(): void {
    this.fx.reset()
    this.fy.reset()
    this.hasTarget = false
    this.clutching = false
  }
}

/**
 * Rolagem com inércia.
 *
 * Rolar exatamente na proporção do movimento da mão obriga a repetir o gesto
 * muitas vezes para percorrer uma página longa. Guardando a velocidade no fim
 * do gesto e deixando-a decair, um único movimento rápido percorre bastante
 * página — é o mesmo comportamento do scroll por toque.
 */
export class ScrollMomentum {
  private velocity = 0
  private lastTime = 0
  private active = false

  /** Chamar enquanto o gesto de rolagem está ativo. `delta` em pixels. */
  push(delta: number, now: number): void {
    const dt = this.lastTime ? Math.max((now - this.lastTime) / 1000, 1e-3) : 1 / 60
    this.lastTime = now
    this.active = true
    // Mistura com o valor anterior para não herdar o ruído de um frame só.
    this.velocity = this.velocity * 0.6 + (delta / dt) * 0.4
  }

  /** Chamar quando o gesto termina; a inércia assume a partir daqui. */
  release(): void {
    this.active = false
  }

  /** Avança a simulação e devolve o deslocamento deste frame, em pixels. */
  step(now: number, friction = 4.5): number {
    const dt = this.lastTime ? Math.max((now - this.lastTime) / 1000, 1e-3) : 1 / 60
    this.lastTime = now

    if (this.active) return 0

    if (Math.abs(this.velocity) < 8) {
      this.velocity = 0
      return 0
    }

    const delta = this.velocity * dt
    this.velocity *= Math.exp(-friction * dt)
    return delta
  }

  stop(): void {
    this.velocity = 0
    this.active = false
  }

  get isCoasting(): boolean {
    return !this.active && Math.abs(this.velocity) >= 8
  }
}
