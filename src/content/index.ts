/**
 * Ponto de entrada injetado em toda página e em todo frame.
 *
 * O mesmo arquivo cumpre dois papéis conforme onde acaba rodando:
 *
 * - No frame principal, é o comandante: recebe os gestos do service worker,
 *   desenha o cursor e decide o que fazer.
 * - Dentro de um iframe, é o executor: não desenha nada nem recebe gestos, só
 *   escuta comandos do frame pai e os aplica ao seu próprio documento. É essa
 *   metade que permite operar conteúdo embutido de outra origem, onde nenhum
 *   evento sintético do pai chegaria.
 */

import { GestureController } from './controller'
import { FrameAgent } from './frameAgent'
import { isTopFrame, listenForFrameCommands } from './frames'
import { RuntimeMessage } from '../core/wire'

/**
 * Marca de inicialização, contra rodar duas vezes no mesmo frame.
 *
 * Este arquivo chega à página por dois caminhos: a declaração no manifest, que
 * cobre páginas carregadas a partir de agora, e a injeção programática, que
 * alcança as abas que já estavam abertas. Numa aba em que os dois acontecem,
 * sem esta marca haveria dois overlays, dois laços de animação e dois
 * listeners — e cada clique sairia em dobro.
 *
 * A marca sobrevive entre injeções porque todas compartilham o mesmo mundo
 * isolado da extensão dentro daquele frame.
 */
const FLAG = '__gestureNavLoaded'
const scope = globalThis as typeof globalThis & { [FLAG]?: boolean }

if (!scope[FLAG]) {
  scope[FLAG] = true

  if (isTopFrame()) {
    const controller = new GestureController()

    chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
      switch (message?.type) {
        case 'GN_FRAME':
          controller.onGestureFrame(message.frame)
          break
        case 'GN_ENABLE':
          controller.enable()
          break
        case 'GN_DISABLE':
          controller.disable()
          break
        case 'GN_SET_CONFIG':
          controller.applyTuning(message.config)
          break
        case 'GN_PING':
          // Responder é o que distingue "estou aqui" de "esta aba não tem
          // content script" — sem resposta, o envio rejeita e o service worker
          // sabe que precisa injetar.
          sendResponse({ present: true })
          break
      }
      return false
    })

    // Uma navegação com History API não recria o content script, mas troca a
    // página inteira sob o overlay; reanexar mantém o cursor funcionando.
    window.addEventListener('pageshow', () => {
      if (controller.isEnabled) controller.enable()
    })

    window.addEventListener('beforeunload', () => controller.disable())
  } else {
    // Frames filhos só executam. Não há overlay nem laço de animação aqui.
    const agent = new FrameAgent()
    listenForFrameCommands((command) => agent.execute(command))
  }
}
