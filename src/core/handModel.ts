/**
 * Modelo geométrico da mão: transforma 21 landmarks crus numa descrição
 * invariante a rotação, escala e distância da câmera.
 *
 * Por que isto existe: a abordagem ingênua ("a ponta do dedo tem Y menor que a
 * junta, logo está esticado") só funciona com a mão perfeitamente vertical e de
 * frente. Vire a mão de lado e todo dedo vira "dobrado". Limiares absolutos
 * ("pinça se a distância < 0.12") têm o mesmo defeito no eixo da profundidade:
 * afaste a mão da câmera e a mão inteira encolhe em coordenadas normalizadas,
 * então a pinça dispara sozinha.
 *
 * A solução é medir ÂNGULOS (invariantes a escala e rotação) e normalizar toda
 * distância pelo tamanho da própria palma (invariante a distância da câmera).
 */

export interface Vec3 {
  x: number
  y: number
  z: number
}

export const LM = {
  WRIST: 0,
  THUMB_CMC: 1,
  THUMB_MCP: 2,
  THUMB_IP: 3,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_PIP: 6,
  INDEX_DIP: 7,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  MIDDLE_PIP: 10,
  MIDDLE_DIP: 11,
  MIDDLE_TIP: 12,
  RING_MCP: 13,
  RING_PIP: 14,
  RING_DIP: 15,
  RING_TIP: 16,
  PINKY_MCP: 17,
  PINKY_PIP: 18,
  PINKY_DIP: 19,
  PINKY_TIP: 20,
} as const

export type FingerName = 'thumb' | 'index' | 'middle' | 'ring' | 'pinky'

export const FINGERS: Record<FingerName, readonly [number, number, number, number]> = {
  thumb: [LM.THUMB_CMC, LM.THUMB_MCP, LM.THUMB_IP, LM.THUMB_TIP],
  index: [LM.INDEX_MCP, LM.INDEX_PIP, LM.INDEX_DIP, LM.INDEX_TIP],
  middle: [LM.MIDDLE_MCP, LM.MIDDLE_PIP, LM.MIDDLE_DIP, LM.MIDDLE_TIP],
  ring: [LM.RING_MCP, LM.RING_PIP, LM.RING_DIP, LM.RING_TIP],
  pinky: [LM.PINKY_MCP, LM.PINKY_PIP, LM.PINKY_DIP, LM.PINKY_TIP],
}

// ---------------------------------------------------------------- vetores

export function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }
}

export function scale(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s }
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }
}

export function length(a: Vec3): number {
  return Math.sqrt(dot(a, a))
}

export function dist(a: Vec3, b: Vec3): number {
  return length(sub(a, b))
}

export function normalize(a: Vec3): Vec3 {
  const l = length(a)
  return l < 1e-9 ? { x: 0, y: 0, z: 0 } : scale(a, 1 / l)
}

/** Ângulo entre dois vetores, em graus. */
export function angleBetween(a: Vec3, b: Vec3): number {
  const la = length(a)
  const lb = length(b)
  if (la < 1e-9 || lb < 1e-9) return 0
  const c = Math.min(1, Math.max(-1, dot(a, b) / (la * lb)))
  return (Math.acos(c) * 180) / Math.PI
}

// ---------------------------------------------------------------- descrição

export interface FingerState {
  /** 0 = totalmente esticado, 1 = totalmente fechado. Contínuo, não booleano. */
  curl: number
  /** Soma dos ângulos das articulações, em graus. */
  angle: number
  extended: boolean
  folded: boolean
}

