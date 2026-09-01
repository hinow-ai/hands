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

import { COMMANDS_ACTION, COMMANDS_SCROLL, CommandEntry, CommandId, HandArt } from '../core/gestures'
import type { ThemeMode } from '../core/wire'
import { OVERLAY_ATTR } from './synth'

/**
 * Texto na língua do navegador. `chrome.i18n` escolhe a pasta de `_locales`
 * pelo idioma da interface do Chrome e cai no `default_locale` (inglês) quando
 * não há tradução — é o mecanismo nativo da plataforma, então não há nada a
 * detectar nem a persistir do nosso lado.
 */
const t = (key: string): string => chrome.i18n.getMessage(key) || key

/**
 * URL da arte dentro do pacote da extensão.
 *
 * Precisa passar por `getURL` — o content script roda na origem do site, e um
 * caminho relativo procuraria o desenho no servidor da página. Os arquivos
 * estão em `web_accessible_resources` justamente para este acesso.
 */
const artUrl = (art: HandArt): string => chrome.runtime.getURL(`img/hand-${art}.png`)

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

/**
 * O que os painéis precisam saber a cada frame.
 *
 * Em termos de PAPEL, não de lado da tela: qual mão cumpre qual papel é
 * assunto do modo canhoto, e o controlador não deveria ter de saber onde o
 * painel foi parar.
 */
export interface GuideState {
  /** A mão que rola está no quadro, e qual comando dela está ativo. */
  scrollPresent: boolean
  scrollActive: CommandId | null
  /** Idem para a mão que escolhe e clica. */
  actionPresent: boolean
  actionActive: CommandId | null
}

interface GuidePanel {
  el: HTMLElement
  title: HTMLElement
  rows: Map<CommandId, HTMLElement>
}

