import { describe, expect, it } from 'vitest'
import chatPanelSource from './AIChatPanel.vue?raw'

describe('AIChatPanel Codex bin settings sync', () => {
  it('observes the settings-registry changed event for the codex bin key', () => {
    expect(chatPanelSource).toContain('bindCodexBinChanged')
    expect(chatPanelSource).toContain('DESKTOP_CODEX_BIN_SETTING_KEY')
    expect(chatPanelSource).toContain('settingsRegistry')
    expect(chatPanelSource).toContain('onChanged')
    // Only the codex bin key triggers a status refresh.
    expect(chatPanelSource).toContain(
      'state.descriptor.key !== DESKTOP_CODEX_BIN_SETTING_KEY',
    )
  })

  it('binds the observer on mount and unsubscribes on unmount', () => {
    const mountedBody = chatPanelSource.slice(
      chatPanelSource.indexOf('onMounted(() => {'),
      chatPanelSource.indexOf('onUnmounted(() => {'),
    )
    expect(mountedBody).toContain('bindCodexBinChanged()')

    const unmountedBody = chatPanelSource.slice(
      chatPanelSource.indexOf('onUnmounted(() => {'),
      chatPanelSource.indexOf('watch(', chatPanelSource.indexOf('onUnmounted(() => {')),
    )
    expect(unmountedBody).toContain('unsubscribeCodexBinChanged?.()')
    expect(unmountedBody).toContain('unsubscribeCodexBinChanged = undefined')
  })
})
