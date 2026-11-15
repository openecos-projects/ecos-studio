import { ref } from 'vue'

const request = ref<{ root: string; familyId: string } | null>(null)
let resolveRequest: ((configured: boolean) => void) | null = null

export function requestPdkConfiguration(
  root: string,
  familyId: string,
): Promise<boolean> {
  resolveRequest?.(false)
  request.value = { root, familyId }
  return new Promise((resolve) => {
    resolveRequest = resolve
  })
}

export function usePdkConfiguration() {
  function finish(configured: boolean): void {
    request.value = null
    resolveRequest?.(configured)
    resolveRequest = null
  }
  return { request, finish }
}
