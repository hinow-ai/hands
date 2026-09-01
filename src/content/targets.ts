/**
 * Coleta de alvos clicáveis da página para o pulo direcional.
 *
 * A decisão de "para qual alvo pular" é pura e vive no core (`spatial.ts`);
 * aqui fica só o que depende do DOM: enumerar candidatos visíveis, filtrar o
 * que não serve e confirmar que o escolhido não está coberto por outra coisa.
 *
 * A varredura roda apenas no momento do pulo — um evento discreto, algumas
 * vezes por segundo no máximo — então `querySelectorAll` + um retângulo por
 * candidato custam pouco. É diferente do magnetismo, que roda continuamente e
 * por isso sonda pontos em vez de varrer.
 */

import { HopDirection, pickInDirection, SpatialRect } from '../core/spatial'
import { deepElementFromPoint } from './synth'

/**
 * O que conta como clicável sem cooperação do site. Compartilhado com o
 * magnetismo e com o realce da mira — os três precisam concordar sobre o que
 * é um alvo, senão o cursor gruda numa coisa e o pulo enxerga outra.
 */
export const INTERACTIVE =
  'a[href], button, input, select, textarea, summary, label, ' +
  '[role="button"], [role="link"], [role="tab"], [role="menuitem"], ' +
  '[role="option"], [role="checkbox"], [role="radio"], [contenteditable="true"], [onclick]'

/**
 * Alvos maiores que isto não participam de pulo nem de atração: um `<a>` que
 * envolve um bloco inteiro não é "um alvo", é a página.
 */
export const MAX_TARGET_WIDTH = 400
export const MAX_TARGET_HEIGHT = 260

/** O centro do elemento está mesmo acessível a um clique, sem nada por cima. */
function isHittable(el: Element, r: { left: number; top: number; width: number; height: number }): boolean {
  const hit = deepElementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
  return !!hit && (hit === el || el.contains(hit) || hit.contains(el) || hit.closest?.(INTERACTIVE) === el)
}

/** Alvos clicáveis visíveis no viewport, na ordem do documento — a de leitura. */
function listVisibleTargets(): Element[] {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const out: Element[] = []

  for (const el of Array.from(document.querySelectorAll(INTERACTIVE))) {
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) continue
    if (r.width > MAX_TARGET_WIDTH || r.height > MAX_TARGET_HEIGHT) continue
    if (r.right < 0 || r.left > vw || r.bottom < 0 || r.top > vh) continue
    out.push(el)
  }
  return out
}

/**
 * Anda a seleção sequencial: o link seguinte (+1) ou o anterior (-1) na ordem
 * de leitura, pulando os que estão cobertos por outra coisa. Sem seleção
 * atual, "próximo" começa do primeiro visível e "anterior" do último. Nas
 * pontas a seleção fica onde está — a rolagem (mão esquerda) é o que revela
 * mais links, e dar a volta para o outro lado da tela desorienta.
 */
export function stepTarget(current: Element | null, step: 1 | -1): Element | null {
  const targets = listVisibleTargets()
  if (targets.length === 0) return current

  let index: number
  if (current) {
    const i = targets.indexOf(current)
    index = i >= 0 ? i + step : step === 1 ? 0 : targets.length - 1
  } else {
    index = step === 1 ? 0 : targets.length - 1
  }

  while (index >= 0 && index < targets.length) {
    const el = targets[index]
    if (el !== current && isHittable(el, el.getBoundingClientRect())) return el
    index += step
  }
  return current
}

/**
 * O alvo clicável vizinho na direção pedida, ou `null` se não houver.
 *
 * Depois da escolha geométrica, o centro do candidato é conferido com
 * hit-testing: um link coberto por um banner seria escolhido pela geometria e
 * clicado no vazio. Cobertos são descartados e a escolha tenta o seguinte.
 */
export function findTargetInDirection(current: Element, direction: HopDirection): Element | null {
  const from = current.getBoundingClientRect()
  const vw = window.innerWidth
  const vh = window.innerHeight

  const els: Element[] = []
  const rects: SpatialRect[] = []

  for (const el of Array.from(document.querySelectorAll(INTERACTIVE))) {
    if (el === current || current.contains(el) || el.contains(current)) continue

    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) continue
    if (r.width > MAX_TARGET_WIDTH || r.height > MAX_TARGET_HEIGHT) continue
    if (r.right < 0 || r.left > vw || r.bottom < 0 || r.top > vh) continue

    els.push(el)
    rects.push(r)
  }

  for (let attempt = 0; attempt < 4 && rects.length > 0; attempt++) {
    const i = pickInDirection(from, rects, direction)
    if (i < 0) return null

    const el = els[i]
    const r = rects[i]
    const hit = deepElementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    if (hit && (hit === el || el.contains(hit) || hit.contains(el) || hit.closest?.(INTERACTIVE) === el)) {
      return el
    }

    els.splice(i, 1)
    rects.splice(i, 1)
  }

  return null
}
