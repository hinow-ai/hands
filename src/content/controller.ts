/**
 * Máquina de estados que traduz gestos em interação com a página.
 *
 * Cada mão tem um PAPEL fixo. Qual mão cumpre qual papel é escolha de quem usa
 * (`leftHanded`), e a mão de cada papel é identificada pela posição em relação
 * ao corpo — ver `HandAssigner` —, não pelo rótulo instável do modelo:
 *
 * - A mão que **rola**: aberta rola para baixo, indicador para cima rola para
 *   cima, indicador para o lado avança um link, punho fechado para.
 * - A mão que **escolhe e clica** — SEM mirar: aberta seleciona o próximo
 *   link, o indicador deitado volta ao anterior, o indicador para cima
 *   sustentado por 2 s clica no selecionado, e o punho fechado para.
 * - As **duas juntas** trocam de página: a mão de ação deitada para o lado diz
 *   a direção (← anterior, → próxima) e a mão de rolagem aberta confirma.
 *
 * Um punho em qualquer mão é o freio: anula os gestos da outra, sem apagar a
 * seleção. É a pose mais fácil de formar, e é a que interrompe tudo.
 *
 * Ninguém precisa levar um cursor até um alvo: apontar-e-acertar é a tarefa
 * motora mais difícil que uma interface pode pedir, e é justamente a que este
 * vocabulário elimina.
 */

import { CommandId } from '../core/gestures'
import { FrameSnapshot, HandSnapshot, TuningConfig } from '../core/wire'
import { PointerMapper } from '../core/pointer'
import { damp } from '../core/filters'
import { Overlay } from './overlay'
import { stepTarget } from './targets'
import { deepElementFromPoint, historyBack, historyForward, synthClick, synthScroll } from './synth'
import { sendToFrame, toFrameCoords } from './frames'

/** Texto na língua do navegador; cai no inglês quando não há tradução. */
const t = (key: string): string => chrome.i18n.getMessage(key) || key

/**
 * Velocidade base da rolagem, em pixels por segundo, antes do ganho do popup.
 * Com o ganho padrão dá cerca de 900 px/s: percorre uma tela em pouco mais de
 * um segundo, que é rápido o bastante para não cansar e lento o bastante para
 * a pessoa conseguir parar onde quer.
 */
const SCROLL_PX_PER_SEC = 340

/**
 * Sustentação exigida antes de a rolagem começar, nas duas direções.
 *
 * Vale para cima porque fechar a mão aberta passa por um "apontar" transitório
 * — o indicador é o último dedo a dobrar. E vale para baixo porque a mão
 * aberta é também a metade que confirma a troca de página: sem esta espera,
 * abrir a mão para formar a combinação rolava a página algumas centenas de
 * pixels antes de o outro dedo chegar à posição.
 */
const SCROLL_CONFIRM_MS = 250

/** Quanto o indicador precisa ficar apontado PARA CIMA para o clique disparar. */
const CLICK_HOLD_MS = 2000

/**
 * Sustentação do indicador deitado antes de andar um link. Levantar o dedo
 * para clicar passa pela diagonal — e por leituras laterais breves — que não
 * podem mexer na seleção sem querer.
 */
const STEP_CONFIRM_MS = 250

/**
 * Lapso tolerado na leitura de uma pose sem zerar a contagem. O rastreador
 * vacila por alguns frames mesmo com a mão firme; o que zera a contagem é
 * outra pose deliberada, nunca um vacilo.
 */
const POSE_LAPSE_MS = 300

/** Intervalo entre passos de seleção com a pose mantida. */
const STEP_REPEAT_MS = 600

/**
 * Sustentação da combinação de troca de página. Mais curta que a do clique
 * porque a combinação já é a proteção: formar DUAS poses ao mesmo tempo não
 * acontece por acidente. O arco no centro da tela mostra a contagem, e soltar
 * qualquer uma das mãos cancela.
 */
const PAGE_HOLD_MS = 1200

export interface ControllerOptions {
  onStatus?: (text: string) => void
}

export class GestureController {
  private overlay = new Overlay()
  /** Hoje serve à conversão das pontas dos dedos; o cursor não segue a mão. */
  private pointer = new PointerMapper()

  private cursorX = 0
  private cursorY = 0
  private lastLoopTime = 0

