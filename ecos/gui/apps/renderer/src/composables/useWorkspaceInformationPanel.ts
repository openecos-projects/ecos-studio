import { ref } from 'vue'

const informationPanelVisible = ref(true)

export function useWorkspaceInformationPanel() {
  function toggleInformationPanel(): void {
    informationPanelVisible.value = !informationPanelVisible.value
  }

  return { informationPanelVisible, toggleInformationPanel }
}
