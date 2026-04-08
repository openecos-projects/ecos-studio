<template>
  <div class="flex flex-col h-full w-full min-h-0 text-(--text-primary) relative overflow-hidden">
    <div class="relative z-10 flex flex-col h-full min-h-0 w-full max-w-4xl mx-auto px-6 pt-8 pb-6">
      <header class="shrink-0 mb-6">
        <button
          type="button"
          class="inline-flex items-center gap-2 text-sm text-(--text-secondary) hover:text-(--accent-color) transition-colors duration-200 cursor-pointer mb-4"
          @click="goHome"
        >
          <i class="ri-arrow-left-line text-lg" aria-hidden="true" />
          <span>Back to home</span>
        </button>
        <div class="flex items-end gap-4 flex-wrap">
          <div>
            <h1 class="text-2xl font-semibold text-(--text-primary) tracking-tight">EDA Tools</h1>
            <p class="text-sm text-(--text-secondary) mt-1 max-w-xl">
              Install and manage EDA toolchains for your flows. Search, filter by category, and track install status.
            </p>
          </div>
        </div>
      </header>

      <div class="flex-1 min-h-0 flex flex-col">
        <PluginToolsPanel layout="page" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'
import PluginToolsPanel from '../components/PluginToolsPanel.vue'

const router = useRouter()

function goHome(): void {
  router.push('/')
}
</script>
