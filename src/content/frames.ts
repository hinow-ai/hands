/**
 * Alcance para dentro de iframes, inclusive cross-origin.
 *
 * O content script é injetado em TODOS os frames, então cada iframe tem a sua
 * própria cópia deste código rodando lá dentro, com acesso pleno ao DOM local.
 * O que não existe é uma ponte: o frame de cima não pode tocar no DOM do frame
 * de baixo quando as origens diferem.
 *
 * `postMessage` é justamente a ponte que a plataforma permite atravessar
 * origens. O frame de cima descobre que o cursor está sobre um `<iframe>`,
 * converte a coordenada para o sistema local daquele frame e manda o comando;
 * a cópia lá dentro executa com os privilégios que tem sobre o próprio
 * documento. É por isso que isto funciona no Google Maps sem chave de API e
 * sem nenhuma cooperação do site.
 */

export const FRAME_MSG = '__gesture_nav_cmd__'

export type FrameCommand =
  | { kind: 'move'; x: number; y: number }
  | { kind: 'click'; x: number; y: number }
  | { kind: 'dragstart'; x: number; y: number }
  | { kind: 'dragmove'; x: number; y: number }
  | { kind: 'dragend'; x: number; y: number; moved: boolean }
  | { kind: 'scroll'; x: number; y: number; dx: number; dy: number }
  | { kind: 'zoom'; x: number; y: number; delta: number }
  | { kind: 'leave' }

export interface FrameEnvelope {
  [FRAME_MSG]: true
  command: FrameCommand
}

export const isTopFrame = (): boolean => {
  try {
    return window.top === window.self
  } catch {
    // Acessar window.top pode lançar em contextos cross-origin restritos;
    // nesse caso certamente não somos o topo.
    return false
  }
}

/**
 * Converte um ponto do viewport atual para o viewport de um iframe filho.
 *
 * Considera a borda e o padding do elemento, que deslocam a origem do
 * documento interno em relação ao retângulo do próprio iframe.
 */
export function toFrameCoords(
  iframe: HTMLIFrameElement,
  x: number,
  y: number,
): { x: number; y: number } {
  const rect = iframe.getBoundingClientRect()
  const style = getComputedStyle(iframe)
  const borderLeft = parseFloat(style.borderLeftWidth) || 0
  const borderTop = parseFloat(style.borderTopWidth) || 0
  const padLeft = parseFloat(style.paddingLeft) || 0
  const padTop = parseFloat(style.paddingTop) || 0

  return {
    x: x - rect.left - borderLeft - padLeft,
    y: y - rect.top - borderTop - padTop,
  }
}

export function sendToFrame(iframe: HTMLIFrameElement, command: FrameCommand): void {
  const win = iframe.contentWindow
  if (!win) return
  const envelope: FrameEnvelope = { [FRAME_MSG]: true, command }
  try {
    win.postMessage(envelope, '*')
  } catch {
    // Um frame já descarregado lança aqui; não há o que fazer além de ignorar.
  }
}

/**
 * Escuta comandos vindos do frame pai.
 *
 * Só aceitamos mensagens cuja origem seja literalmente a janela pai. Um frame
 * pai já controla o tamanho, a visibilidade e a navegação do filho, então isso
 * não amplia a superfície de ataque — e fecha a porta para qualquer outra
 * janela tentar dirigir a página por essa via.
 */
export function listenForFrameCommands(handler: (command: FrameCommand) => void): () => void {
  const onMessage = (event: MessageEvent) => {
    if (event.source !== window.parent) return
    const data = event.data as FrameEnvelope | null
    if (!data || typeof data !== 'object' || data[FRAME_MSG] !== true) return
    handler(data.command)
  }

  window.addEventListener('message', onMessage)
  return () => window.removeEventListener('message', onMessage)
}
