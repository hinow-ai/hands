/**
 * Filtros de suavização para input contínuo.
 *
 * O problema central do controle por webcam: o rastreamento tem ruído de ~1-3px
 * por frame mesmo com a mão parada. Um filtro passa-baixa fixo resolve o tremor
 * mas introduz lag proporcional — e lag mata a sensação de controle direto.
 *
 * O One Euro Filter resolve os dois: adapta a frequência de corte à velocidade
 * do movimento. Mão parada -> corte baixo -> tremor some. Mão rápida -> corte
 * alto -> resposta imediata. É o filtro usado em rastreamento de mão desde o
 * paper de Casiez et al. (CHI 2012).
 */

/** Passa-baixa exponencial simples, com alpha variável por chamada. */
class LowPass {
  private y: number | null = null
  private s: number | null = null

  filter(value: number, alpha: number): number {
    this.s = this.s === null ? value : alpha * value + (1 - alpha) * this.s
    this.y = value
    return this.s
  }

  get lastRaw(): number | null {
    return this.y
  }

  get lastFiltered(): number | null {
    return this.s
  }

  reset(): void {
    this.y = null
    this.s = null
  }
}

export interface OneEuroOptions {
  /** Frequência de corte mínima (Hz). Menor = mais suave com a mão parada. */
  minCutoff?: number
  /** Quanto o corte sobe com a velocidade. Maior = menos lag no movimento rápido. */
  beta?: number
  /** Corte do filtro aplicado à derivada. */
  dCutoff?: number
}

export class OneEuroFilter {
  private minCutoff: number
  private beta: number
  private dCutoff: number
  private x = new LowPass()
  private dx = new LowPass()
  private lastTime: number | null = null

  constructor({ minCutoff = 1.0, beta = 0.007, dCutoff = 1.0 }: OneEuroOptions = {}) {
    this.minCutoff = minCutoff
    this.beta = beta
    this.dCutoff = dCutoff
  }

  private alpha(cutoff: number, dt: number): number {
    const tau = 1 / (2 * Math.PI * cutoff)
    return 1 / (1 + tau / dt)
  }

  filter(value: number, timestamp: number): number {
    let dt = 1 / 30
    if (this.lastTime !== null) {
      const delta = (timestamp - this.lastTime) / 1000
      // Protege contra dt=0 (dois frames no mesmo ms) e contra pausas longas
      // da aba em background, que gerariam um salto brusco.
      if (delta > 0 && delta < 1) dt = delta
    }
    this.lastTime = timestamp

    const prev = this.x.lastFiltered
    const rawDerivative = prev === null ? 0 : (value - prev) / dt
    const edx = this.dx.filter(rawDerivative, this.alpha(this.dCutoff, dt))

    // O corte sobe com a velocidade: parado filtra forte, rápido quase não filtra.
    const cutoff = this.minCutoff + this.beta * Math.abs(edx)
    return this.x.filter(value, this.alpha(cutoff, dt))
  }

  reset(): void {
    this.x.reset()
    this.dx.reset()
    this.lastTime = null
  }
}

/** Aplica One Euro independente em cada eixo de um ponto 3D. */
export class OneEuroVec3 {
  private fx: OneEuroFilter
  private fy: OneEuroFilter
  private fz: OneEuroFilter

  constructor(options: OneEuroOptions = {}) {
    this.fx = new OneEuroFilter(options)
    this.fy = new OneEuroFilter(options)
    this.fz = new OneEuroFilter(options)
  }

  filter(p: { x: number; y: number; z: number }, t: number) {
    return {
      x: this.fx.filter(p.x, t),
      y: this.fy.filter(p.y, t),
      z: this.fz.filter(p.z, t),
    }
  }

  reset(): void {
    this.fx.reset()
    this.fy.reset()
    this.fz.reset()
  }
}

/**
 * Mediana deslizante de três amostras — o mata-picos.
 *
 * O One Euro é ótimo contra tremor contínuo, mas péssimo contra outliers: um
 * landmark que salta 30 px por um único frame parece velocidade alta, o corte
 * abre e o salto passa quase inteiro. A mediana descarta qualquer valor que
 * não se sustente por pelo menos duas amostras, ao custo de ~1 amostra de
 * atraso (~33 ms a 30 fps). É o filtro certo para câmera ruim, onde a
 * interferência aparece como picos isolados, não como tremor.
 */
export class MedianFilter {
  private a: number | null = null
  private b: number | null = null

  filter(value: number): number {
    const { a, b } = this
    this.a = b
    this.b = value
    if (a === null || b === null) return value
    // Mediana de três sem ordenar o array.
    return Math.max(Math.min(a, b), Math.min(Math.max(a, b), value))
  }

  reset(): void {
    this.a = null
    this.b = null
  }
}

/**
 * Schmitt trigger: liga num limiar alto e só desliga num limiar baixo.
 *
 * Sem isto, qualquer valor oscilando em torno do limiar (a distância da pinça,
 * por exemplo) gera dezenas de cliques por segundo. A banda morta entre os dois
 * limiares é o que torna o gesto estável.
 */
export class Hysteresis {
  private state: boolean

  constructor(
    private readonly onThreshold: number,
    private readonly offThreshold: number,
    initial = false,
  ) {
    this.state = initial
  }

  /** `true` quando o valor está "ativo". Assume que ativar = ficar ABAIXO do limiar. */
  update(value: number): boolean {
    if (this.state) {
      if (value > this.offThreshold) this.state = false
    } else {
      if (value < this.onThreshold) this.state = true
    }
    return this.state
  }

  get value(): boolean {
    return this.state
  }

  reset(state = false): void {
    this.state = state
  }
}

/**
 * Exige que um valor se mantenha por N amostras antes de ser aceito.
 *
 * O protótipo anterior usava 1500ms de espera, o que fazia cada ação parecer
 * travada. A ~30fps, 3 frames = ~100ms: suficiente para descartar um frame
 * espúrio do modelo, rápido o bastante para parecer instantâneo.
 */
export class StableValue<T> {
  private candidate: T | null = null
  private count = 0
  private committed: T | null = null

  constructor(private readonly framesRequired = 3) {}

  update(value: T | null): T | null {
    if (value !== this.candidate) {
      this.candidate = value
      this.count = 1
    } else {
      this.count++
    }

    if (this.count >= this.framesRequired) {
      this.committed = this.candidate
    }
    return this.committed
  }

  get value(): T | null {
    return this.committed
  }

  reset(): void {
    this.candidate = null
    this.count = 0
    this.committed = null
  }
}

/** Interpolação exponencial independente de framerate. */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-lambda * dt))
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}

/** Mapeia [inMin,inMax] -> [outMin,outMax] com corte nas pontas. */
export function mapRange(
  v: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
): number {
  if (inMax === inMin) return outMin
  const t = clamp((v - inMin) / (inMax - inMin), 0, 1)
  return outMin + t * (outMax - outMin)
}
