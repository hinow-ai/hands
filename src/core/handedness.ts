/**
 * Atribuição de papéis às mãos — qual é a esquerda, qual é a direita — a
 * partir da posição delas em relação ao corpo, e não do rótulo do modelo.
 *
 * O rótulo esquerda/direita do rastreador erra com frequência, e agora que
 * cada mão tem um papel fixo (a esquerda rola, a direita clica) um rótulo
 * trocado inverte os comandos da pessoa. A geometria do corpo é mais
 * confiável que a classificação: sentada de frente para a câmera, a mão
 * esquerda da pessoa aparece do lado esquerdo da imagem espelhada — como num
 * espelho — e a direita do lado direito. Braços não se cruzam no uso real
 * deste vocabulário.
 *
 * Três regras, na ordem:
 *
 * 1. **Duas mãos no quadro**: a posição decide sozinha. A mais à esquerda é a
 *    esquerda. O rótulo do modelo não participa.
 * 2. **Uma mão, com histórico recente**: herda o papel que tinha. É o que
 *    impede a mão direita de "virar esquerda" ao mirar num link do lado
 *    esquerdo da tela, e o que segura o papel quando a outra mão pisca para
 *    fora do quadro por alguns frames.
 * 3. **Uma mão, sem histórico**: só aqui o rótulo do modelo é usado — é o
 *    único indício disponível.
 *
 * O mesmo passo remove a "mão fantasma": o MediaPipe às vezes detecta a mesma
 * mão duas vezes, uma como Left e outra como Right, quase no mesmo lugar.
 * Duas detecções coladas são uma mão só, e fica a de maior confiança.
 */

export interface HandObservation {
  /** Centro aproximado da palma, em coordenadas de imagem espelhadas (0..1). */
  center: { x: number; y: number }
  /** Rótulo do modelo, já convertido para o lado da pessoa. */
  modelLabel: 'left' | 'right'
  score: number
}

export interface HandAssignment {
  /** Índice da observação original a que o papel se refere. */
  index: number
  hand: 'left' | 'right'
}

/** Duas detecções mais próximas que isto são a mesma mão vista em dobro. */
const DUPLICATE_DISTANCE = 0.09

/** Por quanto tempo um papel sobrevive sem ser visto, em ms. */
const MEMORY_MS = 900

/** Distância máxima para uma mão herdar um papel do histórico. */
const CONTINUITY_DISTANCE = 0.3

interface Memory {
  x: number
  y: number
  seenAt: number
}

export class HandAssigner {
  private memory = new Map<'left' | 'right', Memory>()

  assign(observations: HandObservation[], timestamp: number): HandAssignment[] {
    const alive = this.dedupe(observations)
    let result: HandAssignment[]

    if (alive.length >= 2) {
      // Com duas mãos a geometria decide: a mais à esquerda da imagem
      // espelhada é a esquerda da pessoa. Se o modelo devolver três detecções
      // (não deveria, com numHands=2), as duas de maior confiança valem.
      const byScore = [...alive].sort((a, b) => observations[b].score - observations[a].score)
      const pair = byScore.slice(0, 2)
      pair.sort((a, b) => observations[a].center.x - observations[b].center.x)
      result = [
        { index: pair[0], hand: 'left' },
        { index: pair[1], hand: 'right' },
      ]
    } else if (alive.length === 1) {
      const index = alive[0]
      result = [{ index, hand: this.assignSingle(observations[index], timestamp) }]
    } else {
      result = []
    }

    for (const { index, hand } of result) {
      const c = observations[index].center
      this.memory.set(hand, { x: c.x, y: c.y, seenAt: timestamp })
    }
    return result
  }

  /** Papel de uma mão sozinha: continuidade primeiro, rótulo do modelo depois. */
  private assignSingle(obs: HandObservation, timestamp: number): 'left' | 'right' {
    let best: 'left' | 'right' | null = null
    let bestDistance = Infinity

    for (const hand of ['left', 'right'] as const) {
      const m = this.memory.get(hand)
      if (!m || timestamp - m.seenAt > MEMORY_MS) continue
      const dx = obs.center.x - m.x
      const dy = obs.center.y - m.y
      const distance = Math.sqrt(dx * dx + dy * dy)
      if (distance < CONTINUITY_DISTANCE && distance < bestDistance) {
        bestDistance = distance
        best = hand
      }
    }

    return best ?? obs.modelLabel
  }

  /** Índices das observações que sobrevivem à remoção de duplicatas. */
  private dedupe(observations: HandObservation[]): number[] {
    const kept: number[] = []
    for (let i = 0; i < observations.length; i++) {
      const a = observations[i]
      let duplicate = false
      for (const j of kept) {
        const b = observations[j]
        const dx = a.center.x - b.center.x
        const dy = a.center.y - b.center.y
        if (Math.sqrt(dx * dx + dy * dy) < DUPLICATE_DISTANCE) {
          duplicate = true
          // A duplicata de maior confiança substitui a que estava na lista.
          if (a.score > b.score) kept[kept.indexOf(j)] = i
          break
        }
      }
      if (!duplicate) kept.push(i)
    }
    return kept
  }

  reset(): void {
    this.memory.clear()
  }
}
