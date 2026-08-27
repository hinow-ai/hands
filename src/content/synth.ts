/**
 * Síntese de interação sobre uma página que não sabe que existimos.
 *
 * O detalhe que define esta camada: eventos sintéticos disparam os handlers de
 * JavaScript do site, mas NÃO disparam os comportamentos nativos do navegador.
 * Um `wheel` sintético não rola a página; um `mousedown`/`mousemove` sintético
 * não seleciona texto. Já um `click` sintético ativa a ação padrão e segue um
 * link normalmente.
 *
 * Daí a estratégia de duas camadas usada aqui: primeiro despachamos o evento
 * real; se o site o cancelar com `preventDefault()`, ele assumiu o controle
 * (é o caso de mapas e de qualquer canvas interativo) e paramos por aí. Se
 * ninguém cancelar, aplicamos nós mesmos o efeito nativo equivalente. Assim um
 * mesmo gesto rola uma página comum e dá zoom no Google Maps, sem precisar
 * saber em qual dos dois estamos.
 */

const MOUSE_DEFAULTS = {
  bubbles: true,
  cancelable: true,
  composed: true,
  view: window,
} as const

/** Marca usada para o cursor e o HUD se excluírem do hit-testing. */
export const OVERLAY_ATTR = 'data-gesturenav-overlay'

/**
 * Elemento realmente sob o ponto, atravessando shadow roots.
 *
 * `elementFromPoint` para na fronteira de um shadow root aberto e devolve o
 * host. Muitos componentes modernos — inclusive partes do próprio Chrome e de
 * design systems comuns — escondem o alvo clicável lá dentro.
 */
export function deepElementFromPoint(x: number, y: number): Element | null {
  let el = document.elementFromPoint(x, y)
  if (!el) return null

  // Ignora nossos próprios overlays, caso algum escape do pointer-events:none.
  if (el.closest?.(`[${OVERLAY_ATTR}]`)) {
    const stack = document.elementsFromPoint(x, y)
    el = stack.find((e) => !e.closest?.(`[${OVERLAY_ATTR}]`)) ?? null
    if (!el) return null
  }

  let guard = 0
  while (el && (el as Element & { shadowRoot?: ShadowRoot }).shadowRoot && guard++ < 12) {
    const inner = (el as Element & { shadowRoot: ShadowRoot }).shadowRoot.elementFromPoint(x, y)
    if (!inner || inner === el) break
    el = inner
  }
  return el
}

function mouseEvent(type: string, x: number, y: number, extra: MouseEventInit = {}): MouseEvent {
  return new MouseEvent(type, {
    ...MOUSE_DEFAULTS,
    clientX: x,
    clientY: y,
    screenX: x + window.screenX,
    screenY: y + window.screenY,
    button: 0,
    buttons: 0,
    detail: 1,
    ...extra,
  })
}

function pointerEvent(type: string, x: number, y: number, extra: PointerEventInit = {}): PointerEvent {
  return new PointerEvent(type, {
    ...MOUSE_DEFAULTS,
    clientX: x,
    clientY: y,
    screenX: x + window.screenX,
    screenY: y + window.screenY,
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
    button: 0,
    buttons: 0,
    width: 1,
    height: 1,
    pressure: 0,
    ...extra,
  })
}

/**
 * Mantém o estado de hover coerente.
 *
 * Sites reagem a `mouseover`/`mouseout` para menus e realces. Sem emitir a
 * saída do elemento anterior, menus abertos nunca fecham e a página acumula
 * estados presos.
 */
export class HoverTracker {
  private current: Element | null = null

  move(el: Element | null, x: number, y: number): void {
    if (el === this.current) {
      if (el) {
        el.dispatchEvent(pointerEvent('pointermove', x, y))
        el.dispatchEvent(mouseEvent('mousemove', x, y))
      }
      return
    }

    if (this.current) {
      const related = el ?? undefined
      this.current.dispatchEvent(pointerEvent('pointerout', x, y, { relatedTarget: related }))
      this.current.dispatchEvent(mouseEvent('mouseout', x, y, { relatedTarget: related }))
      this.current.dispatchEvent(
        pointerEvent('pointerleave', x, y, { relatedTarget: related, bubbles: false }),
      )
      this.current.dispatchEvent(
        mouseEvent('mouseleave', x, y, { relatedTarget: related, bubbles: false }),
      )
    }

    if (el) {
      const related = this.current ?? undefined
      el.dispatchEvent(pointerEvent('pointerover', x, y, { relatedTarget: related }))
      el.dispatchEvent(mouseEvent('mouseover', x, y, { relatedTarget: related }))
      el.dispatchEvent(pointerEvent('pointerenter', x, y, { relatedTarget: related, bubbles: false }))
      el.dispatchEvent(mouseEvent('mouseenter', x, y, { relatedTarget: related, bubbles: false }))
      el.dispatchEvent(pointerEvent('pointermove', x, y))
      el.dispatchEvent(mouseEvent('mousemove', x, y))
    }

    this.current = el
  }

  clear(): void {
    this.current = null
  }

  get element(): Element | null {
    return this.current
  }
}

