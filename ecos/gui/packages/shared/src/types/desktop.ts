import type { DesktopErrorShape } from '../contracts/errors.ts'

export interface DesktopSuccess<T> {
  ok: true
  data: T
}

export interface DesktopFailure {
  ok: false
  error: DesktopErrorShape
}

export type DesktopResult<T> = DesktopSuccess<T> | DesktopFailure

export type VoidDesktopResult = DesktopResult<void>