const STYLE = `
:host { all: initial; }
/* Um só conjunto de regras para os dois temas: as cores saem de variáveis, e
   trocar de tema é trocar a classe da raiz. Duplicar as regras por tema é o
   caminho garantido para uma delas ficar para trás na próxima mudança. */
.root {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 2147483647;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;

  --panel: rgba(14,16,20,0.93);
  --panel-hud: rgba(18,18,22,0.86);
  --fg: #ffffff;
  --muted: #a9b2c1;
  --line: rgba(255,255,255,.15);
  --accent: #7ce6aa;
  --accent-soft: rgba(124,230,170,.16);
  --accent-text: #d8f6e7;
  --danger: #f8a5a5;
  --danger-soft: rgba(248,165,165,.16);
  --danger-text: #f9dcdc;
  --idle-dot: #6b7280;
  --shadow: 0 6px 26px rgba(0,0,0,.5);
}
/* Claro: o painel vira papel sobre a página, e o verde escurece para manter
   contraste de texto sobre fundo branco — o mesmo verde do escuro sumiria. */
.root.light {
  --panel: rgba(255,255,255,0.96);
  --panel-hud: rgba(255,255,255,0.94);
  --fg: #16181d;
  --muted: #5b6472;
  --line: rgba(0,0,0,.12);
  --accent: #0f9d58;
  --accent-soft: rgba(15,157,88,.14);
  --accent-text: #10603c;
  --danger: #d93025;
  --danger-soft: rgba(217,48,37,.12);
  --danger-text: #8c1d16;
  --idle-dot: #b6bcc7;
  --shadow: 0 6px 22px rgba(0,0,0,.18);
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
/* Arco de progresso do clique por permanência. Centrado na bolinha: o ponto
   de referência é o centro do cursor (50%/50%), não o canto — ancorar no
   canto deslocava o arco 17px para cima e para a esquerda do alvo real. */
.ring {
  position: absolute;
  left: 50%; top: 50%;
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
  background: var(--panel-hud);
  /* A borda é o que separa um painel claro de uma página branca: a sombra
     sozinha some em fundo claro, e o painel parece flutuar sem contorno. */
  border: 1px solid var(--line);
  color: var(--fg);
  font-size: 12px;
  font-weight: 500;
  letter-spacing: .01em;
  box-shadow: var(--shadow);
  backdrop-filter: blur(8px);
  white-space: nowrap;
}
.hud .sep { opacity: .3; }
.hud .state { color: var(--accent); font-variant-numeric: tabular-nums; font-weight: 650; }
.hud .state.blocked { color: var(--danger); }
.hud .muted { color: var(--muted); }
.toast {
  position: absolute;
  left: 50%;
  top: 26px;
  transform: translateX(-50%) translateY(-8px);
  padding: 9px 16px;
  border-radius: 10px;
  background: var(--panel);
  color: var(--fg);
  font-size: 13px;
  box-shadow: var(--shadow);
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
  width: 238px;
  padding: 10px 11px;
  border-radius: 12px;
  background: var(--panel);
  border: 1px solid var(--line);
  color: var(--fg);
  font-size: 12.5px;
  box-shadow: var(--shadow);
  backdrop-filter: blur(8px);
  transition: opacity .16s ease;
}
.guide.left { left: 16px; }
.guide.right { right: 16px; }
/* Mão fora do quadro: continua legível como referência, mas sai do primeiro
   plano da atenção. */
.guide.absent { opacity: .42; }
.ghead {
  display: flex;
  align-items: center;
  gap: 7px;
  padding-bottom: 7px;
  margin-bottom: 5px;
  border-bottom: 1px solid var(--line);
  font-size: 11.5px;
  font-weight: 650;
  letter-spacing: .02em;
}
.gdot { width: 8px; height: 8px; border-radius: 50%; background: var(--idle-dot); flex: none; }
.guide.present .gdot { background: var(--accent); }
.grow {
  display: grid;
  grid-template-columns: 26px 1fr auto;
  gap: 9px;
  align-items: center;
  padding: 5px 6px;
  border-radius: 7px;
  border-left: 3px solid transparent;
}
/* O desenho da mão entra como MÁSCARA pintada por currentColor: um arquivo
   só serve aos dois temas, e a linha ativa tinge o ícone junto com o texto,
   sem precisar de uma segunda arte colorida. */
.grow .gi {
  width: 26px;
  height: 26px;
  background: currentColor;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-position: center;
  mask-position: center;
  -webkit-mask-size: contain;
  mask-size: contain;
  opacity: .78;
}
.grow.on .gi { opacity: 1; }
.grow .gi.flip { transform: scaleX(-1); }
.grow .ga { font-weight: 600; }
.grow .gf { color: var(--muted); font-size: 11px; }
.grow .gnow {
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: .05em;
  text-transform: uppercase;
  color: var(--accent);
  visibility: hidden;
}
/* O destaque não é só a cor: muda o fundo, ganha barra à esquerda e escreve
   "agora". Quem não distingue o verde continua sabendo qual linha está ativa. */
.grow.on { background: var(--accent-soft); border-left-color: var(--accent); }
.grow.on .gf { color: var(--accent-text); }
.grow.on .gnow { visibility: visible; }
/* Parar é o oposto de agir, e a cor precisa dizer isso sozinha. */
.grow.on.cmd-stop, .grow.on.cmd-rest { background: var(--danger-soft); border-left-color: var(--danger); }
.grow.on.cmd-stop .gf, .grow.on.cmd-rest .gf { color: var(--danger-text); }
.grow.on.cmd-stop .gnow, .grow.on.cmd-rest .gnow { color: var(--danger); }
@media (prefers-reduced-motion: reduce) {
  .guide, .highlight, .cursor, .toast { transition: none; }
}
`

export type CursorMode = 'idle' | 'normal' | 'pinching' | 'dragging' | 'clutch' | 'hidden'

