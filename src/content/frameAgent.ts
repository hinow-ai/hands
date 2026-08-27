/**
 * Executor local para frames filhos.
 *
 * Uma página comum carrega dezenas de iframes — anúncios, players, widgets de
 * chat, pixels de rastreamento. Instanciar o controlador inteiro em cada um
 * deles criaria dezenas de Shadow DOMs e de laços de animação que nunca seriam
 * usados. O frame filho não desenha cursor, não recebe gestos e não decide
 * nada: ele só aplica ao próprio documento o comando que o pai já decidiu.
 *
 * Este módulo é essa fatia mínima.
 */

import { FrameCommand } from './frames'
import {
  HoverTracker,
  deepElementFromPoint,
  synthClick,
  synthDragEnd,
  synthDragMove,
  synthDragStart,
  synthScroll,
  synthZoom,
} from './synth'

export class FrameAgent {
  private hover = new HoverTracker()
  private dragTarget: Element | null = null

  execute(cmd: FrameCommand): void {
    switch (cmd.kind) {
      case 'move':
        this.hover.move(deepElementFromPoint(cmd.x, cmd.y), cmd.x, cmd.y)
        break
      case 'click':
        synthClick(cmd.x, cmd.y)
        break
      case 'dragstart':
        this.dragTarget = synthDragStart(cmd.x, cmd.y)
        break
      case 'dragmove':
        synthDragMove(this.dragTarget, cmd.x, cmd.y)
        break
      case 'dragend':
        synthDragEnd(this.dragTarget, cmd.x, cmd.y, cmd.moved)
        this.dragTarget = null
        break
      case 'scroll':
        synthScroll(cmd.x, cmd.y, cmd.dx, cmd.dy)
        break
      case 'zoom':
        synthZoom(cmd.x, cmd.y, cmd.delta)
        break
      case 'leave':
        this.hover.move(null, 0, 0)
        break
    }
  }
}
