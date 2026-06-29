import { ref } from 'vue'
import { useWorkspace } from '@/composables/useWorkspace'

export function useDesignFiles() {
  const { currentProject, showToast } = useWorkspace()
  const showManageDialog = ref(false)

  function ensureWorkspaceOpen(): boolean {
    if (currentProject.value?.path) {
      return true
    }

    showToast({
      severity: 'warn',
      summary: 'No Workspace Open',
      detail: 'Open a workspace before managing RTL design files.',
      life: 3000,
    })
    return false
  }

  function openManageDialog() {
    if (!ensureWorkspaceOpen()) {
      return
    }
    showManageDialog.value = true
  }

  return {
    showManageDialog,
    openManageDialog,
  }
}