  private enabled = false
  private lastFrame: FrameSnapshot | null = null
  private rafHandle = 0
  private scrollGain = 2.6
  private leftHanded = false

  /** O link selecionado — sobrevive à mão sair do quadro, de propósito. */
  private selected: Element | null = null
  /** Pose da mão de ação no frame anterior, para agir só na transição. */
  private prevActionGesture: string | null = null
  private lastStepAt = 0

  /** Desde quando cada pose sustentada está de pé. 0 = não está. */
  private scrollDownSince = 0
  private scrollUpSince = 0
  private stepBackSince = 0
  private stepFwdSince = 0
  private clickSince = 0
  private lastClickPoseAt = 0
  private pageSince = 0
  private lastPageSeenAt = 0
  /** Uma página por gesto: depois de trocar, exige soltar antes de recontar. */
  private pageFired = false
  /** Até quando o cursor pisca em verde confirmando um clique. */
  private clickFlashUntil = 0

  constructor(private options: ControllerOptions = {}) {}

  enable(): void {
    if (this.enabled) return
    this.enabled = true
    this.overlay.attach()
    this.overlay.setHudVisible(true)
    this.overlay.setHud(t('hudSearching'), t('hudSearchingHint'))
    this.loop()
  }

  disable(): void {
    if (!this.enabled) return
    this.enabled = false
    cancelAnimationFrame(this.rafHandle)
    this.overlay.detach()
    this.pointer.reset()
    this.selected = null
    this.clickSince = 0
    this.pageSince = 0
    this.prevActionGesture = null
  }

  get isEnabled(): boolean {
    return this.enabled
  }

  /** Recebe um frame do reconhecedor. Chamado na taxa do modelo (~30Hz). */
  onGestureFrame(frame: FrameSnapshot): void {
    if (!this.enabled) return
    this.lastFrame = frame
  }

  /** Aplica ajustes vindos do popup sem recriar o controlador. */
  applyTuning(config: Partial<TuningConfig>): void {
    if (config.scrollGain !== undefined) this.scrollGain = config.scrollGain
    if (config.showHud !== undefined) this.overlay.setHudVisible(config.showHud)
    if (config.showGuide !== undefined) this.overlay.setGuideVisible(config.showGuide)
    if (config.showTips !== undefined) this.overlay.setTipsVisible(config.showTips)
    if (config.theme !== undefined) this.overlay.setTheme(config.theme)
    if (config.leftHanded !== undefined) {
      this.leftHanded = config.leftHanded
      this.overlay.setHanded(config.leftHanded)
    }

    const pointerConfig: Record<string, number> = {}
    if (config.activeWidth !== undefined) pointerConfig.activeWidth = config.activeWidth
    if (config.activeHeight !== undefined) pointerConfig.activeHeight = config.activeHeight
    if (config.minCutoff !== undefined) pointerConfig.minCutoff = config.minCutoff
    if (config.beta !== undefined) pointerConfig.beta = config.beta
    if (Object.keys(pointerConfig).length) this.pointer.updateConfig(pointerConfig)
  }

  /**
   * Conta uma pose sustentada: devolve `true` quando ela já vale há tempo
   * suficiente. `since` é o campo de estado que guarda desde quando ela está
   * de pé — zerado assim que a pose some.
   */
  private held(active: boolean, since: 'scrollDownSince' | 'scrollUpSince' | 'stepBackSince' | 'stepFwdSince', now: number, ms: number): boolean {
    if (!active) {
      this[since] = 0
      return false
    }
    if (this[since] === 0) this[since] = now
    return now - this[since] >= ms
  }

