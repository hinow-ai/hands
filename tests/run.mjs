/**
 * Testes do motor de gestos.
 *
 * Verificam as três propriedades de que todo o resto depende: cada pose do
 * vocabulário é reconhecida; o reconhecimento não muda quando a mão gira ou
 * muda de tamanho aparente; e os filtros fazem o que prometem.
 *
 * A invariância é o ponto central. É exatamente o que faltava no protótipo
 * anterior, e é fácil de afirmar sem verificar — daí testar cada pose em vários
 * ângulos e escalas, em vez de uma vez na orientação ideal.
 */

import { build } from 'esbuild'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeHand, POSES } from './hand-fixtures.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

let passed = 0
let failed = 0
const failures = []

function check(name, condition, detail = '') {
  if (condition) {
    passed++
  } else {
    failed++
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
  }
}

/** Compila o core para ESM temporário, para poder importar em Node puro. */
async function loadCore() {
  const dir = await mkdtemp(join(tmpdir(), 'gesture-nav-test-'))
  const entry = join(dir, 'entry.ts')
  const out = join(dir, 'core.mjs')

  await writeFile(
    entry,
    `export * from '${join(root, 'src/core/handModel').replace(/\\/g, '/')}'
     export * from '${join(root, 'src/core/gestures').replace(/\\/g, '/')}'
     export * from '${join(root, 'src/core/filters').replace(/\\/g, '/')}'
     export * from '${join(root, 'src/core/pointer').replace(/\\/g, '/')}'`,
  )

  await build({
    entryPoints: [entry],
    outfile: out,
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: ['node20'],
    logLevel: 'silent',
  })

  const mod = await import(`file://${out}`)
  return { mod, cleanup: () => rm(dir, { recursive: true, force: true }) }
}

/** Passa uma pose estática pelo reconhecedor até o gesto estabilizar. */
function settle(recognizer, buildModel, landmarks, handedness = 'right') {
  let frame
  for (let i = 0; i < 6; i++) {
    const model = buildModel(landmarks, null, handedness, 1)
    frame = recognizer.process([model], i * 33)
  }
  return frame
}

