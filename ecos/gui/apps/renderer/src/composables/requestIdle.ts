/**
 * 在浏览器空闲时解析，无 `requestIdleCallback` 时回退到 `setTimeout`，避免长时间占用连续主线程切片。
 */
export function requestIdle(): Promise<void> {
  return new Promise((resolve) => {
    const ric = (
      globalThis as typeof globalThis & {
        requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => number
      }
    ).requestIdleCallback
    if (typeof ric === 'function') {
      ric(() => resolve(), { timeout: 2000 })
    } else {
      setTimeout(resolve, 0)
    }
  })
}