  /** Laço visual, na taxa do monitor. Aqui a página rola e o clique conta. */
  private loop = (): void => {
    if (!this.enabled) return
    this.rafHandle = requestAnimationFrame(this.loop)

    const now = performance.now()
    let dt = this.lastLoopTime ? (now - this.lastLoopTime) / 1000 : 1 / 60
    this.lastLoopTime = now
    if (!(dt > 0) || dt > 0.25) dt = 1 / 60

    const frame = this.lastFrame
    // Os papéis, não as mãos: no modo canhoto a esquerda escolhe e clica.
    const scrollHand: HandSnapshot | null =
      (this.leftHanded ? frame?.right : frame?.left) ?? null
    const actionHand: HandSnapshot | null =
      (this.leftHanded ? frame?.left : frame?.right) ?? null

    const sg = scrollHand?.gesture ?? null
    const sdir = scrollHand?.pointDirection ?? null
    const ag = actionHand?.gesture ?? null
    const adir = actionHand?.pointDirection ?? null

    // Punho em qualquer mão anula os gestos da outra. É o botão de emergência
    // do vocabulário — a pose mais fácil de formar interrompe qualquer coisa
    // em andamento. A seleção fica onde está: punho pausa, não apaga.
    const anyFist = sg === 'fist' || ag === 'fist'

    // ------------------------------------- as duas mãos: troca de página
    // A mão de ação deitada para o lado DIZ a direção; a de rolagem aberta
    // CONFIRMA. Duas poses simultâneas não se formam por acidente — é a
    // proteção da ação mais pesada do vocabulário, a que troca a tela inteira.
    const actionSideways = ag === 'point' && (adir === 'left' || adir === 'right')
    const pageDir = actionSideways && sg === 'open' && !anyFist ? adir : null
    if (pageDir) this.lastPageSeenAt = now
    const pageEngaged = pageDir !== null || this.pageSince !== 0

    // Enquanto uma combinação está em formação, as ações individuais das duas
    // poses ficam suspensas. Sem isto, o caminho até a combinação dispara o
    // que cada pose faz sozinha — a página rolava e a seleção andava um link
    // antes de a troca de página sequer começar a contar.
    const pageForming = actionSideways && sg === 'open'

    // ------------------------------------------------ mão de rolagem
    const wantScrollDown = sg === 'open' && !anyFist && !pageForming
    const wantScrollUp = sg === 'point' && sdir === 'up' && !anyFist
    const scrollingDown = this.held(wantScrollDown, 'scrollDownSince', now, SCROLL_CONFIRM_MS)
    const scrollingUp = this.held(wantScrollUp, 'scrollUpSince', now, SCROLL_CONFIRM_MS)

    if (scrollingDown || scrollingUp) {
      const dy = (scrollingUp ? -1 : 1) * SCROLL_PX_PER_SEC * this.scrollGain * dt
      this.dispatchScroll(window.innerWidth / 2, window.innerHeight / 2, 0, dy)
    }

    // A mão de rolagem também avança a seleção, com o indicador deitado: é a
    // redundância que deixa quem tem uma das mãos limitada navegar assim mesmo.
    const scrollSideways = sg === 'point' && (sdir === 'left' || sdir === 'right') && !anyFist
    if (
      this.held(scrollSideways, 'stepFwdSince', now, STEP_CONFIRM_MS) &&
      now - this.lastStepAt >= STEP_REPEAT_MS
    ) {
      this.step(1, now)
    }

    // ------------------------------------------------ seleção
    // Um elemento removido pelo site ou levado para fora da tela pela rolagem
    // deixa de estar selecionado — realce apontando para o nada mente.
    if (this.selected) {
      const r = this.selected.getBoundingClientRect()
      const gone =
        !this.selected.isConnected ||
        r.width < 1 ||
        r.bottom < 0 ||
        r.top > window.innerHeight ||
        r.right < 0 ||
        r.left > window.innerWidth
      if (gone) this.selected = null
    }

    if (ag !== this.prevActionGesture) {
      // A transição de pose é o gesto: um passo no instante em que a mão
      // abre, sem esperar repetição nenhuma.
      if (ag === 'open' && !anyFist) this.step(1, now)
      this.prevActionGesture = ag
    } else if (ag === 'open' && !anyFist && now - this.lastStepAt >= STEP_REPEAT_MS) {
      // Pose mantida: a seleção segue andando, um link por batida.
      this.step(1, now)
    }

    const backing = this.held(
      actionSideways && !anyFist && !pageForming,
      'stepBackSince',
      now,
      STEP_CONFIRM_MS,
    )
    if (backing && now - this.lastStepAt >= STEP_REPEAT_MS) this.step(-1, now)

    // ------------------------------------------------ clique
    const clickPose = ag === 'point' && adir === 'up' && !anyFist
    if (clickPose) {
      this.lastClickPoseAt = now
      if (this.clickSince === 0) this.clickSince = now
    } else if (ag === 'open' || anyFist || backing) {
      // Outra pose deliberada — ou o voltar confirmado — cancela na hora.
      this.clickSince = 0
    } else if (this.clickSince !== 0 && now - this.lastClickPoseAt > POSE_LAPSE_MS) {
      // Um vacilo curto do rastreador não zera; sumir de vez, sim.
      this.clickSince = 0
    }

    let progress = 0
    if (this.clickSince !== 0 && this.selected) {
      progress = (now - this.clickSince) / CLICK_HOLD_MS
      if (progress >= 1) {
        const r = this.selected.getBoundingClientRect()
        this.dispatchClick(r.left + r.width / 2, r.top + r.height / 2)
        this.clickFlashUntil = now + 220
        // Mantendo o dedo apontado, um novo clique a cada ciclo: se a pessoa
        // continua ali, é porque a página não respondeu ao anterior.
        this.clickSince = now
        progress = 0
      }
    }

    // ------------------------------------------------ página: a contagem
    let pageProgress = 0
    if (pageDir && !this.pageFired) {
      if (this.pageSince === 0) this.pageSince = now
      pageProgress = (now - this.pageSince) / PAGE_HOLD_MS
      if (pageProgress >= 1) {
        // Uma página por gesto: trocar várias em cadeia desorienta — cada
        // troca substitui a tela inteira. Para outra, solte e refaça.
        this.pageFired = true
        this.pageSince = 0
        pageProgress = 0
        this.overlay.showToast(pageDir === 'right' ? t('pageNext') : t('pagePrev'))
        if (pageDir === 'right') historyForward()
        else historyBack()
      }
    } else if (!pageDir && now - this.lastPageSeenAt > POSE_LAPSE_MS) {
      this.pageSince = 0
      this.pageFired = false
    }

    this.overlay.setDwellProgress(Math.max(progress, pageProgress))

    // ------------------------------------------------ feedback
    if (pageEngaged) {
      // Durante a troca de página o palco é a página inteira: o arco conta no
      // centro da tela, em âmbar — a cor do clutch, não a verde do clique.
      this.cursorX = damp(this.cursorX, window.innerWidth / 2, 26, dt)
      this.cursorY = damp(this.cursorY, window.innerHeight / 2, 26, dt)
      this.overlay.moveCursor(this.cursorX, this.cursorY)
      this.overlay.setCursorMode('clutch')
      this.overlay.showHighlight(null)
    } else if (this.selected) {
      const r = this.selected.getBoundingClientRect()
      const cx = r.left + r.width / 2
      const cy = r.top + r.height / 2
      // O cursor vive no link selecionado e anima de um para o outro — é a
      // continuidade visual que faz o "pulo" ser legível.
      this.cursorX = damp(this.cursorX, cx, 26, dt)
      this.cursorY = damp(this.cursorY, cy, 26, dt)
      this.overlay.moveCursor(this.cursorX, this.cursorY)
      this.overlay.setCursorMode(now < this.clickFlashUntil ? 'pinching' : 'normal')
      this.overlay.showHighlight(r)
    } else {
      this.overlay.setCursorMode('hidden')
      this.overlay.showHighlight(null)
    }

    this.paintGuide(scrollHand, actionHand, {
      scrollingDown,
      scrollingUp,
      scrollSideways,
      actionSideways,
      clickPose,
      anyFist,
      pageEngaged,
    })

    this.updateHud({
      hands: frame?.hands.length ?? 0,
      scrollingDown,
      scrollingUp,
      clickPose,
      anyFist,
      pageDir,
    })
  }

