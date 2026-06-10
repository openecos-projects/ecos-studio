<template>
  <div class="frontend-workspace">
    <div class="frontend-header">
      <div>
        <p class="frontend-kicker">Frontend Flow</p>
        <h1>{{ currentStep?.name || 'Workspace Home' }}</h1>
      </div>
      <button type="button" class="refresh-btn" @click="refresh" :disabled="loading">
        <i :class="loading ? 'ri-loader-4-line animate-spin' : 'ri-refresh-line'"></i>
        Refresh
      </button>
    </div>

    <div v-if="error" class="state-panel error">
      <i class="ri-error-warning-line"></i>
      <span>{{ error }}</span>
    </div>

    <div v-else class="frontend-grid">
      <section class="panel flow-panel">
        <div class="panel-header">
          <h2>Flow Steps</h2>
          <span>{{ completedCount }}/{{ steps.length }} done</span>
        </div>
        <div class="step-list">
          <RouterLink
            v-for="step in steps"
            :key="step.name"
            class="step-row"
            :class="{ active: step.name === currentStepName }"
            :to="`/workspace/${step.name}`"
          >
            <div class="step-icon" :class="stateClass(step.state)">
              <i :class="stateIcon(step.state)"></i>
            </div>
            <div class="step-body">
              <div class="step-title">
                <span>{{ step.name }}</span>
                <span class="tool">{{ step.tool }}</span>
              </div>
              <div class="step-meta">
                <span>{{ step.state || 'Unstart' }}</span>
                <span v-if="step.runtime">{{ step.runtime }}</span>
              </div>
            </div>
          </RouterLink>
        </div>
      </section>

      <section class="panel detail-panel">
        <div class="panel-header">
          <h2>Step Detail</h2>
          <span>{{ currentStep?.tool || '--' }}</span>
        </div>
        <div v-if="!currentStep" class="state-panel">
          <i class="ri-file-list-3-line"></i>
          <span>No flow step selected.</span>
        </div>
        <div v-else class="detail-content">
          <div class="summary-row">
            <div>
              <span class="label">State</span>
              <strong :class="stateClass(currentStep.state)">{{ currentStep.state || 'Unstart' }}</strong>
            </div>
            <div>
              <span class="label">Runtime</span>
              <strong>{{ currentStep.runtime || '--' }}</strong>
            </div>
            <div>
              <span class="label">Directory</span>
              <strong class="mono" :title="currentStep.directory">{{ currentStep.directory }}</strong>
            </div>
          </div>

          <div class="resource-columns">
            <ResourceList title="Logs" icon="ri-terminal-line" :items="logItems" @select="selectTextFile" />
            <ResourceList title="Artifacts" icon="ri-folder-3-line" :items="artifactItems" @select="selectTextFile" />
          </div>

          <div class="viewer">
            <div class="viewer-header">
              <span>{{ selectedFile?.label || 'Preview' }}</span>
              <span v-if="selectedFile" class="mono" :title="selectedFile.path">{{ selectedFile.path }}</span>
            </div>
            <pre v-if="selectedContent" class="viewer-body">{{ selectedContent }}</pre>
            <div v-else class="viewer-empty">
              <i class="ri-file-text-line"></i>
              <span>Select a log or text artifact to preview it here.</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import type { WorkspaceResourceFile, WorkspaceStepResource } from '@ecos-studio/shared'
import { getWorkspaceResourceIndexApi } from '@/api/workspaceResources'
import { readOptionalProjectTextFileTail } from '@/utils/projectFiles'
import { useWorkspace } from '@/composables/useWorkspace'

interface ResourceItem {
  label: string
  path: string
  exists: boolean
  kind: string
}

const route = useRoute()
const { currentProject, resourceVersions } = useWorkspace()
const steps = ref<WorkspaceStepResource[]>([])
const loading = ref(false)
const error = ref('')
const selectedFile = ref<ResourceItem | null>(null)
const selectedContent = ref('')

const currentStepName = computed(() => {
  const param = String(route.params.step || '')
  return param && param !== 'home' ? param : steps.value[0]?.name || ''
})

