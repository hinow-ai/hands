/**
 * Empacota a extensão para a Chrome Web Store.
 *
 * O que a loja recebe não é `dist/` inteiro: os *source maps* somam quase um
 * megabyte e só servem a quem depura o build local — quem instala da loja não
 * os usa, e o pacote é baixado por toda pessoa que instala. O resto de `dist/`
 * vai como está, porque o modelo e o runtime wasm precisam viajar junto: a
 * política do MV3 proíbe carregar código remoto, então a extensão tem de
 * funcionar offline e com tudo auditável dentro do próprio .zip.
 *
 * Rodar: npm run package (depois de `npm run build`)
 */

import { execFile } from 'node:child_process'
import { mkdir, readFile, readdir, rm, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const dist = join(root, 'dist')
const outDir = join(root, 'store')

/** Padrões que não vão para a loja. */
const EXCLUDE = ['*.map', '_preview.html', '_perm.html', '.DS_Store']

async function main() {
  if (!existsSync(join(dist, 'manifest.json'))) {
    console.error('dist/ não encontrado ou incompleto. Rode `npm run build` antes.')
    process.exit(1)
  }

  const manifest = JSON.parse(await readFile(join(dist, 'manifest.json'), 'utf8'))
  const name = 'hands-hinow-ai'
  const zip = join(outDir, `${name}-${manifest.version}.zip`)

  await mkdir(outDir, { recursive: true })
  await rm(zip, { force: true })

  // O zip é montado a partir de dentro de dist/ para que os caminhos fiquem na
  // raiz do arquivo: a loja recusa um pacote cujo manifest esteja numa subpasta.
  const args = ['-r', '-q', '-X', zip, '.', '-x', ...EXCLUDE]
  await run('zip', args, { cwd: dist })

  const { size } = await stat(zip)
  console.log(`\n${zip.replace(root + '/', '')}  ${(size / 1024 / 1024).toFixed(1)} MB`)
  console.log(`versão ${manifest.version}${manifest.version_name ? ` (${manifest.version_name})` : ''}`)

  // Conferência do que a loja exige e que passa despercebido até a recusa.
  const icons = manifest.icons ?? {}
  const checks = [
    ['ícone 128×128 declarado', Boolean(icons['128'])],
    ['ícone 128×128 presente', existsSync(join(dist, icons['128'] ?? ''))],
    ['default_locale definido', Boolean(manifest.default_locale)],
    ['pasta _locales presente', existsSync(join(dist, '_locales'))],
    ['manifest v3', manifest.manifest_version === 3],
  ]
  console.log('')
  for (const [label, ok] of checks) console.log(`  ${ok ? '✓' : '✗'} ${label}`)

  if (existsSync(join(dist, '_locales'))) {
    const langs = await readdir(join(dist, '_locales'))
    console.log(`  ✓ idiomas: ${langs.join(', ')}`)
  }
  console.log('')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