  /** Anda a seleção e, na primeira vez, planta o cursor direto no alvo. */
  private step(direction: 1 | -1, now: number): void {
    const next = stepTarget(this.selected, direction)
    if (next && next !== this.selected) {
      if (!this.selected) {
        const r = next.getBoundingClientRect()
        this.cursorX = r.left + r.width / 2
        this.cursorY = r.top + r.height / 2
      }
      this.selected = next
    }
    this.lastStepAt = now
  }

  private dispatchScroll(x: number, y: number, dx: number, dy: number): boolean {
    const target = deepElementFromPoint(x, y)
    if (target instanceof HTMLIFrameElement) {
      const local = toFrameCoords(target, x, y)
      sendToFrame(target, { kind: 'scroll', x: local.x, y: local.y, dx, dy })
      return true
    }
    return synthScroll(x, y, dx, dy)
  }

  private dispatchClick(x: number, y: number): void {
    const target = deepElementFromPoint(x, y)
    if (target instanceof HTMLIFrameElement) {
      const local = toFrameCoords(target, x, y)
      sendToFrame(target, { kind: 'click', x: local.x, y: local.y })
      return
    }
    synthClick(x, y)
  }

  /**
   * Feedback do que a câmera está enxergando: as pontas de cada mão e o guia.
   *
   * Roda também quando não há mão alguma — é exatamente aí que ver o quadro
   * vazio explica por que nada acontece. Quem não sabe se o problema é a mão, a
   * luz ou o enquadramento fica sem o que ajustar.
   */
  private paintGuide(
    scrollHand: HandSnapshot | null,
    actionHand: HandSnapshot | null,
    s: {
      scrollingDown: boolean
      scrollingUp: boolean
      scrollSideways: boolean
      actionSideways: boolean
      clickPose: boolean
      anyFist: boolean
      pageEngaged: boolean
    },
  ): void {
    const w = window.innerWidth
    const h = window.innerHeight
    const frame = this.lastFrame
    const toScreen = (tips: { x: number; y: number }[] | undefined) =>
      tips?.map((t2) => this.pointer.toScreen(t2.x, t2.y, w, h)) ?? null

    // As pontas seguem as mãos de verdade, não os papéis: quem olha a tela
    // quer saber onde estão as SUAS mãos.
    this.overlay.setFingertips(toScreen(frame?.left?.tips), toScreen(frame?.right?.tips))

    let scrollActive: CommandId | null = null
    if (s.scrollingDown) scrollActive = 'scroll_down'
    else if (s.scrollingUp) scrollActive = 'scroll_up'
    else if (s.scrollSideways) scrollActive = 'next_link'
    else if (scrollHand?.gesture === 'fist') scrollActive = 'stop'

    let actionActive: CommandId | null = null
    if (actionHand?.gesture === 'open') actionActive = 'next_link'
    else if (s.actionSideways) actionActive = 'prev_link'
    else if (s.clickPose) actionActive = 'click'
    else if (actionHand?.gesture === 'fist') actionActive = 'rest'

    // Punho trava a outra mão: no painel, só o punho acende — a linha do gesto
    // travado acesa diria que ele está agindo, e não está. Durante a troca de
    // página as linhas normais também mentiriam.
    if (s.anyFist) {
      scrollActive = scrollHand?.gesture === 'fist' ? 'stop' : null
      actionActive = actionHand?.gesture === 'fist' ? 'rest' : null
    }
    if (s.pageEngaged) {
      scrollActive = null
      actionActive = null
    }

    this.overlay.setGuide({
      scrollPresent: scrollHand !== null,
      scrollActive,
      actionPresent: actionHand !== null,
      actionActive,
    })
  }

