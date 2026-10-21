<!-- ecos/gui/src/components/AboutDialog.vue -->
<template>
  <Dialog
    v-model:visible="visible"
    modal
    header="About ECOS Studio"
    :style="{ width: '480px' }"
    :contentStyle="{ padding: '24px' }"
    :closable="true"
    :draggable="false"
    class="about-dialog"
    :pt="{
      mask: { class: 'about-dialog-mask' },
      header: { class: 'about-dialog-header' },
      headerActions: { class: 'about-dialog-close' },
    }"
  >
    <div class="about-content">
      <p class="about-description">
        An integrated, open-source, RTL-to-Chip silicon design solution.
      </p>

      <table class="version-table">
        <tbody>
          <tr v-for="row in versionRows" :key="row.key">
            <td class="label-cell">{{ row.label }}</td>
            <td class="version-cell">{{ row.version }}</td>
          </tr>
        </tbody>
      </table>

      <p v-if="runtimeNotice" class="runtime-notice">{{ runtimeNotice }}</p>
      <p v-else-if="loadingMetadata" class="runtime-notice">
        Checking runtime metadata...
      </p>

      <div class="about-actions">
        <button class="copy-btn" @click="copyVersions">
          <i class="ri-file-copy-line" />
          {{ copied ? 'Copied' : 'Copy version info' }}
        </button>
        <button class="details-link" @click="showDoctor = true">
          Environment details
          <i class="ri-arrow-right-line" />
        </button>
      </div>
    </div>

    <EnvironmentDoctorDialog v-model="showDoctor" />
  </Dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Dialog from 'primevue/dialog'
import type { CliInstallState } from '@ecos-studio/shared'
import { fetchCliInstallerStatus } from '@/api/cliInstaller'
import { useVersion } from '@/composables/useVersion'
import { aboutVersionRows, buildAboutVersionText } from './aboutDialogVersions'
import EnvironmentDoctorDialog from './EnvironmentDoctorDialog.vue'

const visible = defineModel<boolean>({ required: true })
const { versions, refreshVersions } = useVersion()
const installerStatus = ref<CliInstallState | null>(null)
const installerError = ref<string | null>(null)
const loadingMetadata = ref(false)
const showDoctor = ref(false)
let metadataRequestId = 0

const versionRows = computed(() =>
  aboutVersionRows({ versions: versions.value, installer: installerStatus.value }),
)
const runtimeNotice = computed(
  () =>
    installerStatus.value?.warning ??
    installerStatus.value?.error ??
    installerError.value,
)

const copied = ref(false)
async function copyVersions(): Promise<void> {
  const text = buildAboutVersionText({
    versions: versions.value,
    installer: installerStatus.value,
  })
  await navigator.clipboard.writeText(text)
  copied.value = true
  setTimeout(() => {
    copied.value = false
  }, 2000)
}

async function refreshMetadata(): Promise<void> {
  const requestId = ++metadataRequestId
  loadingMetadata.value = true
  installerError.value = null
  installerStatus.value = null
  try {
    const [status] = await Promise.all([fetchCliInstallerStatus(), refreshVersions()])
    if (requestId === metadataRequestId) installerStatus.value = status
  } catch (error) {
    if (requestId === metadataRequestId) {
      installerError.value = error instanceof Error ? error.message : String(error)
    }
  } finally {
    if (requestId === metadataRequestId) loadingMetadata.value = false
  }
}

watch(
  visible,
  (open) => {
    if (open) void refreshMetadata()
  },
  { immediate: true },
)
</script>

<style>
/* PrimeVue Dialog teleports to <body>, so scoped styles can't reach it */
.about-dialog.p-dialog {
  background: var(--bg-primary) !important;
  color: var(--text-primary) !important;
  border: 1px solid var(--border-color) !important;
  border-radius: 12px !important;
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.06),
    0 16px 48px rgba(0, 0, 0, 0.5) !important;
}

.about-dialog .p-dialog-header {
  color: var(--text-primary);
  padding: 20px 24px 8px !important;
}

.about-dialog .p-dialog-content {
  background: transparent;
}

.about-dialog .about-dialog-close {
  position: absolute;
  top: 8px;
  right: 8px;
}

.about-dialog .p-dialog-close-button {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 50%;
  width: 24px;
  height: 24px;
  color: var(--text-secondary);
}

.about-dialog .p-dialog-close-button:hover {
  color: var(--text-primary);
  background: var(--border-color);
}

.about-dialog .p-dialog-close-button:focus,
.about-dialog .p-dialog-close-button:focus-visible {
  outline: none;
  box-shadow: none;
}

.about-dialog-mask.p-dialog-mask,
.about-dialog-mask.p-overlay-mask {
  background: rgba(0, 0, 0, 0.45) !important;
}
</style>

<style scoped>
.about-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.about-description {
  font-size: 13px;
  color: var(--text-secondary);
  margin: 0;
}

.version-table {
  width: 100%;
  border-collapse: collapse;
}

.version-table td {
  padding: 6px 0;
  font-size: 13px;
}

.label-cell {
  color: var(--text-secondary);
  width: 150px;
}

.version-cell {
  color: var(--text-primary);
  font-family: monospace;
}

.runtime-notice {
  margin: 0;
  padding: 8px 10px;
  color: #e8bd68;
  background: rgba(232, 189, 104, 0.08);
  border: 1px solid rgba(232, 189, 104, 0.2);
  border-radius: 6px;
  font-size: 11px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.about-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.copy-btn,
.details-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  font-size: 12px;
  color: var(--text-secondary);
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  cursor: pointer;
  transition:
    background 0.15s,
    color 0.15s;
  align-self: flex-start;
}

.copy-btn:hover {
  background: var(--bg-primary);
  color: var(--text-primary);
}

.details-link {
  padding: 6px 0;
  color: var(--accent-color, #73a9ff);
  background: transparent;
  border: 0;
}

.details-link:hover {
  color: var(--text-primary);
}
</style>
