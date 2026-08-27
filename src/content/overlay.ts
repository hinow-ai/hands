/**
 * Camada visual: cursor, realce do alvo e HUD de estado.
 *
 * Tudo vive dentro de um Shadow DOM com `all: initial` na raiz. Sem esse
 * isolamento, o CSS do site vaza para dentro do cursor — e há muita página com
 * regras do tipo `div { position: static !important }` capazes de destruir o
 * overlay. O shadow root também evita o caminho inverso: nada do nosso estilo
 * chega ao site.
 *
 * O feedback visual não é decoração. Sem um alvo realçado, a pessoa não tem
 * como saber o que vai ser clicado antes de fechar a pinça, e a taxa de erro
 * dispara.
 */

import { OVERLAY_ATTR } from './synth'

const STYLE = `
:host { all: initial; }
.root {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 2147483647;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
}
.cursor {
  position: absolute;
  left: 0;
  top: 0;
  width: 34px;
  height: 34px;
  margin-left: -17px;
  margin-top: -17px;
  border-radius: 50%;
  border: 2px solid rgba(255,255,255,0.9);
  box-shadow: 0 0 0 1.5px rgba(0,0,0,0.45), 0 2px 10px rgba(0,0,0,0.35);
  background: rgba(255,255,255,0.12);
  backdrop-filter: blur(1px);
  will-change: transform;
  transition: width .12s ease, height .12s ease, margin .12s ease, border-color .12s ease, background-color .12s ease;
}
.cursor.hidden { opacity: 0; }
.cursor.clutch {
  border-color: rgba(255,205,80,0.95);
  background: rgba(255,205,80,0.22);
}
.cursor.pinching {
  width: 20px; height: 20px; margin-left: -10px; margin-top: -10px;
  border-color: rgba(90,220,150,1);
  background: rgba(90,220,150,0.35);
}
.cursor.dragging {
  border-color: rgba(90,190,255,1);
  background: rgba(90,190,255,0.3);
}
.dot {
  position: absolute;
  left: 50%; top: 50%;
  width: 4px; height: 4px;
  margin: -2px 0 0 -2px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 0 3px rgba(0,0,0,.6);
}
/* Arco de progresso do clique por permanência. */
.ring {
  position: absolute;
  left: 0; top: 0;
  width: 44px; height: 44px;
  margin-left: -22px; margin-top: -22px;
  pointer-events: none;
}
.ring circle {
  fill: none;
  stroke: rgba(120,230,170,0.95);
  stroke-width: 3;
  stroke-linecap: round;
  transform: rotate(-90deg);
  transform-origin: 50% 50%;
}
.highlight {
  position: absolute;
  border: 2px solid rgba(90,190,255,0.9);
  border-radius: 6px;
  background: rgba(90,190,255,0.12);
  box-shadow: 0 0 0 1px rgba(0,0,0,0.25);
  transition: all .09s cubic-bezier(.2,.8,.2,1);
  opacity: 0;
}
.highlight.on { opacity: 1; }
.hud {
  position: absolute;
  left: 50%;
  bottom: 22px;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  border-radius: 999px;
  background: rgba(18,18,22,0.82);
  color: #fff;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: .01em;
  box-shadow: 0 4px 20px rgba(0,0,0,.4);
  backdrop-filter: blur(8px);
  white-space: nowrap;
}
.hud .sep { opacity: .3; }
.hud .state { color: #7ce6aa; font-variant-numeric: tabular-nums; }
.hud .muted { opacity: .65; }
.toast {
  position: absolute;
  left: 50%;
  top: 26px;
  transform: translateX(-50%) translateY(-8px);
  padding: 9px 16px;
  border-radius: 10px;
  background: rgba(18,18,22,0.9);
  color: #fff;
  font-size: 13px;
  box-shadow: 0 6px 24px rgba(0,0,0,.45);
  opacity: 0;
  transition: opacity .18s ease, transform .18s ease;
}
.toast.on { opacity: 1; transform: translateX(-50%) translateY(0); }
`

export type CursorMode = 'idle' | 'normal' | 'pinching' | 'dragging' | 'clutch' | 'hidden'

