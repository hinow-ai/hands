/**
 * Build da extensão.
 *
 * esbuild em vez de um bundler com plugin de extensão porque o requisito é
 * simples e rígido: quatro entradas independentes, cada uma num formato que o
 * Chrome aceita. Content scripts não suportam `import`, então precisam ser IIFE
 * com tudo embutido — é a restrição que descarta a saída em módulos ES.
 *
 * O wasm do MediaPipe e o modelo são copiados para dentro do pacote. A política
 * de segurança do MV3 proíbe carregar código remoto, então nada de CDN: a
 * extensão precisa funcionar offline e com tudo auditável no próprio .zip.
 */

import { build, context } from 'esbuild'
import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const outdir = join(root, 'dist')
const watch = process.argv.includes('--watch')

/** IIFE para content e offscreen; o service worker aceita módulo. */
const ENTRIES = [
  { in: 'src/content/index.ts', out: 'content', format: 'iife' },
  { in: 'src/background/index.ts', out: 'background', format: 'esm' },
  { in: 'src/offscreen/index.ts', out: 'offscreen', format: 'esm' },
  { in: 'src/popup/index.ts', out: 'popup', format: 'esm' },
]

async function copyStatic() {
  await cp(join(root, 'public'), outdir, { recursive: true })

  // O runtime wasm do MediaPipe vive dentro do pacote npm; o FilesetResolver
  // espera encontrá-lo num diretório servido pela própria extensão.
  //
  // O pacote traz três variantes, e o resolvedor monta o nome como
  // `vision_wasm[_module][_nosimd]_internal`. A variante `_module_` só entra
  // num modo que não usamos, então copiá-la seria carregar 12 MB mortos: fica
  // de fora, e as outras duas cobrem com e sem suporte a SIMD.
  const wasmSrc = join(root, 'node_modules/@mediapipe/tasks-vision/wasm')
  if (existsSync(wasmSrc)) {
    await mkdir(join(outdir, 'wasm'), { recursive: true })
    for (const file of await readdir(wasmSrc)) {
      if (file.includes('_module_')) continue
      await cp(join(wasmSrc, file), join(outdir, 'wasm', file))
    }
  } else {
    console.warn('[build] wasm do MediaPipe não encontrado — rode `npm install` primeiro')
  }

  const modelSrc = join(root, 'models/hand_landmarker.task')
  if (existsSync(modelSrc)) {
    await mkdir(join(outdir, 'models'), { recursive: true })
    await cp(modelSrc, join(outdir, 'models/hand_landmarker.task'))
  } else {
    console.warn('[build] modelo ausente — rode `npm run fetch:model`')
  }
}

async function report() {
  const walk = async (dir, prefix = '') => {
    const items = await readdir(dir, { withFileTypes: true })
    for (const item of items.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = join(dir, item.name)
      if (item.isDirectory()) {
        // Não listamos arquivo a arquivo do wasm: são muitos e o total basta.
        if (item.name === 'wasm') {
          const files = await readdir(full)
          let total = 0
          for (const f of files) total += (await stat(join(full, f))).size
          console.log(`  ${prefix}wasm/ ${files.length} arquivos, ${(total / 1024 / 1024).toFixed(1)} MB`)
          continue
        }
        await walk(full, `${prefix}${item.name}/`)
      } else {
        const { size } = await stat(full)
        console.log(`  ${prefix}${item.name} — ${(size / 1024).toFixed(1)} kB`)
      }
    }
  }
  console.log('\nConteúdo de dist/:')
  await walk(outdir)
}

async function run() {
  await rm(outdir, { recursive: true, force: true })
  await mkdir(outdir, { recursive: true })

  const configs = ENTRIES.map((entry) => ({
    entryPoints: [join(root, entry.in)],
    outfile: join(outdir, `${entry.out}.js`),
    bundle: true,
    format: entry.format,
    target: ['chrome116'],
    platform: 'browser',
    minify: !watch,
    sourcemap: watch ? 'inline' : false,
    legalComments: 'none',
    logLevel: 'info',
  }))

  if (watch) {
    await copyStatic()
    const contexts = await Promise.all(configs.map((c) => context(c)))
    await Promise.all(contexts.map((c) => c.watch()))
    console.log('\nObservando alterações. Recarregue a extensão em chrome://extensions após editar.')
    return
  }

  await Promise.all(configs.map((c) => build(c)))
  await copyStatic()
  await report()
  console.log('\nPronto. Carregue dist/ em chrome://extensions (modo desenvolvedor).')
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
