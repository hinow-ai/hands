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

export type PointDirection = 'up' | 'down' | 'left' | 'right'

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
  /**
   * Para onde o indicador aponta, quando aponta claramente para um dos quatro
   * lados. Fica fora de `gesture` de propósito: o gesto é invariante a rotação
   * — apontar é apontar em qualquer ângulo — e a direção é justamente o que
   * depende do ângulo. Misturar os dois faria o reconhecimento de "apontar"
   * deixar de ser invariante.
   */
  pointDirection: PointDirection | null
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
  /** A direção passa pela mesma confirmação do gesto — ver `pointDirection`. */
  direction: StableValue<PointDirection | 'none'>

  constructor() {
    this.pinch = new Hysteresis(PINCH_ON, PINCH_OFF)
    // 3 frames a ~30fps = ~100ms. Rápido o bastante para parecer instantâneo,
    // lento o bastante para descartar um frame espúrio do modelo.
    this.stable = new StableValue<GestureName>(3)
    this.direction = new StableValue<PointDirection | 'none'>(3)
  }

  reset(): void {
    this.pinch.reset()
    this.stable.reset()
    this.direction.reset()
  }
}

/**
 * Para onde o indicador aponta, nas quatro direções.
 *
 * Mede o eixo da junta da base à ponta, e não a inclinação da mão inteira: é o
 * dedo que aponta, e o pulso pode estar em qualquer ângulo. Um eixo só vale
 * quando domina o outro com folga (1.4×): a banda morta larga na diagonal é o
 * que impede "para cima" e "para o lado" de se confundirem no meio do
 * caminho — direções que hoje disparam ações diferentes (clicar e voltar).
 *
 * O limiar de comprimento usa o tamanho da palma como unidade, então vale igual
 * com a mão perto ou longe da câmera. Um dedo apontado para a própria câmera se
 * projeta curto na imagem, e é exatamente esse caso que precisa ser recusado.
 */