export class Overlay {
  private host: HTMLElement
  private shadow: ShadowRoot
  /** Onde vivem as variáveis de cor: trocar o tema é trocar a classe daqui. */
  private rootEl!: HTMLElement
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
  /** Os painéis são por papel; o lado da tela é decidido em `setHanded`. */
  private guideScroll!: GuidePanel
  private guideAction!: GuidePanel
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
        <span class="state">·</span>
        <span class="sep">|</span>
        <span class="muted hint"></span>
      </div>
      <div class="toast"></div>
    `
    this.shadow.appendChild(root)
    this.rootEl = root

    this.tipsLeft = this.buildTips(root, 'left')
    this.tipsRight = this.buildTips(root, 'right')
    this.guideScroll = this.buildGuide(root, COMMANDS_SCROLL)
    this.guideAction = this.buildGuide(root, COMMANDS_ACTION)
    this.setHanded(false)

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

  private buildGuide(root: HTMLElement, commands: CommandEntry[]): GuidePanel {
    const el = document.createElement('div')
    el.className = 'guide'

    const head = document.createElement('div')
    head.className = 'ghead'
    head.innerHTML = `<span class="gdot"></span><span class="gtitle"></span>`
    el.appendChild(head)
    const title = head.querySelector('.gtitle') as HTMLElement

    const rows = new Map<CommandId, HTMLElement>()
    for (const entry of commands) {
      const row = document.createElement('div')
      // A classe do comando permite dar ao "bloquear" a cor do que ele faz:
      // aceso em verde, ele diria o contrário do que significa.
      row.className = `grow cmd-${entry.id}`
      const mask = `-webkit-mask-image:url("${artUrl(entry.art)}");mask-image:url("${artUrl(entry.art)}")`
      row.innerHTML = `
        <span class="gi${entry.flip ? ' flip' : ''}" style="${mask}"></span>
        <span>
          <span class="ga">${t(entry.action)}</span><br />
          <span class="gf">${t(entry.fingers)}</span>
        </span>
        <span class="gnow">${t('guideNow')}</span>
      `
      el.appendChild(row)
      rows.set(entry.id, row)
    }

    root.appendChild(el)
    return { el, title, rows }
  }

  /**
   * Coloca cada painel do lado da mão que o cumpre.
   *
   * O painel precisa ficar do lado da mão de que fala: quem lê "mão esquerda"
   * no canto direito da tela hesita antes de cada gesto. É por isso que o modo
   * canhoto troca os painéis de lado em vez de só trocar o texto.
   */
  setHanded(leftHanded: boolean): void {
    const scrollSide = leftHanded ? 'right' : 'left'
    const actionSide = leftHanded ? 'left' : 'right'

    this.guideScroll.el.classList.toggle('left', scrollSide === 'left')
    this.guideScroll.el.classList.toggle('right', scrollSide === 'right')
    this.guideAction.el.classList.toggle('left', actionSide === 'left')
    this.guideAction.el.classList.toggle('right', actionSide === 'right')

    const name = (side: 'left' | 'right') => t(side === 'left' ? 'handLeft' : 'handRight')
    this.guideScroll.title.textContent = `${name(scrollSide)}: ${t('roleScroll')}`
    this.guideAction.title.textContent = `${name(actionSide)}: ${t('roleAction')}`
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
   * Reflete o estado das duas mãos nos painéis.
   *
   * O loop chama isto a cada frame, mas o conteúdo só muda quando um gesto
   * muda — algumas vezes por segundo. A chave de comparação evita mexer em
   * dezenas de elementos sessenta vezes por segundo para reescrever o mesmo.
   */
  setGuide(state: GuideState): void {
    const key = `${state.scrollPresent}|${state.scrollActive}|${state.actionPresent}|${state.actionActive}`
    if (key === this.lastGuideKey) return
    this.lastGuideKey = key

    const paint = (panel: GuidePanel, present: boolean, active: CommandId | null) => {
      panel.el.classList.toggle('present', present)
      panel.el.classList.toggle('absent', !present)

      for (const row of panel.rows.values()) row.classList.remove('on')
      if (present && active) panel.rows.get(active)?.classList.add('on')
    }

    paint(this.guideScroll, state.scrollPresent, state.scrollActive)
    paint(this.guideAction, state.actionPresent, state.actionActive)
  }

  setGuideVisible(visible: boolean): void {
    const display = visible ? '' : 'none'
    this.guideScroll.el.style.display = display
    this.guideAction.el.style.display = display
  }

  /** Troca o tema das instruções na tela. Ver as variáveis em `.root`. */
  setTheme(theme: ThemeMode): void {
    this.rootEl.classList.toggle('light', theme === 'light')
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
