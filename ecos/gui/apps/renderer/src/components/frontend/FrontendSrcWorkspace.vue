<template>
  <div class="frontend-workspace src-workspace-clean">
    <section class="source-layout source-layout-clean">
      <aside class="source-list">
        <div class="source-list-body">
          <button
            v-for="item in sourceItems"
            :key="item.path"
            type="button"
            class="source-row"
            :class="{
              active: activeSource?.path === item.path,
              diagnostic: Boolean(item.diagnostics?.total),
              error: Boolean(item.diagnostics?.errors),
            }"
            :title="item.path"
            @click="$emit('open-source', item)"
          >
            <i :class="fileIcon(item.path)"></i>
            <span>
              <strong>{{ sourceDisplayName(item) }}</strong>
              <small>{{ shortPath(item.path) }}</small>
            </span>
            <em
              v-if="item.diagnostics?.total"
              class="source-diagnostic-badge"
              :class="{ error: Boolean(item.diagnostics?.errors) }"
            >
              {{ sourceDiagnosticLabel(item.diagnostics) }}
            </em>
          </button>
          <div v-if="sourceArtifacts.length === 0" class="empty-panel compact">
            <i class="ri-code-s-slash-line"></i>
            <span>No source files discovered.</span>
          </div>
        </div>
      </aside>
      <FrontendSourceEditor
        :source="activeSource"
        :focus-target="sourceFocusTarget"
        @saved="$emit('refresh')"
        @linted="$emit('refresh')"
      />
    </section>
  </div>
</template>

<script setup lang="ts">
import FrontendSourceEditor from '@/components/FrontendSourceEditor.vue'

interface PathItem {
  label: string
  path: string
}

interface DiagnosticCount {
  errors: number
  warnings: number
  total: number
}

interface SourcePathItem extends PathItem {
  diagnostics?: DiagnosticCount
}

interface FrontendSourceSelection {
  label: string
  path: string
}

defineProps<{
  activeSource: FrontendSourceSelection | null
  sourceArtifacts: PathItem[]
  sourceFocusTarget: {
    path?: string
    line?: number
    column?: number
    token: number
  } | null
  sourceItems: SourcePathItem[]
  fileIcon: (path: string) => string
  shortPath: (path: string) => string
  sourceDiagnosticLabel: (count: DiagnosticCount) => string
  sourceDisplayName: (item: PathItem) => string
}>()

defineEmits<{
  (event: 'open-source', item: PathItem): void
  (event: 'refresh'): void
}>()
</script>

<style scoped>
.frontend-workspace {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  color: var(--text-primary);
  background: var(--bg-primary);
}

.src-workspace-clean {
  gap: 0;
  padding: 0;
}

.source-layout {
  display: grid;
  grid-template-columns: minmax(220px, 300px) minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
}

.source-layout-clean {
  gap: 0;
  width: 100%;
  height: 100%;
}

.source-list {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  border-right: 1px solid var(--border-color);
  background: var(--bg-primary);
}

.source-list-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: auto;
}

.source-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 7px 9px;
  border: 0;
  border-left: 2px solid transparent;
  border-radius: 0;
  background: transparent;
  color: var(--text-primary);
  cursor: pointer;
  text-align: left;
}

.source-row:hover,
.source-row.active {
  background: rgba(var(--accent-rgb, 59, 130, 246), 0.08);
}

.source-row.diagnostic {
  border-left-color: rgba(245, 158, 11, 0.75);
}

.source-row.diagnostic.error {
  border-left-color: rgba(239, 68, 68, 0.85);
}

.source-row span {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.source-row > i {
  flex-shrink: 0;
  color: var(--text-secondary);
}

.source-row.active > i,
.source-row:hover > i {
  color: var(--accent-color);
}

.source-row strong,
.source-row small {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.source-row strong {
  font-size: 11px;
}

.source-row small {
  color: var(--text-secondary);
  font-family: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
  font-size: 10px;
}

.source-diagnostic-badge {
  flex-shrink: 0;
  min-width: 28px;
  padding: 2px 6px;
  border-radius: 999px;
  background: rgba(245, 158, 11, 0.12);
  color: #f59e0b;
  font-size: 10px;
  font-style: normal;
  font-weight: 800;
  text-align: center;
}

.source-diagnostic-badge.error {
  background: rgba(239, 68, 68, 0.12);
  color: #ef4444;
}

.empty-panel {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 120px;
  padding: 20px;
  color: var(--text-secondary);
}

.empty-panel.compact {
  min-height: 80px;
  font-size: 11px;
}

@media (max-width: 1180px) {
  .source-layout {
    grid-template-columns: 1fr;
  }
}
</style>
