const SCROLLING_CLASS = 'is-scrolling'
const HIDE_DELAY_MS = 900

const hideTimers = new WeakMap<Element, ReturnType<typeof setTimeout>>()

function markScrolling(target: Element): void {
  target.classList.add(SCROLLING_CLASS)
  const previous = hideTimers.get(target)
  if (previous !== undefined) clearTimeout(previous)
  hideTimers.set(
    target,
    setTimeout(() => {
      target.classList.remove(SCROLLING_CLASS)
      hideTimers.delete(target)
    }, HIDE_DELAY_MS),
  )
}

function findScrollableAncestor(start: Element | null): Element | null {
  let element = start
  while (element) {
    const style = window.getComputedStyle(element)
    const canScrollY =
      (style.overflowY === 'auto' ||
        style.overflowY === 'scroll' ||
        style.overflowY === 'overlay') &&
      element.scrollHeight > element.clientHeight
    const canScrollX =
      (style.overflowX === 'auto' ||
        style.overflowX === 'scroll' ||
        style.overflowX === 'overlay') &&
      element.scrollWidth > element.clientWidth
    if (canScrollY || canScrollX) return element
    element = element.parentElement
  }
  return null
}

/** Show overlay scrollbars while the user scrolls; CSS hides them again afterward. */
export function installScrollbarReveal(): void {
  document.addEventListener(
    'scroll',
    (event) => {
      if (event.target instanceof Element) markScrolling(event.target)
    },
    true,
  )

  document.addEventListener(
    'wheel',
    (event) => {
      const scrollable =
        event.target instanceof Element ? findScrollableAncestor(event.target) : null
      if (scrollable) markScrolling(scrollable)
    },
    { capture: true, passive: true },
  )
}
