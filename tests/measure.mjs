/**
 * Medição de precisão.
 *
 * Os testes dizem que uma propriedade vale; este relatório diz o quanto. É o
 * que permite decidir se um ajuste de parâmetro melhorou ou piorou, em vez de
 * confiar na impressão de quem está usando.
 *
 * A grandeza central é a incerteza do cursor em pixels de tela: o quanto ele
 * oscila com a mão parada. Ela determina diretamente o menor alvo clicável.
 */

import { build } from 'esbuild'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeHand, POSES } from './hand-fixtures.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

async function loadCore() {
  const dir = await mkdtemp(join(tmpdir(), 'gn-measure-'))
  const entry = join(dir, 'entry.ts')
  const out = join(dir, 'core.mjs')
  await writeFile(
    entry,
    `export * from '${join(root, 'src/core/handModel').replace(/\\/g, '/')}'
     export * from '${join(root, 'src/core/pointer').replace(/\\/g, '/')}'`,
  )
  await build({
    entryPoints: [entry], outfile: out, bundle: true, format: 'esm',
    platform: 'neutral', target: ['node20'], logLevel: 'silent',
  })
  return { mod: await import(`file://${out}`), cleanup: () => rm(dir, { recursive: true, force: true }) }
}

const VIEWPORT = { width: 1920, height: 1080 }

/** Ruído determinístico, para as medidas serem reprodutíveis entre execuções. */
const noise = (i, amp) => Math.sin(i * 2.3) * amp + Math.sin(i * 5.7) * amp * 0.4

/**
 * Oscilação do cursor, em pixels, com a mão "parada" tremendo `amp` no quadro.
 * `amp` em unidades normalizadas: 0.003 ≈ 2px numa câmera de 640px.
 */
function jitter(PointerMapper, options, amp = 0.003) {
  const mapper = new PointerMapper(options)
  let t = 0
  mapper.update({ x: 0.5, y: 0.5 }, t, VIEWPORT)
  const xs = []
  for (let i = 0; i < 90; i++) {
    t += 33
    mapper.update({ x: 0.5 + noise(i, amp), y: 0.5 }, t, VIEWPORT)
    mapper.render(t)
    if (i > 30) xs.push(mapper.position.x)
  }
  return Math.max(...xs) - Math.min(...xs)
}

/** Distância percorrida na tela para um mesmo gesto, em N passos. */
function travel(PointerMapper, steps, delta = 0.06) {
  const mapper = new PointerMapper()
  let t = 0
  mapper.update({ x: 0.5, y: 0.5 }, t, VIEWPORT)
  for (let i = 0; i < 40; i++) mapper.render(t + i * 16)
  const start = mapper.position.x
  for (let i = 1; i <= steps; i++) {
    t += 33
    mapper.update({ x: 0.5 + (delta * i) / steps, y: 0.5 }, t, VIEWPORT)
  }
  for (let i = 0; i < 90; i++) mapper.render(t + i * 16)
  return Math.abs(mapper.position.x - start)
}

async function main() {
  const { mod, cleanup } = await loadCore()
  const { PointerMapper, buildHandModel } = mod

  const row = (label, value) => console.log(`  ${label.padEnd(42)} ${value}`)
  const px = (v) => `${v.toFixed(1)} px`

  console.log('\n╔═ PRECISÃO DO CURSOR ' + '═'.repeat(38))
  console.log('║ tela 1920×1080, câmera 640×480, tremor de mão ≈2px no quadro')
  console.log('╚' + '═'.repeat(58) + '\n')

  console.log('Oscilação do cursor com a mão parada')
  const noFilter = jitter(PointerMapper, { minCutoff: 60, beta: 0, precisionGain: 1 })
  const filterOnly = jitter(PointerMapper, { precisionGain: 1 })
  const full = jitter(PointerMapper, {})
  row('sem filtro, ganho absoluto', px(noFilter))
  row('One Euro, ganho absoluto', px(filterOnly))
  row('One Euro + ganho de precisão', px(full))
  console.log(
    `  ${'ganho total'.padEnd(42)} ${(noFilter / Math.max(full, 0.01)).toFixed(1)}× menos oscilação\n`,
  )

  console.log('Menor alvo confortavelmente clicável (≈2× a oscilação)')
  row('sem filtro', `${Math.ceil(noFilter * 2)} px`)
  row('com tudo ligado', `${Math.ceil(full * 2)} px`)
  console.log()

  console.log('Ganho adaptativo — mesmo gesto de mão, velocidades diferentes')
  const slow = travel(PointerMapper, 40)
  const medium = travel(PointerMapper, 10)
  const fast = travel(PointerMapper, 3)
  row('lento (40 quadros)', px(slow))
  row('médio (10 quadros)', px(medium))
  row('rápido (3 quadros)', px(fast))
  console.log(
    `  ${'razão rápido/lento'.padEnd(42)} ${(fast / Math.max(slow, 0.01)).toFixed(1)}×\n`,
  )

  console.log('Estabilização da ponta do dedo')
  const rawXs = []
  const stableXs = []
  const base = makeHand({ ...POSES.point })
  for (let i = 0; i < 60; i++) {
    const noisy = base.map((p, idx) =>
      idx === 8 ? { x: p.x + noise(i, 0.005), y: p.y + noise(i + 7, 0.002), z: p.z } : p,
    )
    const m = buildHandModel(noisy, null, 'right', 1)
    rawXs.push(m.indexTip.x)
    stableXs.push(m.stableIndexTip.x)
  }
  const spread = (a) => Math.max(...a) - Math.min(...a)
  // Converte para pixels de tela: amplificação da área ativa (55% de 1920).
  const toScreen = (v) => (v / 0.55) * VIEWPORT.width
  row('ponta crua, projetada na tela', px(toScreen(spread(rawXs))))
  row('ponta estabilizada', px(toScreen(spread(stableXs))))
  console.log(
    `  ${'redução'.padEnd(42)} ${((1 - spread(stableXs) / spread(rawXs)) * 100).toFixed(0)}%\n`,
  )

  await cleanup()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