export interface HandModel {
  handedness: 'left' | 'right'
  /** Confiança do rastreamento, 0..1. */
  score: number
  /** Landmarks em coordenadas de imagem normalizadas (0..1), já espelhados. */
  landmarks: Vec3[]
  /** Landmarks métricos (metros, origem no centro da mão), se disponíveis. */
  world: Vec3[] | null
  fingers: Record<FingerName, FingerState>
  /** Escala da mão em unidades de imagem — usada para normalizar distâncias. */
  palmSize: number
  /** Centro da palma, coordenadas de imagem. */
  palmCenter: Vec3
  /** Normal da palma. Aponta para a câmera quando a mão está de frente. */
  palmNormal: Vec3
  /** Direção "para onde os dedos apontam", normalizada. */
  palmDirection: Vec3
  /** Distância polegar-indicador normalizada pela palma. ~0 fechado, ~1.2 aberto. */
  pinchDistance: number
  /** Ponto médio entre polegar e indicador — a "garra" do gesto de pinça. */
  pinchPoint: Vec3
  /** Ponta do indicador, coordenadas de imagem. */
  indexTip: Vec3
  /** Ponta do indicador com o ruído lateral removido. Ver `stabilizeTip`. */
  stableIndexTip: Vec3
  /** Profundidade relativa: cresce quando a mão se aproxima da câmera. */
  depth: number
}

/**
 * Tamanho da mão em unidades de imagem.
 *
 * Uso a maior das distâncias pulso->MCP-do-médio e largura da palma. Tomar a
 * maior evita que a escala colapse quando a mão está muito inclinada e uma das
 * medidas sofre encurtamento por perspectiva.
 */
function computePalmSize(lm: Vec3[]): number {
  const wristToMiddle = dist(lm[LM.WRIST], lm[LM.MIDDLE_MCP])
  const palmWidth = dist(lm[LM.INDEX_MCP], lm[LM.PINKY_MCP])
  return Math.max(wristToMiddle, palmWidth, 1e-6)
}

/**
 * Curvatura de um dedo pela soma dos ângulos das suas articulações.
 *
 * Totalmente invariante a rotação e escala: só depende da forma do dedo,
 * não de onde ele está nem de como a mão está virada.
 */
function computeFinger(lm: Vec3[], finger: FingerName): FingerState {
  const [a, b, c, d] = FINGERS[finger]
  const v1 = sub(lm[b], lm[a])
  const v2 = sub(lm[c], lm[b])
  const v3 = sub(lm[d], lm[c])

  const angle = angleBetween(v1, v2) + angleBetween(v2, v3)

  // O polegar articula muito menos que os outros dedos: ~90° já é o máximo
  // prático, contra ~180° dos demais. Escalas separadas evitam que o polegar
  // seja lido como permanentemente esticado.
  const maxAngle = finger === 'thumb' ? 90 : 160
  const curl = Math.min(1, angle / maxAngle)

  return {
    curl,
    angle,
    extended: curl < 0.35,
    folded: curl > 0.6,
  }
}

/**
 * Remove o ruído lateral da ponta do dedo projetando-a no eixo do próprio dedo.
 *
 * A ponta é o landmark mais ruidoso que o modelo produz: fica no fim da cadeia
 * cinemática e acumula o erro de todas as juntas antes dela. Como ela também é
 * o ponto de controle do cursor, esse erro é amplificado direto na tela.
 *
 * Um dedo esticado é aproximadamente reto, e essa restrição anatômica é
 * informação que podemos usar. Definimos o eixo por duas juntas internas — mais
 * estáveis, e escolhidas sem envolver a ponta — e projetamos a ponta sobre ele.
 * O deslocamento ao longo do dedo é preservado, que é o que dá a sensação de
 * apontar; o desvio perpendicular, que é quase todo ruído, desaparece.
 *
 * Só vale com o dedo esticado: dobrado, o eixo das juntas internas não aponta
 * para onde a ponta está, e a projeção pioraria a leitura.
 *
 * A força da projeção decai de forma CONTÍNUA conforme o dedo dobra, em vez
 * de desligar num degrau. Com um corte binário, um curl oscilando em torno do
 * limiar alternava o ponto de controle entre a ponta crua e a projetada — um
 * salto de vários pixels a cada alternância, que o resto do pipeline lia como
 * movimento da mão.
 */