export class Overlay {
  private host: HTMLElement
  private shadow: ShadowRoot
  private cursor!: HTMLElement
  private ringCircle!: SVGCircleElement
  private highlight!: HTMLElement
  private hud!: HTMLElement
  private hudState!: HTMLElement
  private hudHint!: HTMLElement
  private toast!: HTMLElement
  private toastTimer = 0
  private readonly ringLength: number

  constructor() {
    this.host = document.createElement('div')
    this.host.setAttribute(OVERLAY_ATTR, '')
    this.host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647'

    this.shadow = this.host.attachShadow({ mode: 'closed' })
    const style = document.createElement('style')
    style.textContent = STYLE
    this.shadow.appendChild(style)

    const root = document.createElement('div')
    root.className = 'root'
    root.innerHTML = `
      <div class="highlight"></div>
      <div class="cursor hidden">
        <div class="dot"></div>
        <svg class="ring" viewBox="0 0 44 44"><circle cx="22" cy="22" r="20"></circle></svg>
      </div>
      <div class="hud">
        <span class="state">—</span>
        <span class="sep">|</span>
        <span class="muted hint"></span>
      </div>
      <div class="toast"></div>
    `
    this.shadow.appendChild(root)

    this.cursor = root.querySelector('.cursor') as HTMLElement
    this.ringCircle = root.querySelector('.ring circle') as SVGCircleElement
    this.highlight = root.querySelector('.highlight') as HTMLElement
    this.hud = root.querySelector('.hud') as HTMLElement
    this.hudState = root.querySelector('.state') as HTMLElement
    this.hudHint = root.querySelector('.hint') as HTMLElement
    this.toast = root.querySelector('.toast') as HTMLElement

    const r = 20
    this.ringLength = 2 * Math.PI * r
    this.ringCircle.style.strokeDasharray = String(this.ringLength)
    this.ringCircle.style.strokeDashoffset = String(this.ringLength)
  }

  attach(): void {
    if (!this.host.isConnected) {
      // documentElement em vez de body: há páginas que substituem o body
      // inteiro durante a navegação, e o overlay iria junto.
      document.documentElement.appendChild(this.host)
    }
  }

  detach(): void {
    this.host.remove()
  }

  /** `transform` em vez de left/top mantém a animação na thread de composição. */
  moveCursor(x: number, y: number): void {
    this.cursor.style.transform = `translate3d(${x}px, ${y}px, 0)`
  }

  setCursorMode(mode: CursorMode): void {
    this.cursor.classList.toggle('hidden', mode === 'hidden' || mode === 'idle')
    this.cursor.classList.toggle('pinching', mode === 'pinching')
    this.cursor.classList.toggle('dragging', mode === 'dragging')
    this.cursor.classList.toggle('clutch', mode === 'clutch')
  }

  /** Progresso 0..1 do arco de permanência. */
  setDwellProgress(p: number): void {
    const clamped = Math.max(0, Math.min(1, p))
    this.ringCircle.style.strokeDashoffset = String(this.ringLength * (1 - clamped))
  }

  showHighlight(rect: DOMRect | null): void {
    if (!rect || rect.width < 1 || rect.height < 1) {
      this.highlight.classList.remove('on')
      return
    }
    const pad = 3
    this.highlight.style.left = `${rect.left - pad}px`
    this.highlight.style.top = `${rect.top - pad}px`
    this.highlight.style.width = `${rect.width + pad * 2}px`
    this.highlight.style.height = `${rect.height + pad * 2}px`
    this.highlight.classList.add('on')
  }

  setHud(state: string, hint: string): void {
    this.hudState.textContent = state
    this.hudHint.textContent = hint
  }

  setHudVisible(visible: boolean): void {
    this.hud.style.display = visible ? 'flex' : 'none'
  }

  showToast(text: string, ms = 1400): void {
    this.toast.textContent = text
    this.toast.classList.add('on')
    clearTimeout(this.toastTimer)
    this.toastTimer = window.setTimeout(() => this.toast.classList.remove('on'), ms)
  }

  get element(): HTMLElement {
    return this.host
  }
}
