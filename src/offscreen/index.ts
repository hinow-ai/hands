/**
 * Processo que enxerga: dono da câmera, do modelo e do reconhecimento.
 *
 * Roda num documento offscreen — uma página invisível cuja origem é a própria
 * extensão. Isso importa por dois motivos práticos. A permissão de câmera é
 * pedida uma única vez, para a extensão, em vez de uma vez por site visitado.
 * E existe uma só instância da câmera e do modelo para o navegador inteiro, em
 * vez de uma por aba — o que seria inviável, já que a webcam é um recurso
 * exclusivo.
 *
 * O resultado do reconhecimento é publicado para o service worker, que o
 * encaminha à aba ativa.
 */

import { FilesetResolver, HandLandmarker, HandLandmarkerResult } from '@mediapipe/tasks-vision'
import { GestureRecognizer } from '../core/gestures'
import { buildHandModel, Vec3 } from '../core/handModel'
import { CameraStatus, FrameSnapshot, HandSnapshot, RuntimeMessage } from '../core/wire'

const TARGET_FPS = 30
const FRAME_INTERVAL = 1000 / TARGET_FPS

/** Índices das pontas no esqueleto do MediaPipe: polegar a mínimo, nessa ordem. */
const FINGERTIPS = [4, 8, 12, 16, 20]

let landmarker: HandLandmarker | null = null
let stream: MediaStream | null = null
let video: HTMLVideoElement | null = null
let running = false
let loopTimer = 0
let lastVideoTime = -1
let monotonicTimestamp = 0

const recognizer = new GestureRecognizer()

function report(status: CameraStatus, error?: string): void {
  const message: RuntimeMessage = { type: 'GN_CAMERA_STATUS', status, error }
  chrome.runtime.sendMessage(message).catch(() => {
    // O service worker pode estar hibernando; ele consulta o estado ao acordar.
  })
}

async function createLandmarker(): Promise<HandLandmarker> {
  const vision = await FilesetResolver.forVisionTasks(chrome.runtime.getURL('wasm'))

  const options = {
    baseOptions: {
      modelAssetPath: chrome.runtime.getURL('models/hand_landmarker.task'),
      delegate: 'GPU' as const,
    },
    runningMode: 'VIDEO' as const,
    // Uma mão: o vocabulário atual tem um só comando, e pedir duas dobra o
    // custo de inferência e abre a porta para o defeito clássico do MediaPipe
    // de detectar a mesma mão duas vezes — uma como Left, outra como Right —
    // criando uma segunda mão fantasma num gesto qualquer.
    numHands: 1,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  }

  try {
    const gpu = await HandLandmarker.createFromOptions(vision, options)
    console.info('[gesture-nav] modelo carregado na GPU')
    return gpu
  } catch (err) {
    // Nem todo ambiente dá WebGL a um documento invisível. A CPU sustenta 30fps
    // com folga para duas mãos, então a queda de desempenho é aceitável.
    //
    // Este aviso é esperado e não indica falha: quem falha de verdade aparece
    // como erro no `start()`. Dizê-lo aqui evita que o ruído no console seja
    // confundido com a causa de a extensão não ligar.
    console.info('[gesture-nav] sem WebGL no documento offscreen — caindo para CPU (normal):', err)
    const cpu = await HandLandmarker.createFromOptions(vision, {
      ...options,
      baseOptions: { ...options.baseOptions, delegate: 'CPU' as const },
    })
    console.info('[gesture-nav] modelo carregado na CPU')
    return cpu
  }
}

/**
 * Converte a saída do modelo em modelos de mão e daí em gestos.
 *
 * Dois ajustes acontecem aqui. Os landmarks são espelhados no eixo X porque a
 * pessoa se vê espelhada e espera que mover a mão para a direita mova o cursor
 * para a direita. E o rótulo da mão é invertido: o modelo classifica assumindo
 * uma imagem não espelhada, então o que ele chama de "Left" é a mão direita de
 * quem está na frente da câmera.
 */