async function main() {
  const { mod, cleanup } = await loadCore()
  const {
    buildHandModel,
    GestureRecognizer,
    OneEuroFilter,
    Hysteresis,
    StableValue,
    ScrollMomentum,
    fingerSignature,
  } = mod

  // ---------------------------------------------------- poses básicas

  const expectations = [
    ['open', POSES.open, 'open'],
    ['fist', POSES.fist, 'fist'],
    ['point', POSES.point, 'point'],
    ['two', POSES.two, 'two'],
    ['pinch', POSES.pinch, 'pinch'],
  ]

  for (const [label, pose, expected] of expectations) {
    const recognizer = new GestureRecognizer()
    const hand = makeHand({ ...pose })
    const frame = settle(recognizer, buildHandModel, hand)
    const got = frame.right?.gesture
    check(
      `pose "${label}" reconhecida`,
      got === expected,
      `esperado ${expected}, veio ${got} (assinatura ${fingerSignature(frame.right.model)})`,
    )
  }

  // ---------------------------------------------------- invariância a rotação

  // A rotação é o caso que quebrava o detector anterior por completo: ele
  // comparava coordenadas Y, então bastava virar a mão de lado.
  const angles = [-90, -45, -20, 0, 20, 45, 90, 135, 180]
  for (const [label, pose, expected] of expectations) {
    let ok = 0
    const wrong = []
    for (const deg of angles) {
      const recognizer = new GestureRecognizer()
      const hand = makeHand({ ...pose, rotation: (deg * Math.PI) / 180 })
      const frame = settle(recognizer, buildHandModel, hand)
      if (frame.right?.gesture === expected) ok++
      else wrong.push(`${deg}°:${frame.right?.gesture}`)
    }
    check(
      `pose "${label}" estável sob rotação`,
      ok === angles.length,
      `${ok}/${angles.length} ângulos corretos — falhou em ${wrong.join(', ')}`,
    )
  }

  // ---------------------------------------------------- invariância a escala

  // Escala simula distância da câmera. Limiares absolutos, como o `< 0.12` do
  // protótipo antigo, disparam pinça sozinhos quando a mão se afasta.
  const scales = [0.1, 0.15, 0.22, 0.35, 0.5]
  for (const [label, pose, expected] of expectations) {
    let ok = 0
    const wrong = []
    for (const scale of scales) {
      const recognizer = new GestureRecognizer()
      const hand = makeHand({ ...pose, scale })
      const frame = settle(recognizer, buildHandModel, hand)
      if (frame.right?.gesture === expected) ok++
      else wrong.push(`${scale}:${frame.right?.gesture}`)
    }
    check(
      `pose "${label}" estável sob escala`,
      ok === scales.length,
      `${ok}/${scales.length} escalas corretas — falhou em ${wrong.join(', ')}`,
    )
  }

  // ---------------------------------------------------- pinça é contínua

  {
    const recognizer = new GestureRecognizer()
    const wide = makeHand({ ...POSES.pinch, pinch: 0.9 })
    const tight = makeHand({ ...POSES.pinch, pinch: 0.04 })

    const wideFrame = settle(recognizer, buildHandModel, wide)
    const r2 = new GestureRecognizer()
    const tightFrame = settle(r2, buildHandModel, tight)

    check(
      'pinça aberta não dispara clique',
      wideFrame.right?.pinching === false,
      `pinching=${wideFrame.right?.pinching}, dist=${wideFrame.right?.model.pinchDistance.toFixed(3)}`,
    )
    check(
      'pinça fechada dispara',
      tightFrame.right?.pinching === true,
      `pinching=${tightFrame.right?.pinching}, dist=${tightFrame.right?.model.pinchDistance.toFixed(3)}`,
    )
    check(
      'força da pinça cresce ao fechar',
      tightFrame.right?.pinchStrength > wideFrame.right?.pinchStrength,
      `${wideFrame.right?.pinchStrength.toFixed(2)} -> ${tightFrame.right?.pinchStrength.toFixed(2)}`,
    )
  }

  // ---------------------------------------------------- histerese

  {
    const h = new Hysteresis(0.42, 0.62)
    h.update(0.8)
    check('histerese começa desligada', h.value === false)
    h.update(0.4)
    check('histerese liga abaixo do limiar', h.value === true)
    h.update(0.5)
    check('histerese não desliga na zona morta', h.value === true, 'oscilação viraria clique duplo')
    h.update(0.7)
    check('histerese desliga acima do limiar de saída', h.value === false)
  }

  // ---------------------------------------------------- estabilização

  {
    const s = new StableValue(3)
    s.update('a')
    s.update('a')
    check('não confirma antes de 3 amostras', s.value === null)
    s.update('a')
    check('confirma na 3ª amostra', s.value === 'a')
    s.update('b')
    check('valor confirmado resiste a um frame espúrio', s.value === 'a')
  }

  // ---------------------------------------------------- One Euro

  {
    // Ruído em torno de um valor fixo deve ser fortemente atenuado.
    const f = new OneEuroFilter({ minCutoff: 0.8, beta: 0.02 })
    let maxDeviation = 0
    for (let i = 0; i < 60; i++) {
      // Ruído determinístico, para o teste não depender de aleatoriedade.
      const noise = Math.sin(i * 2.3) * 3
      const out = f.filter(500 + noise, i * 33)
      if (i > 20) maxDeviation = Math.max(maxDeviation, Math.abs(out - 500))
    }
    check(
      'One Euro suprime tremor com a mão parada',
      maxDeviation < 1.2,
      `desvio máximo ${maxDeviation.toFixed(2)}px para ruído de ±3px`,
    )

    // Um movimento amplo e rápido precisa ser acompanhado, não amortecido.
    const g = new OneEuroFilter({ minCutoff: 0.8, beta: 0.02 })
    let out = 0
    for (let i = 0; i < 12; i++) {
      out = g.filter(i * 60, i * 33)
    }
    const target = 11 * 60
    check(
      'One Euro acompanha movimento rápido',
      out > target * 0.8,
      `chegou a ${out.toFixed(0)} de ${target} após 12 frames`,
    )
  }

  // ---------------------------------------------------- inércia da rolagem

  {
    const m = new ScrollMomentum()
    let t = 0
    for (let i = 0; i < 5; i++) {
      t += 16
      m.push(20, t)
    }
    m.release()

    let total = 0
    let steps = 0
    for (let i = 0; i < 200; i++) {
      t += 16
      const d = m.step(t)
      total += d
      if (d !== 0) steps++
      if (d === 0 && i > 5) break
    }
    check('inércia continua rolando após soltar', total > 50, `deslocou ${total.toFixed(0)}px`)
    check('inércia termina, não roda para sempre', steps < 200, `parou após ${steps} frames`)
  }

  // ---------------------------------------------------- duas mãos

  {
    const recognizer = new GestureRecognizer()
    const right = makeHand({ ...POSES.pinch, side: 'right', center: { x: 0.35, y: 0.5 } })
    const left = makeHand({ ...POSES.pinch, side: 'left', center: { x: 0.65, y: 0.5 } })

    let frame
    for (let i = 0; i < 6; i++) {
      frame = recognizer.process(
        [
          buildHandModel(right, null, 'right', 1),
          buildHandModel(left, null, 'left', 1),
        ],
        i * 33,
      )
    }

    check('duas mãos detectadas', frame.hands.length === 2, `veio ${frame.hands.length}`)
    check('pinça dupla habilita zoom', frame.twoHandPinch === true)
    check(
      'distância entre as mãos é medida',
      typeof frame.twoHandSpread === 'number' && frame.twoHandSpread > 0,
      `spread=${frame.twoHandSpread}`,
    )
  }

  // ---------------------------------------------------- ponta estabilizada

  {
    // Injeta ruído lateral só na ponta do indicador e mede quanto sobra no
    // ponto de controle. É o ruído que o modelo real produz nesse landmark.
    const base = makeHand({ ...POSES.point })

    let rawSpread = 0
    let stableSpread = 0
    const rawXs = []
    const stableXs = []

    for (let i = 0; i < 40; i++) {
      const noisy = base.map((p, idx) => {
        if (idx !== 8) return p
        // Perturbação determinística, perpendicular ao eixo do dedo.
        return { x: p.x + Math.sin(i * 1.7) * 0.006, y: p.y + Math.cos(i * 2.1) * 0.002, z: p.z }
      })
      const model = buildHandModel(noisy, null, 'right', 1)
      rawXs.push(model.indexTip.x)
      stableXs.push(model.stableIndexTip.x)
    }

    const spread = (xs) => Math.max(...xs) - Math.min(...xs)
    rawSpread = spread(rawXs)
    stableSpread = spread(stableXs)

    check(
      'projeção no eixo do dedo reduz o tremor da ponta',
      stableSpread < rawSpread * 0.6,
      `amplitude ${(rawSpread * 1000).toFixed(2)} -> ${(stableSpread * 1000).toFixed(2)} (milésimos de quadro)`,
    )

    // A estabilização não pode custar a capacidade de apontar: o ponto ainda
    // precisa acompanhar o dedo quando ele realmente se move.
    const left = buildHandModel(makeHand({ ...POSES.point, center: { x: 0.35, y: 0.5 } }), null, 'right', 1)
    const right = buildHandModel(makeHand({ ...POSES.point, center: { x: 0.65, y: 0.5 } }), null, 'right', 1)
    check(
      'ponto estabilizado ainda segue o dedo',
      Math.abs(right.stableIndexTip.x - left.stableIndexTip.x) > 0.25,
      `deslocou ${(right.stableIndexTip.x - left.stableIndexTip.x).toFixed(3)} para 0.30 de movimento`,
    )
  }

  // ---------------------------------------------------- ganho adaptativo

  {
    const viewport = { width: 1920, height: 1080 }

    /** Move a mão de `from` a `to` em N passos e devolve o caminho do cursor. */
    const sweep = (from, to, steps, msPerStep) => {
      const mapper = new (mod.PointerMapper)()
      let t = 0
      mapper.update({ x: from, y: 0.5 }, t, viewport)
      const start = mapper.position.x

      for (let i = 1; i <= steps; i++) {
        t += msPerStep
        const nx = from + ((to - from) * i) / steps
        mapper.update({ x: nx, y: 0.5 }, t, viewport)
      }
      // Deixa a interpolação visual alcançar o alvo.
      for (let i = 0; i < 90; i++) mapper.render(t + i * 16)
      return { start, end: mapper.position.x }
    }

    // Mesmo deslocamento de mão, devagar e depressa.
    const slow = sweep(0.5, 0.56, 30, 33)
    const fast = sweep(0.5, 0.56, 3, 33)

    const slowTravel = Math.abs(slow.end - slow.start)
    const fastTravel = Math.abs(fast.end - fast.start)

    check(
      'movimento lento percorre menos tela que o rápido',
      slowTravel < fastTravel * 0.75,
      `lento ${slowTravel.toFixed(0)}px, rápido ${fastTravel.toFixed(0)}px para o mesmo gesto`,
    )
    check(
      'movimento lento ainda avança',
      slowTravel > 5,
      `${slowTravel.toFixed(0)}px — precisão não pode virar paralisia`,
    )

    // Ruído puro com a mão parada: é o que determina se dá para acertar um
    // link pequeno. Compara o ganho de precisão contra ganho fixo de 1.
    const jitterOf = (precisionGain) => {
      const mapper = new (mod.PointerMapper)({ precisionGain })
      let t = 0
      mapper.update({ x: 0.5, y: 0.5 }, t, viewport)
      const xs = []
      for (let i = 0; i < 80; i++) {
        t += 33
        const nx = 0.5 + Math.sin(i * 2.3) * 0.0035
        mapper.update({ x: nx, y: 0.5 }, t, viewport)
        mapper.render(t)
        if (i > 25) xs.push(mapper.position.x)
      }
      return Math.max(...xs) - Math.min(...xs)
    }

    const withPrecision = jitterOf(0.35)
    const withoutPrecision = jitterOf(1)
    check(
      'ganho de precisão reduz o tremor na tela',
      withPrecision < withoutPrecision * 0.7,
      `${withoutPrecision.toFixed(1)}px -> ${withPrecision.toFixed(1)}px de oscilação`,
    )
  }

  // ---------------------------------------------------- clutch

  {
    const viewport = { width: 1920, height: 1080 }
    const mapper = new (mod.PointerMapper)()
    let t = 0

    mapper.update({ x: 0.5, y: 0.5 }, t, viewport)
    for (let i = 0; i < 40; i++) mapper.render(t + i * 16)
    const before = mapper.position.x

    // Punho fechado: a mão atravessa o quadro e o cursor não pode se mover.
    for (let i = 1; i <= 20; i++) {
      t += 33
      mapper.update({ x: 0.5 - i * 0.01, y: 0.5 }, t, viewport, true)
    }
    for (let i = 0; i < 40; i++) mapper.render(t + i * 16)
    const during = mapper.position.x

    check(
      'clutch trava o cursor enquanto a mão se move',
      Math.abs(during - before) < 2,
      `moveu ${Math.abs(during - before).toFixed(1)}px com o punho fechado`,
    )

    // Ao soltar, o movimento retoma do ponto onde parou — sem salto.
    t += 33
    mapper.update({ x: 0.3, y: 0.5 }, t, viewport, false)
    t += 33
    mapper.update({ x: 0.305, y: 0.5 }, t, viewport, false)
    for (let i = 0; i < 40; i++) mapper.render(t + i * 16)
    const after = mapper.position.x

    check(
      'ao soltar o clutch o cursor não salta',
      Math.abs(after - during) < 60,
      `saltou ${Math.abs(after - during).toFixed(0)}px na retomada`,
    )
  }

  // ---------------------------------------------------- limpeza de estado

  {
    const recognizer = new GestureRecognizer()
    const hand = makeHand({ ...POSES.pinch })
    settle(recognizer, buildHandModel, hand)

    // Mão sai do quadro: o estado precisa zerar, senão ela reaparece já pinçando
    // e dispara um clique que ninguém pediu.
    const empty = recognizer.process([], 400)
    check('quadro vazio não reporta mãos', empty.hands.length === 0)

    const back = recognizer.process([buildHandModel(makeHand({ ...POSES.open }), null, 'right', 1)], 433)
    check(
      'mão que volta não herda o gesto anterior',
      back.right?.gesture !== 'pinch',
      `veio ${back.right?.gesture}`,
    )
  }

  await cleanup()

  // ---------------------------------------------------- resultado

  console.log(`\n${passed} passaram, ${failed} falharam\n`)
  if (failures.length) {
    console.log('Falhas:')
    for (const f of failures) console.log(`  ✗ ${f}`)
    console.log()
    process.exit(1)
  }
  console.log('Motor de gestos verificado.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
