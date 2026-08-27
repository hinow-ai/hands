/**
 * Servidor estático para o campo de teste.
 *
 * Um arquivo servido por http:// em vez de aberto por file:// porque as regras
 * de origem do Chrome tratam os dois de forma diferente, e queremos exercitar a
 * extensão nas mesmas condições de um site real.
 */

import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { dirname, join, extname, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(dirname(fileURLToPath(import.meta.url))), 'demo')
const PORT = Number(process.env.PORT ?? 5599)

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
}

createServer(async (req, res) => {
  const path = (req.url ?? '/').split('?')[0]
  // normalize antes de juntar, para que "../" não escape do diretório da demo.
  const relative = normalize(path === '/' ? '/index.html' : path).replace(/^(\.\.[/\\])+/, '')
  const file = join(root, relative)

  if (!file.startsWith(root)) {
    res.writeHead(403).end('Forbidden')
    return
  }

  try {
    const body = await readFile(file)
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('Não encontrado')
  }
}).listen(PORT, () => {
  console.log(`Campo de teste em http://localhost:${PORT}`)
})