  private updateHud(s: {
    hands: number
    scrollingDown: boolean
    scrollingUp: boolean
    clickPose: boolean
    anyFist: boolean
    pageDir: 'left' | 'right' | null
  }): void {
    let state: string
    let hint: string

    if (s.hands === 0) {
      state = t('hudSearching')
      hint = t('hudSearchingHint')
    } else if (s.pageDir && this.pageFired) {
      state = t('hudPageChanged')
      hint = t('hudPageChangedHint')
    } else if (s.pageDir) {
      state = s.pageDir === 'right' ? t('pageNext') : t('pagePrev')
      hint = t('hudPageConfirm')
    } else if (s.anyFist) {
      state = t('hudPaused')
      hint = t('hudPausedHint')
    } else if (s.scrollingDown) {
      state = t('hudScrollDown')
      hint = t('hudScrollHint')
    } else if (s.scrollingUp) {
      state = t('hudScrollUp')
      hint = t('hudScrollHint')
    } else if (s.clickPose && this.selected) {
      state = t('hudClicking')
      hint = t('hudClickingHint')
    } else if (s.clickPose) {
      state = t('hudNothingSelected')
      hint = t('hudNothingSelectedHint')
    } else if (this.selected) {
      state = t('hudLinkSelected')
      hint = t('hudLinkSelectedHint')
    } else {
      state = t('hudIdle')
      hint = t('hudIdleHint')
    }

    this.overlay.setHud(state, hint, 'ok')
    this.options.onStatus?.(state)
  }

  destroy(): void {
    this.disable()
  }
}
