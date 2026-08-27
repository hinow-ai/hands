/**
 * Mapeamento da mão para a tela.
 *
 * Três decisões definem a sensação de controle aqui:
 *
 * 1. Mapeamento ABSOLUTO, não relativo. "Mão à direita = cursor à direita" é
 *    imediatamente compreensível; um mapeamento relativo tipo mouse acumula
 *    drift e obriga a pessoa a caçar o cursor na tela.
 *
 * 2. ÁREA ATIVA reduzida. Só a região central do quadro mapeia para a tela
 *    inteira, então os cantos da tela ficam alcançáveis sem esticar o braço
 *    até a borda do campo de visão — onde o rastreamento degrada.
 *
 * 3. Suavização adaptativa. Com a mão quase parada, o One Euro corta forte e o
 *    cursor fica cravado — é o que permite acertar um link pequeno. Num
 *    movimento amplo ele quase não filtra, e o cursor acompanha sem arrasto.
 *
 * O cursor ainda é interpolado a cada frame de animação, enquanto o modelo
 * entrega só ~30 amostras por segundo. Sem isso o movimento fica visivelmente
 * escalonado num monitor de 60Hz.
 */

import { OneEuroFilter, clamp, damp } from './filters'

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
}

export const DEFAULT_POINTER_CONFIG: PointerConfig = {
  activeWidth: 0.55,
  activeHeight: 0.5,
  verticalBias: 0.04,
  minCutoff: 0.8,
  beta: 0.02,
  followLambda: 28,
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

  /**
   * Deslocamento acumulado pelo clutch.
   *
   * Ao fechar o punho e reposicionar o braço, a mão muda de lugar mas o cursor
   * não pode se mexer. Ao reabrir, a diferença entre onde a mão está e onde o
   * cursor ficou é absorvida aqui — exatamente como levantar o mouse da mesa.
   */
  private offsetX = 0
  private offsetY = 0
  private clutching = false
  private clutchAnchorX = 0
  private clutchAnchorY = 0

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

    if (clutch) {
      if (!this.clutching) {
        this.clutching = true
        this.clutchAnchorX = sx
        this.clutchAnchorY = sy
      }
      // Durante o clutch o alvo não se move: só acumulamos o quanto a mão andou
      // para descontar quando o gesto terminar.
      this.offsetX = this.clutchAnchorX - sx
      this.offsetY = this.clutchAnchorY - sy
      return
    }

    if (this.clutching) {
      this.clutching = false
      // Congela o deslocamento acumulado para que a retomada seja contínua.
    }

    this.targetX = clamp(sx + this.offsetX, 0, viewport.width)
    this.targetY = clamp(sy + this.offsetY, 0, viewport.height)

    if (!this.hasTarget) {
      this.renderX = this.targetX
      this.renderY = this.targetY
      this.hasTarget = true
    }
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

  reset(): void {
    this.fx.reset()
    this.fy.reset()
    this.hasTarget = false
    this.clutching = false
    this.offsetX = 0
    this.offsetY = 0
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
