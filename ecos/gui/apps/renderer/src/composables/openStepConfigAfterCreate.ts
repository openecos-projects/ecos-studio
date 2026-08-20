import { ref, type Ref } from 'vue'

const pendingOpenStepConfigAfterCreate = ref(false)

export function requestOpenStepConfigAfterCreate(): void {
  pendingOpenStepConfigAfterCreate.value = true
}

export function usePendingOpenStepConfigAfterCreate(): Ref<boolean> {
  return pendingOpenStepConfigAfterCreate
}
