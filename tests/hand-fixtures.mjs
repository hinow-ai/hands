/**
 * Gerador de mãos sintéticas para teste.
 *
 * Constrói os 21 landmarks a partir de parâmetros anatômicos — quanto cada dedo
 * está dobrado, e onde a mão está no espaço. Isso permite testar o detector com
 * entradas exatas e reprodutíveis, em vez de depender de gravações de webcam.
 *
 * A cadeia de cada dedo é montada articulação por articulação: cada falange
 * parte da anterior, girada pelo ângulo de dobra acumulado. É a mesma mecânica
 * de um dedo real, o que faz os ângulos medidos pelo detector baterem com os
 * ângulos que pedimos aqui.
 */

/** Proporções aproximadas de uma mão, em unidades de palma. */
const PALM = {
  // Base de cada dedo, relativa ao pulso na origem. Y negativo = para cima.
  mcp: {
    index: { x: -0.28, y: -0.92 },
    middle: { x: -0.06, y: -1.0 },
    ring: { x: 0.15, y: -0.96 },
    pinky: { x: 0.34, y: -0.84 },
  },
  // Comprimento das três falanges de cada dedo.
  segments: {
    index: [0.42, 0.26, 0.2],
    middle: [0.46, 0.29, 0.21],
    ring: [0.42, 0.27, 0.2],
    pinky: [0.33, 0.21, 0.18],
  },
}

function rotate(v, radians) {
  const c = Math.cos(radians)
  const s = Math.sin(radians)
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c }
}

/**
 * Monta a cadeia de um dedo.
 * `curl` de 0 (reto) a 1 (fechado sobre a palma).
 */
function buildFinger(name, curl) {
  const base = PALM.mcp[name]
  const segments = PALM.segments[name]

  // 100° por junta com o dedo totalmente fechado: um dedo dobrado ao máximo
  // soma pouco mais de 180° entre as duas juntas medidas pelo detector.
  const perJoint = (curl * 100 * Math.PI) / 180

  const points = [{ ...base }]
  let direction = { x: 0, y: -1 }
  let cursor = { ...base }

  for (let i = 0; i < segments.length; i++) {
    // A primeira falange já sai dobrada em relação à palma; as seguintes
    // acumulam a dobra da anterior.
    direction = rotate(direction, perJoint)
    cursor = {
      x: cursor.x + direction.x * segments[i],
      y: cursor.y + direction.y * segments[i],
    }
    points.push({ ...cursor })
  }
  return points
}

/**
 * Polegar: sai lateralmente da base da palma e tem amplitude menor.
 * `curl` 0 = afastado da palma, 1 = cruzando a palma.
 */
function buildThumb(curl, side = 'right') {
  // O polegar da mão direita, na imagem espelhada, aponta para a esquerda.
  const lateral = side === 'right' ? -1 : 1

  const cmc = { x: lateral * 0.18, y: -0.12 }
  const segments = [0.3, 0.24, 0.2]

  const spreadAngle = (-40 * Math.PI) / 180
  const perJoint = (curl * 45 * Math.PI) / 180

  let direction = rotate({ x: lateral * 0.75, y: -0.66 }, lateral * spreadAngle * curl)
  const points = [{ ...cmc }]
  let cursor = { ...cmc }

  for (let i = 0; i < segments.length; i++) {
    direction = rotate(direction, lateral * perJoint)
    cursor = {
      x: cursor.x + direction.x * segments[i],
      y: cursor.y + direction.y * segments[i],
    }
    points.push({ ...cursor })
  }
  return points
}

/**
 * Monta os 21 landmarks na ordem do MediaPipe.
 *
 * `curls` aceita 0..1 por dedo. `transform` aplica rotação, escala e
 * deslocamento globais — é o que permite verificar que o detector não depende
 * da orientação nem do tamanho aparente da mão.
 */
export function makeHand({
  thumb = 0,
  index = 0,
  middle = 0,
  ring = 0,
  pinky = 0,
  side = 'right',
  rotation = 0,
  scale = 0.22,
  center = { x: 0.5, y: 0.5 },
  pinch = null,
} = {}) {
  const chains = {
    thumb: buildThumb(thumb, side),
    index: buildFinger('index', index),
    middle: buildFinger('middle', middle),
    ring: buildFinger('ring', ring),
    pinky: buildFinger('pinky', pinky),
  }

  // Para uma pinça, aproximamos as pontas do polegar e do indicador de um ponto
  // comum, que é a forma da mão quando os dois se tocam.
  if (pinch !== null) {
    const meeting = { x: (side === 'right' ? -0.16 : 0.16), y: -0.78 }
    const gap = pinch
    chains.thumb[3] = { x: meeting.x - gap / 2, y: meeting.y }
    chains.index[3] = { x: meeting.x + gap / 2, y: meeting.y }
  }

  const ordered = [
    { x: 0, y: 0 }, // 0 pulso
    ...chains.thumb, // 1-4
    ...chains.index, // 5-8
    ...chains.middle, // 9-12
    ...chains.ring, // 13-16
    ...chains.pinky, // 17-20
  ]

  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)

  return ordered.map((p) => ({
    x: center.x + (p.x * cos - p.y * sin) * scale,
    y: center.y + (p.x * sin + p.y * cos) * scale,
    z: 0,
  }))
}

/** Poses do vocabulário, nos parâmetros do gerador. */
export const POSES = {
  open: { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 },
  fist: { thumb: 1, index: 1, middle: 1, ring: 1, pinky: 1 },
  point: { thumb: 1, index: 0, middle: 1, ring: 1, pinky: 1 },
  two: { thumb: 1, index: 0, middle: 0, ring: 1, pinky: 1 },
  thumbSide: { thumb: 0, index: 1, middle: 1, ring: 1, pinky: 1 },
  pinch: { thumb: 0.3, index: 0.3, middle: 1, ring: 1, pinky: 1, pinch: 0.06 },
}