function pointingDirection(h: HandModel): PointDirection | null {
  const base = h.landmarks[5]
  const tip = h.landmarks[8]
  if (!base || !tip) return null

  const dx = tip.x - base.x
  const dy = tip.y - base.y

  if (Math.abs(dy) > Math.abs(dx) * 1.4) {
    if (Math.abs(dy) < h.palmSize * 0.3) return null
    // y cresce para baixo na imagem: ponta acima da junta é apontar para cima.
    return dy < 0 ? 'up' : 'down'
  }
  if (Math.abs(dx) > Math.abs(dy) * 1.4) {
    if (Math.abs(dx) < h.palmSize * 0.3) return null
    return dx > 0 ? 'right' : 'left'
  }
  return null
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

    // Apontar: indicador esticado e os dois vizinhos NÃO esticados. Exigir que
    // médio e anelar estivessem totalmente dobrados (curl > 0.6) deixava a pose
    // natural de apontar sem classe nenhuma: o anelar compartilha tendão com o
    // médio e raramente passa de meio caminho com o indicador esticado. A zona
    // intermediária conta a favor do gesto — o que a intenção diz é "só o
    // indicador", não "os outros em ângulo máximo". O mínimo é ignorado porque
    // muita gente o estica sem perceber ao apontar.
    if (h.fingers.index.extended && !h.fingers.middle.extended && !h.fingers.ring.extended) {
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
      const control = pinching ? model.pinchPoint : model.stableIndexTip

      const rawDirection = pointingDirection(model) ?? 'none'
      const direction = state.direction.update(rawDirection) ?? 'none'

      hands.push({
        hand: model.handedness,
        gesture,
        rawGesture: raw,
        pinchStrength,
        pinching,
        pointer: { x: control.x, y: control.y },
        depth: model.depth,
        score: model.score,
        pointDirection: direction === 'none' ? null : direction,
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
  idle: '·',
  open: 'Repouso',
  point: 'Apontar',
  pinch: 'Pinça',
  fist: 'Punho',
  two: 'Dois dedos',
  thumb_left: 'Polegar ←',
  thumb_right: 'Polegar →',
}

/** Os quatro desenhos de mão da interface. Ver `scripts/prepare-art.py`. */
export type HandArt = 'open' | 'fist' | 'point' | 'side'

/**
 * Um comando: o identificador que o controlador acende, o que ele faz e como
 * formá-lo com a mão.
 *
 * `action` e `fingers` são CHAVES de tradução, não texto. O core não fala
 * idioma nenhum — quem resolve é a camada que desenha, com `chrome.i18n`, que
 * por sua vez segue o idioma do navegador. Guardar texto pronto aqui obrigaria
 * o motor a conhecer o idioma e quebraria os testes, que rodam em Node puro,
 * onde `chrome` não existe.
 */
export interface CommandEntry {
  id: CommandId
  /** Qual desenho ilustra a pose. O mesmo arquivo serve ao popup e à tela. */
  art: HandArt
  /**
   * Espelhar o desenho na horizontal. A arte lateral aponta para a direita, e
   * um segundo arquivo espelhado só duplicaria manutenção.
   */
  flip?: boolean
  /** Chave i18n do que o comando faz. */
  action: string
  /** Chave i18n da pose — é o que se aprende a fazer. */
  fingers: string
}

export type CommandId =
  | 'scroll_down'
  | 'scroll_up'
  | 'stop'
  | 'next_link'
  | 'prev_link'
  | 'click'
  | 'rest'
  | 'page_next'
  | 'page_prev'

/**
 * O vocabulário ativo, uma lista por mão. Papéis fixos, decididos pela
 * posição da mão em relação ao corpo (ver `HandAssigner`): a esquerda rola, a
 * direita clica.
 *
 * A escolha das poses não é estética. Mão aberta e punho são as duas mais
 * separáveis que o rastreador produz: a aberta exige só 4 dos 5 dedos lidos
 * como esticados (tolera um dedo mal rastreado), o punho exige zero, e entre
 * elas há uma zona morta larga onde um frame ruim não vira comando nenhum.
 * A direita não mira: ESCOLHE. A seleção anda de link em link na ordem de
 * leitura — mão aberta avança, indicador para o lado volta — e o indicador
 * para cima sustentado por 2 s clica no que está selecionado. O punho para
 * tudo, nas DUAS mãos: a pose de descanso é a mesma em todo o vocabulário.
 * Ninguém precisa levar um cursor até um alvo: apontar-e-acertar é a tarefa
 * motora mais difícil que uma interface pode pedir, e é exatamente a que
 * este vocabulário elimina.
 *
 * O apontar para cima da esquerda exige a direção do dedo além da pose —
 * apontar para baixo não sobe a tela — e uma sustentação curta no
 * controlador, porque fechar a mão aberta passa por um "apontar" transitório.
 *
 * Estas listas são a fonte única: o guia na tela é montado a partir delas e o
 * controlador acende `id`s daqui. Um comando que existe num lugar e não no
 * outro é o que os testes impedem.
 */
/**
 * As listas são por PAPEL, não por mão. Qual mão cumpre qual papel é uma
 * escolha de quem usa — ver o modo canhoto em `TuningConfig.leftHanded` —, e
 * amarrar o vocabulário à mão obrigaria a duplicar tudo para inverter.
 *
 * `next_link` aparece nos DOIS papéis de propósito: avançar é a ação mais
 * frequente da navegação, e dois caminhos motores para o mesmo comando é
 * redundância a favor de quem tem controle limitado de uma das mãos.
 */
export const COMMANDS_SCROLL: CommandEntry[] = [
  { id: 'scroll_down', art: 'open', action: 'cmdScrollDown', fingers: 'poseOpen' },
  { id: 'scroll_up', art: 'point', action: 'cmdScrollUp', fingers: 'posePointUp' },
  { id: 'next_link', art: 'side', action: 'cmdNextLink', fingers: 'poseSide' },
  { id: 'stop', art: 'fist', action: 'cmdStop', fingers: 'poseStopBoth' },
]

export const COMMANDS_ACTION: CommandEntry[] = [
  { id: 'next_link', art: 'open', action: 'cmdNextLink', fingers: 'poseOpen' },
  // Espelhada: esta mão volta, e um desenho apontando para trás diz isso sem
  // depender de ler o texto ao lado.
  { id: 'prev_link', art: 'side', flip: true, action: 'cmdPrevLink', fingers: 'poseSide' },
  { id: 'click', art: 'point', action: 'cmdClick', fingers: 'poseClickHold' },
  { id: 'rest', art: 'fist', action: 'cmdStop', fingers: 'poseStopBoth' },
]

/** A troca de página é a única ação de duas mãos; por isso fica à parte. */
export const COMMANDS_BOTH: CommandEntry[] = [
  { id: 'page_next', art: 'side', action: 'pageNext', fingers: 'pageNextPose' },
  { id: 'page_prev', art: 'side', flip: true, action: 'pagePrev', fingers: 'pagePrevPose' },
]