function stabilizeTip(lm: Vec3[], indexCurl: number): Vec3 {
  const tip = lm[LM.INDEX_TIP]
  if (indexCurl > 0.5) return tip

  const mcp = lm[LM.INDEX_MCP]
  const dip = lm[LM.INDEX_DIP]

  const axis = sub(dip, mcp)
  const len = length(axis)
  if (len < 1e-6) return tip

  const dir = scale(axis, 1 / len)
  const along = dot(sub(tip, mcp), dir)
  const projected = add(mcp, scale(dir, along))

  // Mistura em vez de substituir: a projeção pura descarta qualquer desvio
  // real da ponta, e o dedo não é perfeitamente reto. 75% remove a maior parte
  // do tremor sem tornar o apontamento rígido demais. De curl 0.3 a 0.5 a
  // força desce em rampa até zero — é a rampa que elimina o degrau.
  const fade = Math.max(0, Math.min(1, 1 - (indexCurl - 0.3) / 0.2))
  const w = 0.75 * fade

  return {
    x: tip.x * (1 - w) + projected.x * w,
    y: tip.y * (1 - w) + projected.y * w,
    z: tip.z * (1 - w) + projected.z * w,
  }
}

/**
 * Constrói a descrição completa a partir dos landmarks de um frame.
 *
 * `landmarks` devem estar em coordenadas de imagem normalizadas e JÁ espelhados
 * horizontalmente (o vídeo é espelhado para o usuário, então a mão na tela deve
 * seguir a mão real).
 */
export function buildHandModel(
  landmarks: Vec3[],
  world: Vec3[] | null,
  handedness: 'left' | 'right',
  score: number,
): HandModel {
  const palmSize = computePalmSize(landmarks)

  const fingers: Record<FingerName, FingerState> = {
    thumb: computeFinger(landmarks, 'thumb'),
    index: computeFinger(landmarks, 'index'),
    middle: computeFinger(landmarks, 'middle'),
    ring: computeFinger(landmarks, 'ring'),
    pinky: computeFinger(landmarks, 'pinky'),
  }

  const wrist = landmarks[LM.WRIST]
  const indexMcp = landmarks[LM.INDEX_MCP]
  const pinkyMcp = landmarks[LM.PINKY_MCP]
  const middleMcp = landmarks[LM.MIDDLE_MCP]

  const palmCenter = scale(add(add(wrist, indexMcp), add(pinkyMcp, middleMcp)), 0.25)
  const palmDirection = normalize(sub(middleMcp, wrist))
  const acrossPalm = normalize(sub(pinkyMcp, indexMcp))

  // A ordem do produto vetorial depende da mão, senão a normal da mão esquerda
  // aponta para o lado oposto ao da direita com a palma na mesma direção.
  const palmNormal =
    handedness === 'right'
      ? normalize(cross(palmDirection, acrossPalm))
      : normalize(cross(acrossPalm, palmDirection))

  const thumbTip = landmarks[LM.THUMB_TIP]
  const indexTip = landmarks[LM.INDEX_TIP]
  const pinchDistance = dist(thumbTip, indexTip) / palmSize
  const pinchPoint = scale(add(thumbTip, indexTip), 0.5)

  // palmSize cresce conforme a mão se aproxima da câmera; é uma medida de
  // profundidade muito mais estável que o z bruto do MediaPipe, que é relativo
  // ao pulso e oscila bastante entre frames.
  const depth = palmSize

  return {
    handedness,
    score,
    landmarks,
    world,
    fingers,
    palmSize,
    palmCenter,
    palmNormal,
    palmDirection,
    pinchDistance,
    pinchPoint,
    indexTip,
    stableIndexTip: stabilizeTip(landmarks, fingers.index.curl),
    depth,
  }
}

/** Quantos dedos estão esticados (polegar incluído). */
export function extendedCount(h: HandModel): number {
  return (Object.keys(h.fingers) as FingerName[]).filter((f) => h.fingers[f].extended).length
}

/** Assinatura de dedos esticados, do polegar ao mínimo. Ex.: "01000" = apontando. */
export function fingerSignature(h: HandModel): string {
  const order: FingerName[] = ['thumb', 'index', 'middle', 'ring', 'pinky']
  return order.map((f) => (h.fingers[f].extended ? '1' : '0')).join('')
}
