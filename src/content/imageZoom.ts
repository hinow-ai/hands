/**
 * Visualizador de imagem com zoom e pan por gesto.
 *
 * Serve a dois propósitos. É o caso de uso pedido — examinar uma foto de perto
 * sem tocar no computador — e é a saída sensata para o gesto de zoom numa
 * página comum: um site de notícias não escuta `wheel` com ctrl, então o zoom
 * não teria efeito nenhum se não houvesse isto.
 *
 * A imagem é aberta a partir do que estiver sob o cursor, considerando tanto
 * `<img>` quanto `background-image` em CSS, que é como boa parte das galerias
 * modernas exibe fotos.
 */

import { OVERLAY_ATTR } from './synth'

const STYLE = `
:host { all: initial; }
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 2147483646;
  background: rgba(8,8,10,0.92);
  backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity .18s ease;
  pointer-events: none;
  overflow: hidden;
}
.backdrop.on { opacity: 1; }
img {
  max-width: 92vw;
  max-height: 88vh;
  object-fit: contain;
  will-change: transform;
  transform-origin: center center;
  user-select: none;
  -webkit-user-drag: none;
  box-shadow: 0 20px 60px rgba(0,0,0,.6);
  border-radius: 4px;
}
.bar {
  position: absolute;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 9px 16px;
  border-radius: 999px;
  background: rgba(255,255,255,0.1);
  color: #fff;
  font: 500 12px ui-sans-serif, system-ui, -apple-system, sans-serif;
  white-space: nowrap;
}
.zoomval { font-variant-numeric: tabular-nums; color: #7ce6aa; min-width: 44px; }
.close {
  position: absolute;
  top: 20px;
  right: 24px;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: rgba(255,255,255,0.12);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font: 300 24px/1 ui-sans-serif, system-ui, sans-serif;
}
`

export class ImageViewer {
  private host: HTMLElement
  private shadow: ShadowRoot
  private backdrop!: HTMLElement
  private img!: HTMLImageElement
  private zoomLabel!: HTMLElement
  private closeBtn!: HTMLElement

  private scale = 1
  private offsetX = 0
  private offsetY = 0
  private open = false

  constructor() {
    this.host = document.createElement('div')
    this.host.setAttribute(OVERLAY_ATTR, '')
    this.shadow = this.host.attachShadow({ mode: 'closed' })

    const style = document.createElement('style')
    style.textContent = STYLE
    this.shadow.appendChild(style)

    const root = document.createElement('div')
    root.className = 'backdrop'
    root.innerHTML = `
      <img alt="" />
      <div class="close">&#215;</div>
      <div class="bar">
        <span class="zoomval">100%</span>
        <span>Pinça dupla: zoom &nbsp;·&nbsp; Pinça e arraste: mover &nbsp;·&nbsp; Punho: fechar</span>
      </div>
    `
    this.shadow.appendChild(root)

    this.backdrop = root
    this.img = root.querySelector('img') as HTMLImageElement
    this.zoomLabel = root.querySelector('.zoomval') as HTMLElement
    this.closeBtn = root.querySelector('.close') as HTMLElement
  }

  /** Procura uma imagem utilizável no ponto indicado. */
  static findImageAt(x: number, y: number): string | null {
    const el = document.elementFromPoint(x, y)
    if (!el) return null

    let node: Element | null = el
    let guard = 0
    while (node && guard++ < 8) {
      if (node instanceof HTMLImageElement && node.currentSrc) {
        return node.currentSrc
      }
      if (node instanceof HTMLElement) {
        const bg = getComputedStyle(node).backgroundImage
        const match = /url\((['"]?)(.*?)\1\)/.exec(bg)
        // Gradientes também aparecem em background-image; só nos interessa url().
        if (match && match[2] && !match[2].startsWith('data:image/svg')) {
          return match[2]
        }
      }
      node = node.parentElement
    }
    return null
  }

  show(src: string): void {
    if (!this.host.isConnected) document.documentElement.appendChild(this.host)
    this.img.src = src
    this.scale = 1
    this.offsetX = 0
    this.offsetY = 0
    this.apply()
    // Um frame antes de ligar a classe, senão a transição de opacidade não roda.
    requestAnimationFrame(() => this.backdrop.classList.add('on'))
    this.backdrop.style.pointerEvents = 'auto'
    this.open = true
  }

  hide(): void {
    this.backdrop.classList.remove('on')
    this.backdrop.style.pointerEvents = 'none'
    this.open = false
    // Espera a transição antes de soltar a imagem, para não piscar em branco.
    setTimeout(() => {
      if (!this.open) this.img.removeAttribute('src')
    }, 220)
  }

  get isOpen(): boolean {
    return this.open
  }

  /** Multiplica o zoom. `factor` acima de 1 aproxima. */
  zoomBy(factor: number): void {
    this.scale = Math.min(8, Math.max(0.4, this.scale * factor))
    this.clampOffset()
    this.apply()
  }

  setZoom(scale: number): void {
    this.scale = Math.min(8, Math.max(0.4, scale))
    this.clampOffset()
    this.apply()
  }

  panBy(dx: number, dy: number): void {
    this.offsetX += dx
    this.offsetY += dy
    this.clampOffset()
    this.apply()
  }

  /** Impede que a imagem seja arrastada para fora da tela e "suma". */
  private clampOffset(): void {
    const rect = this.img.getBoundingClientRect()
    const maxX = Math.max(0, (rect.width * this.scale - window.innerWidth) / 2 + 80)
    const maxY = Math.max(0, (rect.height * this.scale - window.innerHeight) / 2 + 80)
    this.offsetX = Math.min(maxX, Math.max(-maxX, this.offsetX))
    this.offsetY = Math.min(maxY, Math.max(-maxY, this.offsetY))
  }

  private apply(): void {
    this.img.style.transform = `translate3d(${this.offsetX}px, ${this.offsetY}px, 0) scale(${this.scale})`
    this.zoomLabel.textContent = `${Math.round(this.scale * 100)}%`
  }

  get zoom(): number {
    return this.scale
  }

  /** Retângulo do botão de fechar, para o controlador tratá-lo como alvo. */
  closeButtonRect(): DOMRect {
    return this.closeBtn.getBoundingClientRect()
  }

  destroy(): void {
    this.host.remove()
  }
}
