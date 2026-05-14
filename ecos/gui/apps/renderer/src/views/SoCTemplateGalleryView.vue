<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import SoCTemplateGallery from '@/components/SoCTemplateGallery.vue'
import { loadSocTemplateCatalog } from '@/composables/socTemplateCatalog'
import type { SocTemplateSummary } from '@/composables/socTemplateMapper'

const router = useRouter()
const items = ref<SocTemplateSummary[]>([])
const loading = ref(true)
const error = ref<string | null>(null)

async function loadCatalog(): Promise<void> {
  loading.value = true
  error.value = null

  try {
    items.value = await loadSocTemplateCatalog()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Unable to load SoC template data'
  } finally {
    loading.value = false
  }
}

function handleOpen(templateId: string): void {
  router.push({ name: 'SoCTemplateDetail', params: { templateId } })
}

onMounted(loadCatalog)
</script>

<template>
  <div class="soc-view relative min-h-full w-full overflow-x-hidden overflow-y-auto text-(--text-primary)">
    <div class="soc-view__wash" aria-hidden="true" />
    <div class="soc-view__grid" aria-hidden="true" />
    <div class="soc-view__orb soc-view__orb--tr" aria-hidden="true" />
    <div class="soc-view__orb soc-view__orb--bl" aria-hidden="true" />
    <div class="soc-view__edge" aria-hidden="true" />

    <div class="relative z-10 mx-auto max-w-6xl px-5 py-10 sm:px-7 lg:px-10 lg:py-14">
      <SoCTemplateGallery
        :items="items"
        :loading="loading"
        :error="error"
        @back="router.push('/')"
        @open="handleOpen"
        @retry="loadCatalog"
        @catalog-changed="loadCatalog"
      />
    </div>
  </div>
</template>

<style scoped>
.soc-view {
  background: var(--bg-primary);
}

/* 顶部柔光 + 轻微冷暖分区，避免平铺白底 */
.soc-view__wash {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    radial-gradient(ellipse 120% 80% at 15% -10%, color-mix(in srgb, var(--accent-color) 14%, transparent) 0%, transparent 55%),
    radial-gradient(ellipse 90% 60% at 100% 0%, color-mix(in srgb, var(--text-secondary) 8%, transparent) 0%, transparent 45%),
    linear-gradient(180deg, color-mix(in srgb, var(--bg-secondary) 65%, var(--bg-primary)) 0%, var(--bg-primary) 38%, var(--bg-primary) 100%);
}

/* 蓝图细网格：仅上半屏可见，仿 floorplan 读图 */
.soc-view__grid {
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: 0.55;
  background-image:
    linear-gradient(color-mix(in srgb, var(--border-color) 70%, transparent) 1px, transparent 1px),
    linear-gradient(90deg, color-mix(in srgb, var(--border-color) 70%, transparent) 1px, transparent 1px);
  background-size: 20px 20px;
  mask-image: linear-gradient(180deg, black 0%, black 42%, transparent 78%);
}

.soc-view__orb {
  position: absolute;
  pointer-events: none;
  border-radius: 50%;
  opacity: 0.55;
}

.soc-view__orb--tr {
  width: min(52vw, 380px);
  height: min(52vw, 380px);
  right: -8%;
  top: -6%;
  background: radial-gradient(circle at 30% 30%, color-mix(in srgb, var(--accent-color) 22%, transparent) 0%, transparent 68%);
}

.soc-view__orb--bl {
  width: min(44vw, 320px);
  height: min(44vw, 320px);
  left: -10%;
  bottom: 8%;
  background: radial-gradient(circle at 70% 70%, color-mix(in srgb, var(--text-secondary) 12%, transparent) 0%, transparent 70%);
}

/* 左侧工艺边线：像图纸装订边 */
.soc-view__edge {
  position: absolute;
  left: 0;
  top: 12%;
  bottom: 18%;
  width: 3px;
  pointer-events: none;
  background: linear-gradient(
    180deg,
    transparent 0%,
    color-mix(in srgb, var(--accent-color) 55%, transparent) 22%,
    color-mix(in srgb, var(--accent-color) 35%, transparent) 50%,
    color-mix(in srgb, var(--accent-color) 55%, transparent) 78%,
    transparent 100%
  );
  opacity: 0.65;
}

@media (max-width: 640px) {
  .soc-view__edge {
    opacity: 0.35;
  }
}
</style>
