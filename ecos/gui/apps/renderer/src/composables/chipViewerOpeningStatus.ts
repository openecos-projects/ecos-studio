import { computed, shallowRef } from 'vue'

export interface ChipViewerOpeningStatus {
  id: number
  detail?: string
  message: string
  phase: 'opening' | 'started'
}

export interface ChipViewerOpeningHandle {
  complete(message?: string): void
  finish(): void
  update(message: string, detail?: string): void
}

const startedStatusDurationMs = 1400
const activeStatuses = shallowRef<ChipViewerOpeningStatus[]>([])
let nextStatusId = 1

export function beginChipViewerOpening(
  message: string,
  detail?: string,
): ChipViewerOpeningHandle {
  const id = nextStatusId++
  let finishTimer: ReturnType<typeof setTimeout> | undefined
  activeStatuses.value = [
    ...activeStatuses.value,
    { id, message, detail, phase: 'opening' },
  ]

  const replace = (status: ChipViewerOpeningStatus): void => {
    activeStatuses.value = activeStatuses.value.map((current) =>
      current.id === id ? status : current,
    )
  }

  const finish = (): void => {
    if (finishTimer !== undefined) clearTimeout(finishTimer)
    finishTimer = undefined
    activeStatuses.value = activeStatuses.value.filter((status) => status.id !== id)
  }

  return {
    update(nextMessage, nextDetail) {
      if (finishTimer !== undefined) clearTimeout(finishTimer)
      finishTimer = undefined
      const current = activeStatuses.value.find((status) => status.id === id)
      if (current) {
        replace({ id, message: nextMessage, detail: nextDetail, phase: 'opening' })
      }
    },
    complete(message = 'Chip Viewer started') {
      const current = activeStatuses.value.find((status) => status.id === id)
      if (!current) return
      replace({ ...current, message, phase: 'started' })
      finishTimer = setTimeout(finish, startedStatusDurationMs)
    },
    finish,
  }
}

export function useChipViewerOpeningStatus() {
  return computed(() => activeStatuses.value[activeStatuses.value.length - 1] ?? null)
}
