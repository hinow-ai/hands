/**
 * Formato serializável trocado entre o processo que enxerga (offscreen, dono da
 * câmera e do modelo) e o que age (content script, dentro da página).
 *
 * O reconhecimento acontece do lado da câmera e só o resultado atravessa o IPC.
 * Mandar os 21 landmarks das duas mãos a cada frame significaria serializar e
 * desserializar ~130 números 30 vezes por segundo, em dois saltos de IPC — um
 * custo que aparece como atraso perceptível no cursor. O que a página precisa
 * saber cabe em poucos campos.
 */

import type { GestureName } from './gestures'

export interface HandSnapshot {
  hand: 'left' | 'right'
  gesture: GestureName
  pinching: boolean
  pinchStrength: number
  pointer: { x: number; y: number }
  depth: number
  score: number
  /** Para onde o indicador aponta, quando aponta claramente para cima ou baixo. */
  pointDirection: 'up' | 'down' | null
  /**
   * As cinco pontas de dedo — polegar, indicador, médio, anelar, mínimo — em
   * coordenadas normalizadas do quadro, já espelhadas.
   *
   * São dez números por mão, não os cento e trinta que mandar os 21 landmarks
   * custaria: o suficiente para desenhar o que está sendo rastreado, sem o peso
   * que motivou deixar o esqueleto inteiro de fora.
   */
  tips: { x: number; y: number }[]
}

export interface FrameSnapshot {
  timestamp: number
  hands: HandSnapshot[]
  left: HandSnapshot | null
  right: HandSnapshot | null
  twoHandSpread: number | null
  twoHandPinch: boolean
}

export const EMPTY_FRAME: FrameSnapshot = {
  timestamp: 0,
  hands: [],
  left: null,
  right: null,
  twoHandSpread: null,
  twoHandPinch: false,
}

/** Mensagens que circulam entre offscreen, service worker e content scripts. */
export type RuntimeMessage =
  | { type: 'GN_FRAME'; frame: FrameSnapshot }
  | { type: 'GN_ENABLE' }
  | { type: 'GN_DISABLE' }
  | { type: 'GN_TOGGLE' }
  | { type: 'GN_STATE'; enabled: boolean; cameraStatus: CameraStatus; error?: string }
  | { type: 'GN_QUERY_STATE' }
  /** Sonda se o content script já está presente numa aba. */
  | { type: 'GN_PING' }
  | { type: 'GN_CAMERA_STATUS'; status: CameraStatus; error?: string }
  | { type: 'GN_START_CAMERA' }
  | { type: 'GN_STOP_CAMERA' }
  | { type: 'GN_SET_CONFIG'; config: Partial<TuningConfig> }
  /** Pede a abertura da aba que concede acesso à câmera (ver src/permission). */
  | { type: 'GN_REQUEST_PERMISSION' }
  /** A aba de permissão conseguiu abrir a câmera: a origem está liberada. */
  | { type: 'GN_PERMISSION_GRANTED' }
  /** O documento offscreen subiu e já escuta comandos. */
  | { type: 'GN_OFFSCREEN_READY' }

export type CameraStatus = 'off' | 'starting' | 'running' | 'denied' | 'error'

/** Ajustes expostos ao usuário no popup. */
export interface TuningConfig {
  /** Fração do quadro usada como área ativa. Menor = menos movimento de braço. */
  activeWidth: number
  activeHeight: number
  /** Suavização com a mão parada. Menor = mais estável. */
  minCutoff: number
  /** Resposta ao movimento rápido. Maior = menos arrasto. */
  beta: number
  /** Ganho da rolagem. */
  scrollGain: number
  /** Mostrar o painel de estado na página. */
  showHud: boolean
  /** Mostrar o guia de gestos nos cantos inferiores, um painel por mão. */
  showGuide: boolean
  /** Desenhar as pontas dos dedos das duas mãos, uma cor por dedo. */
  showTips: boolean
}

export const DEFAULT_TUNING: TuningConfig = {
  activeWidth: 0.55,
  activeHeight: 0.5,
  minCutoff: 0.8,
  beta: 0.02,
  scrollGain: 2.6,
  showHud: true,
  showGuide: true,
  showTips: true,
}
