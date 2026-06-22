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
  sourceFocusTarget: { path?: string; line?: number; column?: number; token: number } | null
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
