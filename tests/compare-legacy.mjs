/**
 * Confronto entre o detector antigo e o novo, sobre exatamente as mesmas
 * entradas.
 *
 * Serve a dois propósitos. Confirma que a reescrita resolveu problemas reais, e
 * — mais importante — prova que a bateria de testes tem poder de detecção: um
 * conjunto de casos que o detector defeituoso também passasse não estaria
 * medindo nada.
 */

import { build } from 'esbuild'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeHand, POSES } from './hand-fixtures.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const LEGACY = '/path/to/legacy/gestureDetector.js'

async function loadBoth() {
  const dir = await mkdtemp(join(tmpdir(), 'gn-compare-'))
  const entry = join(dir, 'entry.ts')
  const out = join(dir, 'both.mjs')

  await writeFile(
    entry,
    `export * from '${join(root, 'src/core/handModel').replace(/\\/g, '/')}'
     export * from '${join(root, 'src/core/gestures').replace(/\\/g, '/')}'
     export { detectGesture as legacyDetect } from '${LEGACY}'`,
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

function settleNew(Recognizer, buildModel, landmarks) {
  const r = new Recognizer()
  let frame
  for (let i = 0; i < 6; i++) {
    frame = r.process([buildModel(landmarks, null, 'right', 1)], i * 33)
  }
  return frame.right?.gesture ?? null
}

/** O vocabulário antigo usa outros nomes para as mesmas poses. */
const LEGACY_EQUIVALENT = {
  open: 'open_palm',
  fist: 'fist',
  point: 'pointing',
  two: 'peace',
  pinch: 'pinch',
}

async function main() {
  const { mod, cleanup } = await loadBoth()
  const { buildHandModel, GestureRecognizer, legacyDetect } = mod

  const poses = [
    ['open', POSES.open],
    ['fist', POSES.fist],
    ['point', POSES.point],
    ['two', POSES.two],
    ['pinch', POSES.pinch],
  ]

  const angles = [0, 30, 60, 90, 135, 180, -45, -90]
  const scales = [0.1, 0.15, 0.22, 0.35, 0.5]

  let legacyRotOk = 0
  let newRotOk = 0
  let rotTotal = 0
  let legacyScaleOk = 0
  let newScaleOk = 0
  let scaleTotal = 0

  console.log('\nROTAÇÃO DA MÃO')
  console.log('pose      ângulo   antigo          novo')
  console.log('─'.repeat(52))

  for (const [name, pose] of poses) {
    for (const deg of angles) {
      const hand = makeHand({ ...pose, rotation: (deg * Math.PI) / 180 })
      const legacy = legacyDetect(hand)
      const fresh = settleNew(GestureRecognizer, buildHandModel, hand)

      const legacyOk = legacy === LEGACY_EQUIVALENT[name]
      const newOk = fresh === name
      rotTotal++
      if (legacyOk) legacyRotOk++
      if (newOk) newRotOk++

      // Só mostramos as linhas em que os dois discordam, para o relatório caber.
      if (legacyOk !== newOk) {
        console.log(
          `${name.padEnd(9)} ${String(deg).padStart(4)}°   ` +
            `${(legacy ?? 'null').padEnd(14)}  ${fresh ?? 'null'}`,
        )
      }
    }
  }

  console.log('\nESCALA (distância da câmera)')
  console.log('pose      escala   antigo          novo')
  console.log('─'.repeat(52))

  for (const [name, pose] of poses) {
    for (const scale of scales) {
      const hand = makeHand({ ...pose, scale })
      const legacy = legacyDetect(hand)
      const fresh = settleNew(GestureRecognizer, buildHandModel, hand)

      const legacyOk = legacy === LEGACY_EQUIVALENT[name]
      const newOk = fresh === name
      scaleTotal++
      if (legacyOk) legacyScaleOk++
      if (newOk) newScaleOk++

      if (legacyOk !== newOk) {
        console.log(
          `${name.padEnd(9)} ${String(scale).padStart(5)}   ` +
            `${(legacy ?? 'null').padEnd(14)}  ${fresh ?? 'null'}`,
        )
      }
    }
  }

  const pct = (n, total) => `${((n / total) * 100).toFixed(0)}%`

  console.log('\n' + '═'.repeat(52))
  console.log(`Rotação:  antigo ${legacyRotOk}/${rotTotal} (${pct(legacyRotOk, rotTotal)})` +
    `   novo ${newRotOk}/${rotTotal} (${pct(newRotOk, rotTotal)})`)
  console.log(`Escala:   antigo ${legacyScaleOk}/${scaleTotal} (${pct(legacyScaleOk, scaleTotal)})` +
    `   novo ${newScaleOk}/${scaleTotal} (${pct(newScaleOk, scaleTotal)})`)
  console.log('═'.repeat(52) + '\n')

  await cleanup()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
