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
import { existsSync, readFileSync } from 'node:fs'
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
    failures.push(`${name}${detail ? `: ${detail}` : ''}`)
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
     export * from '${join(root, 'src/core/pointer').replace(/\\/g, '/')}'
     export * from '${join(root, 'src/core/handedness').replace(/\\/g, '/')}'
     export * from '${join(root, 'src/core/spatial').replace(/\\/g, '/')}'`,
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
      `${ok}/${angles.length} ângulos corretos, falhou em ${wrong.join(', ')}`,
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
      `${ok}/${scales.length} escalas corretas, falhou em ${wrong.join(', ')}`,
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

  // ---------------------------------------------------- mediana mata-picos

  // Câmera ruim produz interferência como picos isolados: o landmark salta
  // dezenas de pixels por UM frame. O One Euro deixa o pico passar (parece
  // velocidade); a mediana o elimina por construção.
  {
    const { MedianFilter } = mod
    const m = new MedianFilter()
    m.filter(100)
    m.filter(100)
    const spiked = m.filter(160)
    check('mediana descarta um pico isolado', spiked === 100, `veio ${spiked}`)
    const after = m.filter(100)
    check('depois do pico a saída continua no valor real', after === 100, `veio ${after}`)

    // Movimento real se sustenta por várias amostras e passa, com uma amostra
    // de atraso — que é o preço, e é imperceptível.
    const m2 = new MedianFilter()
    m2.filter(100)
    m2.filter(120)
    const ramp = m2.filter(140)
    check('movimento sustentado atravessa a mediana', ramp === 120, `veio ${ramp}`)
  }

  // O mesmo pico, agora no mapeador completo: parado em um ponto, um frame de
  // interferência não pode mexer o cursor de forma perceptível.
  {
    const viewport = { width: 1920, height: 1080 }
    const mapper = new (mod.PointerMapper)()
    let t = 0
    for (let i = 0; i < 30; i++) {
      t += 33
      mapper.update({ x: 0.5, y: 0.5 }, t, viewport)
      mapper.render(t)
    }
    const before = mapper.position.x

    t += 33
    mapper.update({ x: 0.55, y: 0.5 }, t, viewport) // pico de ~175px na tela
    for (let i = 0; i < 3; i++) mapper.render(t + i * 16)
    t += 33
    mapper.update({ x: 0.5, y: 0.5 }, t, viewport)
    for (let i = 0; i < 30; i++) mapper.render(t + i * 16)

    const deviation = Math.abs(mapper.position.x - before)
    check(
      'um frame de interferência não desloca o cursor',
      deviation < 3,
      `desviou ${deviation.toFixed(1)}px para um pico de ~175px`,
    )
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

    // Com o dedo claramente dobrado a projeção não vale — o eixo das juntas
    // internas não aponta para onde a ponta está — e a saída deve ser a ponta
    // crua, sem mistura nenhuma.
    const bent = buildHandModel(makeHand({ ...POSES.point, index: 0.5 }), null, 'right', 1)
    check(
      'dedo dobrado desliga a estabilização por completo',
      bent.stableIndexTip.x === bent.indexTip.x && bent.stableIndexTip.y === bent.indexTip.y,
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
      // A mão fica na posição final e o rastreador continua amostrando, como
      // no uso real. Sem isto a mediana nunca vê a última posição se
      // sustentar e o fim do gesto seria descartado como se fosse um pico.
      for (let i = 0; i < 10; i++) {
        t += msPerStep
        mapper.update({ x: to, y: 0.5 }, t, viewport)
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
      `${slowTravel.toFixed(0)}px, precisão não pode virar paralisia`,
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

  // ---------------------------------------------------- comandos ativos

  // As listas são a fonte única: o guia na tela é montado a partir delas e o
  // controlador acende os `id`s daqui. Um comando que existe num lugar e não
  // no outro não quebra a compilação nem o runtime — só deixa de funcionar em
  // silêncio, ou vira uma linha na tela que nunca acende.
  {
    const { COMMANDS_SCROLL, COMMANDS_ACTION, COMMANDS_BOTH } = mod
    const ALL = [...COMMANDS_SCROLL, ...COMMANDS_ACTION, ...COMMANDS_BOTH]
    const ids = ALL.map((c) => c.id)

    check(
      'um papel rola e para; o outro escolhe e clica; os dois trocam de página',
      JSON.stringify(ids) ===
        JSON.stringify([
          'scroll_down',
          'scroll_up',
          'next_link',
          'stop',
          'next_link',
          'prev_link',
          'click',
          'rest',
          'page_next',
          'page_prev',
        ]),
      ids.join(', '),
    )
    // `next_link` existe nos dois papéis de propósito — dois caminhos motores
    // para a ação mais frequente. Dentro de um papel, nada se repete.
    const scrollIds = COMMANDS_SCROLL.map((c) => c.id)
    const actionIds = COMMANDS_ACTION.map((c) => c.id)
    check(
      'nenhum id se repete dentro do mesmo papel',
      new Set(scrollIds).size === scrollIds.length && new Set(actionIds).size === actionIds.length,
    )
    // `art` precisa nomear um dos quatro desenhos existentes: um id errado não
    // quebra nada em tempo de execução — a máscara simplesmente não carrega e
    // a linha aparece sem ícone, que é o tipo de defeito que ninguém nota até
    // alguém abrir o painel.
    const ART = ['open', 'fist', 'point', 'side']
    for (const entry of ALL) {
      check(
        `comando "${entry.action}" está completo`,
        Boolean(entry.art && entry.action && entry.fingers),
      )
      check(`comando "${entry.action}" usa uma arte existente`, ART.includes(entry.art), entry.art)
    }

    // E o arquivo precisa estar no pacote: o nome pode ser válido e a arte
    // ainda assim faltar, se alguém esquecer de rodar `npm run art`.
    for (const art of new Set(ALL.map((c) => c.art))) {
      check(
        `a arte "${art}" existe em public/img`,
        existsSync(join(root, `public/img/hand-${art}.png`)),
      )
    }
    check('o logo existe em public/img', existsSync(join(root, 'public/img/logo.png')))

    // ------------------------------------------------ traduções
    //
    // `action` e `fingers` são chaves, não texto. Uma chave sem tradução não
    // quebra nada: `chrome.i18n.getMessage` devolve string vazia e a linha
    // aparece com o nome cru da chave — defeito silencioso, visível só para
    // quem abre o painel naquele idioma. E os dois idiomas precisam cobrir o
    // mesmo conjunto, senão quem usa a tradução vê metade em inglês.
    const locales = {}
    for (const lang of ['en', 'pt_BR']) {
      const file = join(root, `public/_locales/${lang}/messages.json`)
      check(`o idioma ${lang} existe`, existsSync(file))
      if (existsSync(file)) locales[lang] = JSON.parse(readFileSync(file, 'utf8'))
    }

    if (locales.en && locales.pt_BR) {
      for (const entry of ALL) {
        for (const key of [entry.action, entry.fingers]) {
          check(
            `a chave "${key}" está traduzida nos dois idiomas`,
            Boolean(locales.en[key]?.message) && Boolean(locales.pt_BR[key]?.message),
          )
        }
      }

      const onlyEn = Object.keys(locales.en).filter((k) => !(k in locales.pt_BR))
      const onlyPt = Object.keys(locales.pt_BR).filter((k) => !(k in locales.en))
      check(
        'os dois idiomas cobrem exatamente as mesmas chaves',
        onlyEn.length === 0 && onlyPt.length === 0,
        `só em en: ${onlyEn.join(', ') || 'nenhuma'} · só em pt_BR: ${onlyPt.join(', ') || 'nenhuma'}`,
      )
    }

    // As poses de rolar e parar precisam ser as duas mais separáveis do
    // motor: aberta (>=4 dedos) e punho (0 dedos), com a zona morta no meio.
    const openFrame = settle(new GestureRecognizer(), buildHandModel, makeHand({ ...POSES.open }))
    const fistFrame = settle(new GestureRecognizer(), buildHandModel, makeHand({ ...POSES.fist }))
    check('mão aberta é o gesto de rolar', openFrame.right?.gesture === 'open')
    check('punho é o gesto de parar', fistFrame.right?.gesture === 'fist')

    // O apontar natural não dobra o anelar por completo — ele compartilha
    // tendão com o médio. A classificação precisa aceitar a zona intermediária
    // (nem esticado, nem dobrado), senão a pose real de quase todo mundo cai
    // em 'idle' e o clique por permanência nunca arma.
    const relaxed = settle(
      new GestureRecognizer(),
      buildHandModel,
      makeHand({ ...POSES.point, ring: 0.45 }),
    )
    check(
      'apontar tolera o anelar a meio caminho',
      relaxed.right?.gesture === 'point',
      `veio ${relaxed.right?.gesture}`,
    )

    // O rolar para cima da esquerda: a pose de apontar com o dedo vertical
    // precisa chegar como 'point' + direção 'up' também na mão esquerda.
    const leftUp = settle(
      new GestureRecognizer(),
      buildHandModel,
      makeHand({ ...POSES.point, side: 'left' }),
      'left',
    )
    check(
      'esquerda apontando para cima é point + up',
      leftUp.left?.gesture === 'point' && leftUp.left?.pointDirection === 'up',
      `veio ${leftUp.left?.gesture}/${leftUp.left?.pointDirection}`,
    )
  }

  // ---------------------------------------------------- direção do apontar

  // A direção do indicador discrimina comandos: para cima rola (esquerda) e
  // clica (direita), para o lado volta um link. É medida pelo eixo do dedo, e
  // a diagonal precisa ser RECUSADA: é a banda morta entre "cima" e "lado"
  // que impede um clique de virar um voltar no meio do caminho.
  {
    // Um reconhecedor por medida: a direção é confirmada ao longo de vários
    // frames, e reaproveitar o estado faria uma medição contaminar a seguinte.
    const dirAt = (rotation) => {
      const frame = settle(
        new GestureRecognizer(),
        buildHandModel,
        makeHand({ ...POSES.point, rotation }),
        'right',
      )
      return frame.right?.pointDirection ?? null
    }

    check('indicador para cima é lido como cima', dirAt(0) === 'up', `veio ${dirAt(0)}`)
    check(
      'indicador para baixo é lido como baixo',
      dirAt(Math.PI) === 'down',
      `veio ${dirAt(Math.PI)}`,
    )
    check(
      'indicador deitado para a direita é lido como direita',
      dirAt(Math.PI / 2) === 'right',
      `veio ${dirAt(Math.PI / 2)}`,
    )
    check(
      'indicador deitado para a esquerda é lido como esquerda',
      dirAt(-Math.PI / 2) === 'left',
      `veio ${dirAt(-Math.PI / 2)}`,
    )
    check(
      'diagonal fica na banda morta, sem direção',
      dirAt(Math.PI / 4) === null,
      `veio ${dirAt(Math.PI / 4)}`,
    )
  }

  // ---------------------------------------------------- atribuição de mãos

  // O rótulo esquerda/direita do modelo erra com frequência, e com papéis
  // fixos por mão um rótulo trocado inverte os comandos da pessoa. A posição
  // no quadro decide; o rótulo é só o palpite inicial de uma mão sozinha.
  {
    const { HandAssigner } = mod
    const obs = (x, modelLabel, score = 1) => ({ center: { x, y: 0.5 }, modelLabel, score })

    // Duas mãos com os rótulos do modelo TROCADOS: a geometria corrige.
    const a = new HandAssigner()
    const swapped = a.assign([obs(0.7, 'left'), obs(0.3, 'right')], 0)
    const byIndex = new Map(swapped.map((r) => [r.index, r.hand]))
    check(
      'com duas mãos, a posição corrige o rótulo do modelo',
      byIndex.get(0) === 'right' && byIndex.get(1) === 'left',
      swapped.map((r) => `${r.index}:${r.hand}`).join(', '),
    )

    // A direita cruza o centro do quadro para mirar à esquerda da tela e a
    // outra mão some: o papel precisa sobreviver pela continuidade.
    const b = new HandAssigner()
    b.assign([obs(0.25, 'left'), obs(0.6, 'right')], 0)
    let single
    for (let i = 1; i <= 6; i++) {
      single = b.assign([obs(0.6 - i * 0.04, 'left')], i * 33)
    }
    check(
      'mão sozinha que cruza o centro mantém o papel',
      single[0]?.hand === 'right',
      `veio ${single[0]?.hand}`,
    )

    // Mão nova, sem histórico: o rótulo do modelo é o único indício.
    const c = new HandAssigner()
    const fresh = c.assign([obs(0.5, 'left')], 0)
    check('mão nova usa o rótulo do modelo', fresh[0]?.hand === 'left', `veio ${fresh[0]?.hand}`)

    // Mão fantasma: a mesma mão detectada em dobro, quase no mesmo lugar,
    // não pode virar uma segunda mão comandando outra coisa.
    const d = new HandAssigner()
    const ghost = d.assign([obs(0.5, 'right', 0.9), obs(0.53, 'left', 0.6)], 0)
    check(
      'detecção em dobro vira uma mão só, a de maior confiança',
      ghost.length === 1 && ghost[0].index === 0,
      ghost.map((r) => `${r.index}:${r.hand}`).join(', '),
    )
  }

  // ---------------------------------------------------- pulo direcional

  // O empurrão da mão move a seleção para o alvo vizinho na direção. A
  // escolha precisa preferir alinhado e perto, e RECUSAR o que está de lado:
  // empurrar para a direita não pode pular para um link lá de cima.
  {
    const { pickInDirection, quantizeDirection } = mod
    const r = (left, top, width = 80, height = 24) => ({ left, top, width, height })

    const from = r(100, 100)
    const rightNear = r(220, 102)
    const rightFar = r(500, 100)
    const below = r(100, 170)
    const wayUp = r(110, -180)

    const candidates = [rightFar, below, rightNear, wayUp]
    check(
      'empurrar para a direita escolhe o vizinho alinhado mais próximo',
      pickInDirection(from, candidates, 'right') === 2,
      `veio índice ${pickInDirection(from, candidates, 'right')}`,
    )
    check(
      'empurrar para baixo escolhe o de baixo',
      pickInDirection(from, candidates, 'down') === 1,
      `veio índice ${pickInDirection(from, candidates, 'down')}`,
    )
    check(
      'sem candidato na direção, não pula',
      pickInDirection(from, [wayUp], 'down') === -1,
    )
    check(
      'candidato muito de lado fica fora do cone',
      pickInDirection(from, [r(140, 500)], 'right') === -1,
      'um link 400px abaixo não é "à direita"',
    )
    check(
      'vizinho alinhado longe ganha de desalinhado perto',
      pickInDirection(r(100, 100), [r(400, 104), r(180, 240)], 'right') === 0,
    )

    check('empurrão dominante à direita quantiza como direita', quantizeDirection(60, -10) === 'right')
    check('empurrão dominante para baixo quantiza como baixo', quantizeDirection(15, 70) === 'down')
    check('empurrão dominante para cima quantiza como cima', quantizeDirection(-5, -50) === 'up')
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
