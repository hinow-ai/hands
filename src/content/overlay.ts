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

import { COMMANDS, CommandId } from '../core/gestures'
import { OVERLAY_ATTR } from './synth'

/**
 * Cor por dedo, na ordem polegar → mínimo.
 *
 * As duas mãos ficam em famílias opostas — quente à esquerda, fria à direita —
 * porque a primeira pergunta que a pessoa faz olhando a tela é "qual dessas é a
 * minha mão direita?", e a resposta precisa vir antes de qualquer detalhe.
 * Dentro de cada família a variação separa os dedos entre si.
 */
const LEFT_TIP_COLORS = ['#ff6b6b', '#ff8e8e', '#ff5252', '#e74c3c', '#c0392b']
const RIGHT_TIP_COLORS = ['#00d4ff', '#4ecdc4', '#3498db', '#2980b9', '#1abc9c']

/** Posição de uma ponta, em pixels do viewport. */
export interface TipPoint {
  x: number
  y: number
}

/** O que o painel precisa saber a cada frame. */
export interface GuideState {
  /** Há uma mão no quadro. */
  present: boolean
  /** Qual comando está ativo agora, se algum. */
  active: CommandId | null
}

interface GuidePanel {
  el: HTMLElement
  rows: Map<CommandId, HTMLElement>
}

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
.hud .state.blocked { color: #f8a5a5; }
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

/* ---------------------------------------------------- pontas dos dedos
   Mostram o que o modelo está enxergando. Sem isso, quando o rastreamento
   perde um dedo a pessoa só percebe pelo gesto que não sai — e não tem como
   saber se o problema é a mão, a luz ou o enquadramento. */
.tip {
  position: absolute;
  left: 0; top: 0;
  width: 14px; height: 14px;
  margin-left: -7px; margin-top: -7px;
  border-radius: 50%;
  opacity: 0;
  will-change: transform;
  /* O contorno escuro garante contraste sobre fundo claro e sobre fundo
     colorido; sem ele a bolinha some em metade das páginas. */
  box-shadow: 0 0 0 1.5px rgba(0,0,0,0.55), 0 0 10px 2px var(--glow);
}
.tip.on { opacity: 0.95; }
/* O indicador comanda o cursor: o anel branco é o que o distingue dos outros
   quatro sem depender de lembrar qual cor é qual. */
.tip.index { border: 2px solid rgba(255,255,255,0.95); }

/* ---------------------------------------------------------------- guia */
.guide {
  position: absolute;
  bottom: 16px;
  width: 234px;
  padding: 10px 11px;
  border-radius: 12px;
  background: rgba(14,16,20,0.93);
  color: #fff;
  font-size: 12.5px;
  box-shadow: 0 6px 26px rgba(0,0,0,.5);
  backdrop-filter: blur(8px);
  transition: opacity .16s ease;
}
.guide { right: 16px; }
/* Mão fora do quadro: continua legível como referência, mas sai do primeiro
   plano da atenção. */
.guide.absent { opacity: .42; }
.ghead {
  display: flex;
  align-items: center;
  gap: 7px;
  padding-bottom: 7px;
  margin-bottom: 5px;
  border-bottom: 1px solid rgba(255,255,255,.15);
  font-size: 11.5px;
  font-weight: 650;
  letter-spacing: .02em;
}
.gdot { width: 8px; height: 8px; border-radius: 50%; background: #6b7280; flex: none; }
.guide.present .gdot { background: #7ce6aa; }
.grow {
  display: grid;
  grid-template-columns: 21px 1fr auto;
  gap: 8px;
  align-items: center;
  padding: 4px 6px;
  border-radius: 7px;
  border-left: 3px solid transparent;
}
.grow .gi { font-size: 15px; line-height: 1.1; text-align: center; }
.grow .ga { font-weight: 600; }
.grow .gf { color: #a9b2c1; font-size: 11px; }
.grow .gnow {
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: .05em;
  text-transform: uppercase;
  color: #7ce6aa;
  visibility: hidden;
}
/* O destaque não é só a cor: muda o fundo, ganha barra à esquerda e escreve
   "agora". Quem não distingue o verde continua sabendo qual linha está ativa. */
.grow.on { background: rgba(124,230,170,.16); border-left-color: #7ce6aa; }
.grow.on .gf { color: #d8f6e7; }
.grow.on .gnow { visibility: visible; }
/* Parar é o oposto de agir, e a cor precisa dizer isso sozinha. */
.grow.on.cmd-stop { background: rgba(248,165,165,.16); border-left-color: #f8a5a5; }
.grow.on.cmd-stop .gf { color: #f9dcdc; }
.grow.on.cmd-stop .gnow { color: #f8a5a5; }
@media (prefers-reduced-motion: reduce) {
  .guide, .highlight, .cursor, .toast { transition: none; }
}
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
  private tipsLeft!: HTMLElement[]
  private tipsRight!: HTMLElement[]
  private guide!: GuidePanel
  /** O guia muda poucas vezes por segundo; o loop roda a 60. Ver `setGuide`. */
  private lastGuideKey = ''
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

    this.tipsLeft = this.buildTips(root, 'left')
    this.tipsRight = this.buildTips(root, 'right')
    this.guide = this.buildGuide(root)

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

  /** Cinco bolinhas por mão, criadas uma vez e só transladadas depois. */
  private buildTips(root: HTMLElement, side: 'left' | 'right'): HTMLElement[] {
    const colors = side === 'left' ? LEFT_TIP_COLORS : RIGHT_TIP_COLORS
    return colors.map((color, i) => {
      const el = document.createElement('div')
      el.className = i === 1 ? 'tip index' : 'tip'
      el.style.background = color
      el.style.setProperty('--glow', `${color}66`)
      root.appendChild(el)
      return el
    })
  }

  private buildGuide(root: HTMLElement): GuidePanel {
    const el = document.createElement('div')
    el.className = 'guide'

    const head = document.createElement('div')
    head.className = 'ghead'
    head.innerHTML = `
      <span class="gdot"></span>
      <span>Sua mão</span>
    `
    el.appendChild(head)

    const rows = new Map<CommandId, HTMLElement>()
    for (const entry of COMMANDS) {
      const row = document.createElement('div')
      // A classe do comando permite dar ao "bloquear" a cor do que ele faz:
      // aceso em verde, ele diria o contrário do que significa.
      row.className = `grow cmd-${entry.id}`
      row.innerHTML = `
        <span class="gi">${entry.icon}</span>
        <span>
          <span class="ga">${entry.action}</span><br />
          <span class="gf">${entry.fingers}</span>
        </span>
        <span class="gnow">agora</span>
      `
      el.appendChild(row)
      rows.set(entry.id, row)
    }

    root.appendChild(el)
    return { el, rows }
  }

  /**
   * Posiciona as pontas. Recebe pixels já convertidos: a conversão depende da
   * área ativa configurada, que é assunto de quem mapeia mão para tela.
   */
  setFingertips(left: TipPoint[] | null, right: TipPoint[] | null): void {
    const paint = (els: HTMLElement[], pts: TipPoint[] | null) => {
      for (let i = 0; i < els.length; i++) {
        const p = pts?.[i]
        const el = els[i]
        if (!p) {
          el.classList.remove('on')
          continue
        }
        el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0)`
        el.classList.add('on')
      }
    }
    paint(this.tipsLeft, left)
    paint(this.tipsRight, right)
  }

  setTipsVisible(visible: boolean): void {
    const display = visible ? '' : 'none'
    for (const el of [...this.tipsLeft, ...this.tipsRight]) el.style.display = display
  }

  /**
   * Reflete o estado da mão no painel.
   *
   * O loop chama isto a cada frame, mas o conteúdo só muda quando um gesto
   * muda — algumas vezes por segundo. A chave de comparação evita mexer em
   * dezenas de elementos sessenta vezes por segundo para reescrever o mesmo.
   */
  setGuide(state: GuideState): void {
    const key = `${state.present}|${state.active}`
    if (key === this.lastGuideKey) return
    this.lastGuideKey = key

    this.guide.el.classList.toggle('present', state.present)
    this.guide.el.classList.toggle('absent', !state.present)

    for (const row of this.guide.rows.values()) row.classList.remove('on')
    if (state.present && state.active) this.guide.rows.get(state.active)?.classList.add('on')
  }

  setGuideVisible(visible: boolean): void {
    this.guide.el.style.display = visible ? '' : 'none'
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

  setHud(state: string, hint: string, tone: 'ok' | 'blocked' = 'ok'): void {
    this.hudState.textContent = state
    this.hudHint.textContent = hint
    // "Bloqueado" escrito em verde diz duas coisas opostas ao mesmo tempo.
    this.hudState.classList.toggle('blocked', tone === 'blocked')
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
