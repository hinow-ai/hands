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
  | { type: 'GN_CAMERA_STATUS'; status: CameraStatus; error?: string }
  | { type: 'GN_START_CAMERA' }
  | { type: 'GN_STOP_CAMERA' }
  | { type: 'GN_SET_CONFIG'; config: Partial<TuningConfig> }

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
}

export const DEFAULT_TUNING: TuningConfig = {
  activeWidth: 0.55,
  activeHeight: 0.5,
  minCutoff: 0.8,
  beta: 0.02,
  scrollGain: 2.6,
  showHud: true,
}
