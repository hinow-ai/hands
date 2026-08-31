/**
 * Aba de concessão da câmera.
 *
 * Um documento offscreen não tem interface, e o Chrome não exibe a caixa de
 * permissão para um contexto sem interface: `getUserMedia` lá dentro falha
 * direto com `NotAllowedError` enquanto a origem da extensão não tiver a
 * permissão já registrada. Como a permissão é gravada por origem, basta pedi-la
 * uma vez de dentro de uma página visível da própria extensão — esta — e o
 * offscreen passa a abrir a câmera sem prompt nenhum, em qualquer site.
 *
 * O stream é encerrado no mesmo instante em que chega: aqui só interessa o
 * efeito colateral de registrar a permissão, e manter a webcam presa numa aba
 * esquecida acenderia o LED sem motivo.
 */

import { RuntimeMessage } from '../core/wire'

const grantBtn = document.getElementById('grant') as HTMLButtonElement
const msgEl = document.getElementById('msg') as HTMLDivElement
const blockedHelp = document.getElementById('blockedHelp') as HTMLDivElement

function say(text: string, kind: 'ok' | 'err'): void {
  msgEl.textContent = text
  msgEl.className = `msg ${kind}`
  msgEl.hidden = false
}

/** Avisa o service worker e sai de cena; a extensão religa sozinha. */
function finish(): void {
  chrome.runtime.sendMessage({ type: 'GN_PERMISSION_GRANTED' } satisfies RuntimeMessage).catch(() => {})
  say('Câmera liberada. Pode fechar esta aba e usar os gestos.', 'ok')
  grantBtn.disabled = true
  setTimeout(() => window.close(), 1500)
}

async function request(): Promise<void> {
  grantBtn.disabled = true
  blockedHelp.hidden = true

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
    for (const track of stream.getTracks()) track.stop()
    finish()
  } catch (err) {
    const name = (err as Error)?.name
    grantBtn.disabled = false

    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
      say('Acesso negado.', 'err')
      blockedHelp.hidden = false
    } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      say('Nenhuma câmera encontrada neste computador.', 'err')
    } else if (name === 'NotReadableError') {
      // Driver ocupado: outro programa (ou outra aba) está com a webcam presa.
      say('A câmera existe, mas está em uso por outro programa. Feche-o e tente de novo.', 'err')
    } else {
      say((err as Error)?.message ?? 'Falha ao abrir a câmera.', 'err')
    }
  }
}

grantBtn.addEventListener('click', () => void request())

/**
 * Se a permissão já estiver concedida, não há nada a pedir — o caso comum de
 * reabrir esta aba depois de uma falha passageira da câmera.
 */
async function checkExisting(): Promise<void> {
  try {
    const status = await navigator.permissions.query({
      name: 'camera' as PermissionName,
    })
    if (status.state === 'granted') finish()
    else if (status.state === 'denied') blockedHelp.hidden = false
  } catch {
    // Nem todo navegador expõe 'camera' no Permissions API; o botão cobre.
  }
}

void checkExisting()
