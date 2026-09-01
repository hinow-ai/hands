/**
 * Escolha espacial de alvos: para qual retângulo a seleção pula quando a
 * pessoa empurra a mão numa direção.
 *
 * Puro e sem DOM de propósito, como o resto do motor: quem coleta os
 * retângulos da página é a camada de conteúdo; aqui só se decide, e decisão
 * se testa com retângulos sintéticos.
 *
 * O critério é o da navegação espacial clássica (setas de TV, spatial
 * navigation do W3C): na direção pedida, vence o candidato que mais progride
 * pouco e menos desvia para o lado — perto e alinhado ganha de longe e torto.
 * Um cone limita o desvio lateral: o que está essencialmente "de lado" não é
 * um candidato daquela direção, senão empurrar para a direita pularia para um
 * link acima.
 */

export type HopDirection = 'left' | 'right' | 'up' | 'down'

export interface SpatialRect {
  left: number
  top: number
  width: number
  height: number
}

/** Progresso mínimo na direção, em px — elimina o próprio alvo e sobrepostos. */
const MIN_PROGRESS = 4

/**
 * Quantiza o vetor do empurrão numa das quatro direções: o eixo dominante
 * decide. `dy` positivo é para baixo, como na tela.
 */
export function quantizeDirection(dx: number, dy: number): HopDirection {
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left'
  return dy > 0 ? 'down' : 'up'
}

const center = (r: SpatialRect) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 })

/**
 * Índice do melhor candidato na direção, ou -1 se nenhum serve.
 *
 * score = progresso + 2 × desvio lateral: o peso dobrado no desvio faz um
 * vizinho alinhado a 300 px ganhar de um desalinhado a 150 px — é o que faz o
 * pulo descer uma lista de links sem escapar para a coluna do lado.
 */
export function pickInDirection(
  from: SpatialRect,
  candidates: SpatialRect[],
  direction: HopDirection,
): number {
  const f = center(from)

  let best = -1
  let bestScore = Infinity

  for (let i = 0; i < candidates.length; i++) {
    const c = center(candidates[i])

    let progress: number
    let lateral: number
    switch (direction) {
      case 'right':
        progress = c.x - f.x
        lateral = Math.abs(c.y - f.y)
        break
      case 'left':
        progress = f.x - c.x
        lateral = Math.abs(c.y - f.y)
        break
      case 'down':
        progress = c.y - f.y
        lateral = Math.abs(c.x - f.x)
        break
      case 'up':
        progress = f.y - c.y
        lateral = Math.abs(c.x - f.x)
        break
    }

    if (progress < MIN_PROGRESS) continue
    // O cone: a folga fixa de 40 px deixa passar vizinhos quase alinhados
    // (linhas de texto não são réguas), e a proporção corta o que está mais
    // de lado do que à frente.
    if (lateral > progress * 1.6 + 40) continue

    const score = progress + lateral * 2
    if (score < bestScore) {
      bestScore = score
      best = i
    }
  }

  return best
}