function toSnapshot(result: HandLandmarkerResult, timestamp: number): FrameSnapshot {
  const models = []

  for (let i = 0; i < result.landmarks.length; i++) {
    const raw = result.landmarks[i]
    const category = result.handedness[i]?.[0]
    if (!raw || !category) continue

    const mirrored: Vec3[] = raw.map((p) => ({ x: 1 - p.x, y: p.y, z: p.z ?? 0 }))
    const world: Vec3[] | null =
      result.worldLandmarks?.[i]?.map((p) => ({ x: -p.x, y: p.y, z: p.z ?? 0 })) ?? null

    const handedness: 'left' | 'right' = category.categoryName === 'Left' ? 'right' : 'left'
    models.push(buildHandModel(mirrored, world, handedness, category.score ?? 1))
  }

  const frame = recognizer.process(models, timestamp)

  const pack = (h: (typeof frame.hands)[number] | null): HandSnapshot | null =>
    h
      ? {
          hand: h.hand,
          gesture: h.gesture,
          pinching: h.pinching,
          pinchStrength: h.pinchStrength,
          pointer: h.pointer,
          depth: h.depth,
          score: h.score,
          pointDirection: h.pointDirection,
          tips: FINGERTIPS.map((i) => {
            const p = h.model.landmarks[i]
            return p ? { x: p.x, y: p.y } : { x: 0, y: 0 }
          }),
        }
      : null

  const hands = frame.hands.map((h) => pack(h)!).filter(Boolean)

  return {
    timestamp,
    hands,
    left: pack(frame.left),
    right: pack(frame.right),
    twoHandSpread: frame.twoHandSpread,
    twoHandPinch: frame.twoHandPinch,
  }
}

function tick(): void {
  if (!running || !video || !landmarker) return

  // Só processa quando há um frame novo: reprocessar o mesmo quadro gasta CPU
  // e faz o filtro temporal receber amostras duplicadas, o que introduz um
  // atraso artificial no cursor.
  if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime

    // O modelo exige timestamps estritamente crescentes; performance.now() pode
    // repetir em frames muito próximos, então garantimos o avanço.
    const now = performance.now()
    monotonicTimestamp = Math.max(now, monotonicTimestamp + 1)

    try {
      const result = landmarker.detectForVideo(video, monotonicTimestamp)
      const snapshot = toSnapshot(result, now)
      const message: RuntimeMessage = { type: 'GN_FRAME', frame: snapshot }
      chrome.runtime.sendMessage(message).catch(() => {})
    } catch (err) {
      console.error('[gesture-nav] falha na inferência:', err)
    }
  }

  loopTimer = self.setTimeout(tick, FRAME_INTERVAL)
}

async function start(): Promise<void> {
  // Um segundo pedido com a câmera já rodando não é erro: o service worker pode
  // ter perdido o estado e estar reconstruindo o que já existe. Reafirmar o
  // status é o que evita que ele fique achando que nada subiu.
  if (running) {
    report('running')
    return
  }
  report('starting')

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 30 },
        facingMode: 'user',
      },
      audio: false,
    })
  } catch (err) {
    const name = (err as Error)?.name
    console.error('[gesture-nav] a câmera não abriu:', err)
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
      report('denied', 'Permissão de câmera negada')
    } else {
      report('error', (err as Error)?.message ?? 'Falha ao abrir a câmera')
    }
    return
  }

  video = document.getElementById('cam') as HTMLVideoElement
  video.srcObject = stream
  await video.play()

  if (!landmarker) {
    try {
      landmarker = await createLandmarker()
    } catch (err) {
      // O status vai para o popup, mas quem abre o console do offscreen para
      // investigar precisa do objeto inteiro — a mensagem sozinha costuma
      // omitir a causa real.
      console.error('[gesture-nav] o modelo não carregou:', err)
      report('error', `Falha ao carregar o modelo: ${(err as Error)?.message ?? err}`)
      stop()
      return
    }
  }

  recognizer.reset()
  lastVideoTime = -1
  running = true
  report('running')
  tick()
}

function stop(): void {
  running = false
  clearTimeout(loopTimer)

  if (stream) {
    // Parar cada track é o que apaga a luz da webcam; soltar a referência não basta.
    for (const track of stream.getTracks()) track.stop()
    stream = null
  }
  if (video) {
    video.srcObject = null
  }
  recognizer.reset()
  report('off')
}

chrome.runtime.onMessage.addListener((message: RuntimeMessage) => {
  if (message?.type === 'GN_START_CAMERA') {
    void start()
  } else if (message?.type === 'GN_STOP_CAMERA') {
    stop()
  }
})

/**
 * Anuncia que o documento subiu.
 *
 * `createDocument()` resolve para quem criou, mas quem cria não tem como saber
 * se este script já registrou o listener acima — e um `GN_START_CAMERA` enviado
 * antes disso simplesmente se perde, deixando a extensão ligada e cega. Em vez
 * de depender do tempo, o anúncio parte daqui: o service worker responde
 * mandando iniciar, se for para estar ligado.
 */
report('off')
chrome.runtime.sendMessage({ type: 'GN_OFFSCREEN_READY' } satisfies RuntimeMessage).catch(() => {})
