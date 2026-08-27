/**
 * Reconhecimento de gestos.
 *
 * Princípio de design do vocabulário: cada gesto reaproveita um gesto que a
 * pessoa já faz em trackpad ou celular, e todos são separáveis pela contagem de
 * dedos esticados — o que os torna difíceis de confundir entre si.
 *
 *   apontar (1 dedo) ....... mover o cursor
 *   pinça .................. clicar; segurando, arrastar
 *   dois dedos ............. rolar a página (igual ao trackpad)
 *   punho .................. clutch — congela o cursor para reposicionar o braço
 *   mão aberta ............. repouso, não faz nada
 *   polegar para o lado .... voltar / avançar no histórico
 *   duas pinças ............ zoom pela distância entre as mãos (igual ao celular)
 *
 * Assinaturas de dedos (polegar->mínimo): apontar=01000, dois=01100,
 * punho=00000, aberta=11111, polegar=10000. Sem sobreposição.
 */

import { Hysteresis, StableValue, clamp, mapRange } from './filters'
import { HandModel, extendedCount, fingerSignature } from './handModel'

export type GestureName =
  | 'idle'
  | 'open'
  | 'point'
  | 'pinch'
  | 'fist'
  | 'two'
  | 'thumb_left'
  | 'thumb_right'

/** Limiares da pinça, em unidades de palma (invariantes a distância da câmera). */
const PINCH_ON = 0.42
const PINCH_OFF = 0.62

/** Distância a partir da qual a pinça é considerada "totalmente aberta". */
const PINCH_OPEN = 1.0

export interface HandGesture {
  hand: 'left' | 'right'
  /** Gesto já estabilizado (exige alguns frames consecutivos). */
  gesture: GestureName
  /** Gesto do frame atual, sem estabilização — útil para depurar. */
  rawGesture: GestureName
  /** 0 = dedos afastados, 1 = pinça fechada. Contínuo. */
  pinchStrength: number
  pinching: boolean
  /** Ponto de controle do cursor em coordenadas de imagem 0..1. */
  pointer: { x: number; y: number }
  depth: number
  score: number
  model: HandModel
}

export interface GestureFrame {
  timestamp: number
  hands: HandGesture[]
  left: HandGesture | null
  right: HandGesture | null
  /** Distância entre os pontos de pinça das duas mãos, em unidades de palma. */
  twoHandSpread: number | null
  /** Verdadeiro quando as duas mãos estão pinçando — habilita o zoom. */
  twoHandPinch: boolean
}

/**
 * Estado persistente por mão. Precisa viver entre frames porque histerese e
 * estabilização são, por definição, memória.
 */
class HandState {
  pinch: Hysteresis
  stable: StableValue<GestureName>

  constructor() {
    this.pinch = new Hysteresis(PINCH_ON, PINCH_OFF)
    // 3 frames a ~30fps = ~100ms. Rápido o bastante para parecer instantâneo,
    // lento o bastante para descartar um frame espúrio do modelo.
    this.stable = new StableValue<GestureName>(3)
  }

  reset(): void {
    this.pinch.reset()
    this.stable.reset()
  }
}

export class GestureRecognizer {
  private states = new Map<'left' | 'right', HandState>()

  private stateFor(hand: 'left' | 'right'): HandState {
    let s = this.states.get(hand)
    if (!s) {
      s = new HandState()
      this.states.set(hand, s)
    }
    return s
  }