const currentStep = computed(() =>
  steps.value.find((step) => step.name.toLowerCase() === currentStepName.value.toLowerCase()) ?? null,
)

const completedCount = computed(() => steps.value.filter((step) => step.state === 'Success').length)

const logItems = computed(() => {
  const step = currentStep.value
  if (!step) return []
  return resourceBucketItems(step.resources.log)
})

const artifactItems = computed(() => {
  const step = currentStep.value
  if (!step) return []
  return [
    ...resourceBucketItems(step.resources.output),
    ...resourceBucketItems(step.resources.report),
    ...resourceBucketItems(step.resources.analysis),
    ...resourceBucketItems(step.resources.subflow),
    ...resourceBucketItems(step.resources.checklist),
  ].filter((item) => item.kind !== 'layout-image')
})

async function refresh() {
  loading.value = true
  error.value = ''
  try {
    const index = await getWorkspaceResourceIndexApi()
    steps.value = index.flow.steps
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
    steps.value = []
  } finally {
    loading.value = false
  }
}

async function selectTextFile(item: ResourceItem) {
  selectedFile.value = item
  selectedContent.value = ''
  if (!item.exists) {
    selectedContent.value = 'File does not exist yet.'
    return
  }
  const content = await readOptionalProjectTextFileTail(item.path, 120_000, {
    projectPath: currentProject.value?.path,
  })
  selectedContent.value = content?.content ?? 'No readable text content.'
}

function resourceBucketItems(bucket: Record<string, WorkspaceResourceFile | Record<string, WorkspaceResourceFile>>): ResourceItem[] {
  return Object.entries(bucket).flatMap(([key, value]) => {
    if (isResourceFile(value)) {
      return [toResourceItem(key, value)]
    }
    return Object.entries(value).map(([nestedKey, nestedValue]) =>
      toResourceItem(`${key}.${nestedKey}`, nestedValue),
    )
  }).filter((item) => item.path)
}

function toResourceItem(label: string, file: WorkspaceResourceFile): ResourceItem {
  return {
    label,
    path: file.path,
    exists: file.exists,
    kind: file.kind,
  }
}

function isResourceFile(value: WorkspaceResourceFile | Record<string, WorkspaceResourceFile>): value is WorkspaceResourceFile {
  return typeof value.path === 'string' && typeof value.exists === 'boolean'
}

function stateClass(state: string): string {
  if (state === 'Success') return 'success'
  if (state === 'Ongoing') return 'running'
  if (state === 'Incomplete' || state === 'Invalid') return 'failed'
  return 'pending'
}

function stateIcon(state: string): string {
  if (state === 'Success') return 'ri-checkbox-circle-fill'
  if (state === 'Ongoing') return 'ri-loader-4-line animate-spin'
  if (state === 'Incomplete' || state === 'Invalid') return 'ri-close-circle-fill'
  return 'ri-time-line'
}

const ResourceList = defineComponent({
  props: {
    title: { type: String, required: true },
    icon: { type: String, required: true },
    items: { type: Array as () => ResourceItem[], required: true },
  },
  emits: ['select'],
  setup(props, { emit }) {
    return () => h('div', { class: 'resource-list' }, [
      h('div', { class: 'resource-title' }, [
        h('i', { class: props.icon }),
        h('span', props.title),
      ]),
      props.items.length
        ? h('div', { class: 'resource-items' }, props.items.map((item) =>
          h('button', {
            class: ['resource-item', item.exists ? '' : 'missing'],
            title: item.path,
            type: 'button',
            onClick: () => emit('select', item),
          }, [
            h('i', { class: item.exists ? 'ri-file-text-line' : 'ri-file-warning-line' }),
            h('span', { class: 'resource-label' }, item.label),
          ]),
        ))
        : h('div', { class: 'resource-empty' }, 'No files yet'),
    ])
  },
})

onMounted(refresh)

watch(
  () => [
    currentProject.value?.path,
    resourceVersions.value.flow,
    resourceVersions.value.step,
    resourceVersions.value.logs,
    resourceVersions.value.all,
  ],
  () => {
    void refresh()
  },
)

watch(currentStepName, () => {
  selectedFile.value = null
  selectedContent.value = ''
})
</script>

