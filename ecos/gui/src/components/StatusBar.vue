<!-- ecos/gui/src/components/StatusBar.vue -->
<template>
  <div class="status-bar">
    <span class="status-text">
      ECOS Studio{{ serverVersion ? ` v${serverVersion}` : '' }}
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useVersion } from '@/composables/useVersion'

const { versions } = useVersion()
const serverVersion = computed(() => versions.value?.server ?? '')
</script>

<style scoped>
.status-bar {
  height: 24px;
  min-height: 24px;
  display: flex;
  align-items: center;
  padding: 0 12px;
  background: var(--bg-secondary);
  border-top: 1px solid var(--border-color);
  user-select: none;
}

.status-text {
  font-size: 11px;
  color: var(--text-secondary);
}
</style>