/** Sequência completa de um clique, incluindo o foco que os sites esperam. */
export function synthClick(x: number, y: number): boolean {
  const el = deepElementFromPoint(x, y)
  if (!el) return false

  el.dispatchEvent(pointerEvent('pointerdown', x, y, { buttons: 1, pressure: 0.5 }))
  el.dispatchEvent(mouseEvent('mousedown', x, y, { buttons: 1 }))

  // Sites de formulário dependem do foco para validação e para o teclado.
  const focusable = el.closest<HTMLElement>(
    'a[href], button, input, select, textarea, [tabindex], [contenteditable]',
  )
  if (focusable && typeof focusable.focus === 'function') {
    focusable.focus({ preventScroll: true })
  }

  el.dispatchEvent(pointerEvent('pointerup', x, y))
  el.dispatchEvent(mouseEvent('mouseup', x, y))
  el.dispatchEvent(mouseEvent('click', x, y))

  return true
}

/** Início de um arraste. Devolve o elemento capturado, para os passos seguintes. */
export function synthDragStart(x: number, y: number): Element | null {
  const el = deepElementFromPoint(x, y)
  if (!el) return null
  el.dispatchEvent(pointerEvent('pointerdown', x, y, { buttons: 1, pressure: 0.5 }))
  el.dispatchEvent(mouseEvent('mousedown', x, y, { buttons: 1 }))
  return el
}

/**
 * Passo intermediário do arraste.
 *
 * Os eventos vão para o elemento capturado no início, não para quem está sob o
 * cursor agora — é assim que o navegador se comporta com o botão pressionado, e
 * é o que faz o pan de um mapa continuar mesmo quando o ponteiro sai do canvas.
 */
export function synthDragMove(target: Element | null, x: number, y: number): void {
  const el = target ?? deepElementFromPoint(x, y)
  if (!el) return
  el.dispatchEvent(pointerEvent('pointermove', x, y, { buttons: 1, pressure: 0.5 }))
  el.dispatchEvent(mouseEvent('mousemove', x, y, { buttons: 1 }))
}

/** Fim do arraste. `click` só é emitido se o ponteiro mal se moveu. */
export function synthDragEnd(target: Element | null, x: number, y: number, moved: boolean): void {
  const el = target ?? deepElementFromPoint(x, y)
  if (!el) return
  el.dispatchEvent(pointerEvent('pointerup', x, y))
  el.dispatchEvent(mouseEvent('mouseup', x, y))
  if (!moved) el.dispatchEvent(mouseEvent('click', x, y))
}

/** Sobe a árvore procurando um ancestral que realmente possa rolar. */
export function findScrollable(el: Element | null, deltaY: number): Element | Window {
  let node: Element | null = el
  let guard = 0

  while (node && guard++ < 40) {
    const style = getComputedStyle(node)
    const overflowY = style.overflowY
    const canScrollStyle = overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay'
    const room = node.scrollHeight - node.clientHeight > 2

    if (canScrollStyle && room) {
      const atTop = node.scrollTop <= 0
      const atBottom = node.scrollTop >= node.scrollHeight - node.clientHeight - 1
      // Um container que já chegou ao fim deve repassar a rolagem ao pai, senão
      // a página trava dentro de qualquer div com scroll próprio.
      if (!((deltaY < 0 && atTop) || (deltaY > 0 && atBottom))) {
        return node
      }
    }
    node = node.parentElement
  }
  return window
}

/**
 * Rolagem. Devolve `true` se o site tratou o evento por conta própria.
 *
 * O `wheel` sintético é despachado primeiro porque é o que mapas, editores e
 * visualizadores escutam. Só quando ninguém o cancela é que aplicamos a
 * rolagem nativa — que o evento sintético, sozinho, nunca provocaria.
 */
export function synthScroll(x: number, y: number, deltaX: number, deltaY: number): boolean {
  const el = deepElementFromPoint(x, y)
  const target = el ?? document.documentElement

  const evt = new WheelEvent('wheel', {
    ...MOUSE_DEFAULTS,
    clientX: x,
    clientY: y,
    deltaX,
    deltaY,
    deltaMode: 0,
  })

  const notCancelled = target.dispatchEvent(evt)
  if (!notCancelled) return true

  const scroller = findScrollable(el, deltaY)
  if (scroller === window) {
    window.scrollBy({ left: deltaX, top: deltaY, behavior: 'instant' as ScrollBehavior })
  } else {
    ;(scroller as Element).scrollLeft += deltaX
    ;(scroller as Element).scrollTop += deltaY
  }
  return false
}

/**
 * Zoom. Emite `wheel` com `ctrlKey`, que é exatamente como o navegador
 * representa um pinch de trackpad — e é o que mapas interpretam como zoom.
 *
 * Quando o site ignora o evento, aplicamos um zoom visual via CSS na imagem
 * sob o cursor, para que o gesto ainda faça algo útil numa página comum.
 */
export function synthZoom(x: number, y: number, delta: number): boolean {
  const el = deepElementFromPoint(x, y)
  const target = el ?? document.documentElement

  const evt = new WheelEvent('wheel', {
    ...MOUSE_DEFAULTS,
    clientX: x,
    clientY: y,
    deltaY: delta,
    deltaMode: 0,
    ctrlKey: true,
  })

  const notCancelled = target.dispatchEvent(evt)
  return !notCancelled
}

/** Navegação no histórico da aba. */
export function historyBack(): void {
  window.history.back()
}

export function historyForward(): void {
  window.history.forward()
}