<style scoped>
.frontend-workspace {
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  padding: 18px;
  overflow: hidden;
  color: var(--text-primary);
  background: var(--bg-primary);
}

.frontend-header,
.panel-header,
.summary-row,
.resource-columns {
  display: flex;
  min-width: 0;
}

.frontend-header {
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}

.frontend-kicker,
.label,
.panel-header span,
.resource-title,
.resource-empty {
  color: var(--text-secondary);
}

.frontend-kicker {
  margin: 0 0 4px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

h1,
h2 {
  margin: 0;
}

h1 {
  font-size: 22px;
  line-height: 1.2;
}

h2 {
  font-size: 13px;
}

.refresh-btn {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 8px 12px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  cursor: pointer;
}

.refresh-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.frontend-grid {
  display: grid;
  grid-template-columns: minmax(260px, 320px) minmax(0, 1fr);
  gap: 14px;
  min-height: 0;
  flex: 1;
}

.panel,
.state-panel,
.viewer {
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-secondary);
}

.panel {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.panel-header {
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

.step-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px;
}

.step-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px;
  border-radius: 8px;
  color: inherit;
  text-decoration: none;
}

.step-row:hover,
.step-row.active {
  background: rgba(var(--accent-rgb, 59, 130, 246), 0.08);
}

.step-row.active {
  box-shadow: inset 2px 0 0 var(--accent-color);
}

.step-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 999px;
  background: var(--bg-primary);
  flex-shrink: 0;
}

.success {
  color: #10b981;
}

.running {
  color: #60a5fa;
}

.failed {
  color: #ef4444;
}

.pending {
  color: var(--text-secondary);
}

.step-body {
  min-width: 0;
  flex: 1;
}

.step-title,
.step-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}

.step-title span:first-child,
.resource-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool,
.step-meta,
.mono {
  font-family: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
}

.tool {
  color: var(--text-secondary);
  font-size: 10px;
}

.step-meta {
  margin-top: 3px;
  color: var(--text-secondary);
  font-size: 10px;
}

.detail-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
  flex: 1;
  padding: 14px;
}

.summary-row {
  gap: 10px;
  flex-wrap: wrap;
}

.summary-row > div {
  min-width: 140px;
  max-width: 100%;
  padding: 10px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-primary);
}

.summary-row > div:last-child {
  flex: 1;
  min-width: 220px;
}

.label {
  display: block;
  margin-bottom: 4px;
  font-size: 10px;
  text-transform: uppercase;
}

.mono {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
}

.resource-columns {
  gap: 12px;
  min-height: 120px;
}

.resource-list {
  flex: 1;
  min-width: 0;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-primary);
  overflow: hidden;
}

.resource-title {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 9px 10px;
  border-bottom: 1px solid var(--border-color);
  font-size: 11px;
  font-weight: 700;
}

.resource-items {
  max-height: 170px;
  overflow-y: auto;
  padding: 6px;
}

.resource-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-primary);
  text-align: left;
  cursor: pointer;
}

.resource-item:hover {
  background: rgba(var(--accent-rgb, 59, 130, 246), 0.08);
}

.resource-item.missing {
  color: var(--text-secondary);
  opacity: 0.62;
}

.resource-empty {
  padding: 12px;
  font-size: 11px;
}

.viewer {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
  overflow: hidden;
  background: var(--bg-primary);
}

.viewer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 9px 10px;
  border-bottom: 1px solid var(--border-color);
  color: var(--text-secondary);
  font-size: 11px;
  flex-shrink: 0;
}

.viewer-body {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 12px;
  overflow: auto;
  color: var(--text-primary);
  font-size: 11px;
  line-height: 1.5;
  white-space: pre-wrap;
}

.viewer-empty,
.state-panel {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-secondary);
}

.viewer-empty {
  flex: 1;
}

.state-panel {
  padding: 20px;
}

.state-panel.error {
  color: #ef4444;
}

@media (max-width: 1024px) {
  .frontend-grid {
    grid-template-columns: 1fr;
  }

  .flow-panel {
    min-height: 260px;
  }
}
</style>
