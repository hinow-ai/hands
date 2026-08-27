/**
 * Baixa o modelo de landmarks de mão do MediaPipe.
 *
 * Fica fora do controle de versão por ser um binário de alguns megabytes, e
 * fora do build porque baixar a cada compilação seria lento e frágil. É um
 * passo único, explícito, com verificação de tamanho para não deixar passar um
 * download truncado — que se manifestaria muito mais tarde, como um erro
 * obscuro de inicialização do wasm.
 */

import { mkdir, writeFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const dest = join(root, 'models/hand_landmarker.task')

const URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'

/** O modelo tem ~7,5 MB; abaixo de 1 MB certamente veio truncado. */
const MIN_BYTES = 1_000_000

async function main() {
  if (existsSync(dest)) {
    const { size } = await stat(dest)
    if (size > MIN_BYTES) {
      console.log(`Modelo já presente (${(size / 1024 / 1024).toFixed(1)} MB).`)
      return
    }
    console.log('Modelo existente parece truncado; baixando de novo.')
  }

  console.log('Baixando hand_landmarker.task…')
  const response = await fetch(URL)
  if (!response.ok) {
    throw new Error(`Download falhou: HTTP ${response.status}`)
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.length < MIN_BYTES) {
    throw new Error(`Arquivo suspeito: apenas ${buffer.length} bytes`)
  }

  await mkdir(dirname(dest), { recursive: true })
  await writeFile(dest, buffer)
  console.log(`Salvo em models/hand_landmarker.task (${(buffer.length / 1024 / 1024).toFixed(1)} MB).`)
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
