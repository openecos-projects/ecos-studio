import { AsyncLocalStorage } from 'node:async_hooks'

const windowScopeStorage = new AsyncLocalStorage<number>()

export function runWithWindowScope<T>(windowId: number, fn: () => T): T {
  return windowScopeStorage.run(windowId, fn)
}

export function getWindowScopeId(): number | null {
  const windowId = windowScopeStorage.getStore()
  return typeof windowId === 'number' ? windowId : null
}

export function requireWindowScopeId(): number {
  const windowId = getWindowScopeId()
  if (windowId === null) {
    throw new Error('Window scope is not active')
  }
  return windowId
}