  /**
   * Classifica um único frame de uma mão.
   *
   * A ordem dos testes importa: a pinça é checada primeiro porque, com o
   * polegar tocando o indicador, a contagem de dedos fica ambígua — o indicador
   * dobra parcialmente e pode ser lido como esticado ou não.
   */
  private classify(h: HandModel, pinching: boolean): GestureName {
    if (pinching) return 'pinch'

    const sig = fingerSignature(h)
    const count = extendedCount(h)

    // Apontar: indicador esticado, médio e anelar fechados. O mínimo é ignorado
    // porque muita gente estica o dedinho sem perceber ao apontar.
    if (h.fingers.index.extended && h.fingers.middle.folded && h.fingers.ring.folded) {
      return 'point'
    }

    // Dois dedos: indicador e médio esticados e juntos, anelar e mínimo fechados.
    if (
      h.fingers.index.extended &&
      h.fingers.middle.extended &&
      h.fingers.ring.folded &&
      h.fingers.pinky.folded
    ) {
      return 'two'
    }

    // Polegar isolado apontando para o lado: navegação no histórico. Exige que
    // o polegar esteja claramente horizontal, para não capturar um punho
    // qualquer com o polegar solto.
    if (
      h.fingers.thumb.extended &&
      h.fingers.index.folded &&
      h.fingers.middle.folded &&
      h.fingers.ring.folded &&
      h.fingers.pinky.folded
    ) {
      const thumbDir = {
        x: h.landmarks[4].x - h.landmarks[2].x,
        y: h.landmarks[4].y - h.landmarks[2].y,
        z: 0,
      }
      const horizontal = Math.abs(thumbDir.x) > Math.abs(thumbDir.y) * 1.4
      if (horizontal) {
        return thumbDir.x < 0 ? 'thumb_left' : 'thumb_right'
      }
      return 'fist'
    }

    if (count === 0 || sig === '00000') return 'fist'
    if (count >= 4) return 'open'

    return 'idle'
  }

  process(models: HandModel[], timestamp: number): GestureFrame {
    const hands: HandGesture[] = []
    const seen = new Set<'left' | 'right'>()

    for (const model of models) {
      const state = this.stateFor(model.handedness)
      seen.add(model.handedness)

      const pinching = state.pinch.update(model.pinchDistance)
      const raw = this.classify(model, pinching)
      const gesture = state.stable.update(raw) ?? 'idle'

      // A força da pinça é o inverso da distância normalizada, o que dá um
      // valor contínuo para controlar zoom e para o feedback visual do cursor.
      const pinchStrength = 1 - clamp(mapRange(model.pinchDistance, PINCH_ON, PINCH_OPEN, 0, 1), 0, 1)

      // Ao pinçar, o ponto de controle passa a ser o meio da garra, não a ponta
      // do indicador: o indicador se desloca ao fechar a pinça, e usar a ponta
      // faria o cursor pular no exato instante do clique.
      const control = pinching ? model.pinchPoint : model.indexTip

      hands.push({
        hand: model.handedness,
        gesture,
        rawGesture: raw,
        pinchStrength,
        pinching,
        pointer: { x: control.x, y: control.y },
        depth: model.depth,
        score: model.score,
        model,
      })
    }

    // Mão que sumiu do quadro precisa ter o estado zerado, senão ela volta
    // com a histerese presa no valor de antes de desaparecer.
    for (const hand of ['left', 'right'] as const) {
      if (!seen.has(hand)) this.states.get(hand)?.reset()
    }

    const left = hands.find((h) => h.hand === 'left') ?? null
    const right = hands.find((h) => h.hand === 'right') ?? null

    let twoHandSpread: number | null = null
    let twoHandPinch = false
    if (left && right) {
      const dx = left.pointer.x - right.pointer.x
      const dy = left.pointer.y - right.pointer.y
      const avgPalm = (left.model.palmSize + right.model.palmSize) / 2
      twoHandSpread = Math.sqrt(dx * dx + dy * dy) / Math.max(avgPalm, 1e-6)
      twoHandPinch = left.pinching && right.pinching
    }

    return { timestamp, hands, left, right, twoHandSpread, twoHandPinch }
  }

  reset(): void {
    for (const s of this.states.values()) s.reset()
  }
}

/** Rótulos legíveis, usados no HUD. */
export const GESTURE_LABELS: Record<GestureName, string> = {
  idle: '—',
  open: 'Repouso',
  point: 'Apontar',
  pinch: 'Pinça',
  fist: 'Punho',
  two: 'Dois dedos',
  thumb_left: 'Polegar ←',
  thumb_right: 'Polegar →',
}
