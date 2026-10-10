<template>
  <div v-show="expanded" class="flow-dashboard-placeholder" aria-hidden="true" />
  <Teleport to="body" :disabled="!expanded">
    <section
      class="workspace-flow-dashboard"
      :class="{ 'is-expanded': expanded }"
      aria-label="Flow diagram"
      @keydown.esc="expanded = false"
    >
      <header class="flow-header">
        <h2><i class="ri-node-tree" aria-hidden="true" /> Flow</h2>
        <label
          >Zoom
          <input
            type="range"
            :value="zoom"
            min="0.25"
            max="1.5"
            step="0.05"
            aria-label="Flow diagram zoom"
            :aria-valuetext="`${Math.round(zoom * 100)}%`"
            @input="void setZoom(Number(($event.target as HTMLInputElement).value))"
          />
          <output>{{ Math.round(zoom * 100) }}%</output></label
        >
        <FlowRunControl />
        <button
          type="button"
          class="flow-expand"
          :aria-label="expanded ? 'Restore flow diagram' : 'Expand flow diagram'"
          :title="expanded ? 'Restore flow diagram' : 'Expand flow diagram'"
          :aria-expanded="expanded"
          @click="expanded = !expanded"
        >
          <i
            :class="expanded ? 'ri-fullscreen-exit-line' : 'ri-fullscreen-line'"
            aria-hidden="true"
          />
        </button>
      </header>
      <div class="flow-viewport">
        <div
          v-if="$slots.overview"
          class="flow-overview"
          aria-label="Flow status overview"
        >
          <slot name="overview" />
        </div>
        <p v-if="error" class="flow-empty" role="alert">{{ error }}</p>
        <p v-else-if="!steps.length" class="flow-empty" role="status">
          {{ isLoading ? 'Loading flow…' : 'No flow steps are available.' }}
        </p>
        <div
          v-else
          ref="flowScroll"
          class="flow-scroll"
          :class="{ 'is-panning': isPanning }"
          tabindex="0"
          aria-label="Scrollable flow diagram"
          @wheel="onFlowWheel"
          @pointerdown="startPan"
          @pointermove="movePan"
          @pointerup="endPan"
          @pointercancel="cancelPan"
          @lostpointercapture="lostPanCapture"
          @click.capture="preventDragClick"
          @dragstart.prevent
        >
          <div
            class="flow-size"
            :style="{
              width: `${surfaceSize.width}px`,
              height: `${surfaceSize.height}px`,
            }"
          >
            <div
              class="flow-canvas"
              :style="{
                width: `${graphWidth}px`,
                height: `${graphHeight}px`,
                left: `${canvasOffset.x}px`,
                top: `${canvasOffset.y}px`,
                transform: `scale(${zoom})`,
              }"
            >
              <svg
                class="flow-edges"
                :width="graphWidth"
                :height="graphHeight"
                aria-label="Flow dependencies"
              >
                <defs>
                  <marker
                    :id="arrowId"
                    viewBox="0 0 10 10"
                    refX="9"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" />
                  </marker>
                </defs>
                <path
                  v-for="edge in topology.edges"
                  :key="`${edge.from}:${edge.to}`"
                  :d="edgePath(edge)"
                  :marker-end="`url(#${arrowId})`"
                >
                  <title>{{ edge.from }} → {{ edge.to }}</title>
                </path>
              </svg>
              <FlowStepCard
                v-for="node in positionedSteps"
                :key="node.step.id"
                :step="node.step"
                class="positioned-step"
                :style="{ left: `${node.x}px`, top: `${node.y}px` }"
                @run="openDetails('run', $event)"
                @checklist="openDetails('checklist', $event)"
                @reports="openDetails('reports', $event)"
                @log="openDetails('log', $event)"
                @layout="openLayout"
              />
              <FlowSignoffCard
                v-if="signoffPosition"
                class="positioned-step"
                :style="{ left: `${signoffPosition.x}px`, top: `${signoffPosition.y}px` }"
                :eligible="
                  checksPassed && steps[steps.length - 1]?.status === 'succeeded'
                "
              />
            </div>
          </div>
        </div>
      </div>
      <StepChecklistDialog
        v-if="selectedStep && detailKind === 'checklist'"
        :key="selectedStep.id"
        :step="selectedStep"
        @close="closeDetails"
      />
      <StepReportsDialog
        v-if="selectedStep && detailKind === 'reports'"
        :key="selectedStep.id"
        :step="selectedStep"
        @close="closeDetails"
      />
      <StepLogDialog
        v-if="selectedStep && detailKind === 'log'"
        :key="selectedStep.id"
        :step="selectedStep"
        @close="closeDetails"
      />
      <Dialog
        :visible="Boolean(selectedStep && detailKind === 'run')"
        modal
        :header="`Run ${selectedStep?.label ?? 'step'}`"
        :style="{ width: 'min(440px, calc(100vw - 32px))' }"
        :draggable="false"
        @update:visible="closeDetails"
      >
        <p
          v-if="selectedStep && isFinalizationStep(selectedStep) && !checksPassed"
          role="status"
        >
          Harden and Signoff require all verification steps and their checklists to pass.
        </p>
        <div v-else-if="selectedStep && detailKind === 'run'" class="step-run-action">
          <span
            >Run {{ selectedStep.label }} using the current workspace configuration.</span
          >
          <FlowRunControl
            :key="selectedStep.id"
            :step="selectedStep.path"
            :status="selectedStep.status"
          />
        </div>
      </Dialog>
    </section>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue'
import Dialog from 'primevue/dialog'
import { sameFlowStepName } from '@/api/type'
import FlowRunControl from '@/components/workbench/FlowRunControl.vue'
import { useBackendFlowStages } from '@/composables/useBackendFlowStages'
import {
  useHomeSnapshots,
  type HomeLayoutThumbnail,
} from '@/composables/useHomeSnapshots'
import { useBackendWorkspaceSession } from '@/stores/backendWorkspaceSession'
import {
  buildFlowTopology,
  withSignoffMilestone,
  SIGNOFF_MILESTONE_ID,
  type FlowEdge,
} from './flowTopology'
import { dashboardFlowSteps, type DashboardFlowStep } from './flowDashboardData'
import FlowStepCard from './FlowStepCard.vue'
import StepChecklistDialog from './StepChecklistDialog.vue'
import StepReportsDialog from './StepReportsDialog.vue'
import StepLogDialog from './StepLogDialog.vue'
import FlowSignoffCard from './FlowSignoffCard.vue'
import { useFlowDiagramPan } from './useFlowDiagramPan'
import { useCenteredFlowViewport } from './useCenteredFlowViewport'

const emit = defineEmits<{ layout: [thumbnail: HomeLayoutThumbnail] }>()
const { projectedSteps, isLoading, error } = useBackendFlowStages()
const { layoutThumbnails } = useHomeSnapshots()
const session = useBackendWorkspaceSession()
const arrowId = `flow-arrow-${useId()}`
const zoom = ref(0.75)
const expanded = ref(false)
const flowScroll = ref<HTMLElement | null>(null)
const {
  isPanning,
  startPan,
  movePan,
  endPan,
  cancelPan,
  lostPanCapture,
  preventDragClick,
} = useFlowDiagramPan(flowScroll)
const selectedId = ref<string | null>(null)
const detailKind = ref<'run' | 'checklist' | 'reports' | 'log' | null>(null)
const findings = computed(() => {
  const section = session.projection.data?.checklist
  return section?.status === 'ready' || section?.status === 'partial'
    ? section.data.findings
    : []
})
const steps = computed(() =>
  dashboardFlowSteps(projectedSteps.value, findings.value, layoutThumbnails.value),
)
const topology = computed(() =>
  withSignoffMilestone(buildFlowTopology(steps.value), steps.value),
)
const positions = computed(
  () =>
    new Map(
      topology.value.nodes.map((node) => [
        node.id,
        { x: 12 + node.column * 194, y: 12 + node.row * 202 },
      ]),
    ),
)
const signoffPosition = computed(() => positions.value.get(SIGNOFF_MILESTONE_ID))
const positionedSteps = computed(() =>
  steps.value.map((step) => ({ step, ...positions.value.get(step.id)! })),
)
const graphWidth = computed(() => Math.max(1, topology.value.columns) * 194 - 20)
const graphHeight = computed(() => topology.value.rows * 202)
const { surfaceSize, canvasOffset } = useCenteredFlowViewport(
  flowScroll,
  graphWidth,
  graphHeight,
  zoom,
  computed(() => session.workspaceContextId),
)
const selectedStep = computed(
  () => steps.value.find((step) => step.id === selectedId.value) ?? null,
)
const checksPassed = computed(() =>
  ['lvs', 'drc', 'postRouteLec', 'RCX', 'sta', 'powerAnalysis'].every((id) =>
    steps.value.some(
      (step) =>
        sameFlowStepName(step.id, id) &&
        step.status === 'succeeded' &&
        step.checkState === 'passed',
    ),
  ),
)

function isFinalizationStep(step: DashboardFlowStep): boolean {
  return sameFlowStepName(step.id, 'Harden') || sameFlowStepName(step.id, 'Signoff')
}
function edgePath(edge: FlowEdge): string {
  const from = positions.value.get(edge.from)!
  const to = positions.value.get(edge.to)!
  const startX = from.x + 150
  const startY = from.y + 88
  const endY = to.y + 88
  const midpoint = startX + (to.x - startX) / 2
  return `M ${startX} ${startY} H ${midpoint} V ${endY} H ${to.x - 3}`
}
function openDetails(kind: typeof detailKind.value, step: DashboardFlowStep): void {
  selectedId.value = step.id
  detailKind.value = kind
}
function closeDetails(): void {
  selectedId.value = null
  detailKind.value = null
}
function openLayout(step: DashboardFlowStep): void {
  if (step.thumbnail) emit('layout', step.thumbnail)
}
async function setZoom(value: number, pointer?: { x: number; y: number }): Promise<void> {
  const nextZoom = Math.max(0.25, Math.min(1.5, Math.round(value * 20) / 20))
  if (!Number.isFinite(nextZoom) || nextZoom === zoom.value) return
  cancelPan()
  const viewport = flowScroll.value
  const anchor = pointer ?? {
    x: (viewport?.clientWidth ?? 0) / 2,
    y: (viewport?.clientHeight ?? 0) / 2,
  }
  const originX =
    ((viewport?.scrollLeft ?? 0) + anchor.x - canvasOffset.value.x) / zoom.value
  const originY =
    ((viewport?.scrollTop ?? 0) + anchor.y - canvasOffset.value.y) / zoom.value
  zoom.value = nextZoom
  await nextTick()
  if (viewport && viewport === flowScroll.value) {
    viewport.scrollLeft = Math.max(
      0,
      originX * nextZoom + canvasOffset.value.x - anchor.x,
    )
    viewport.scrollTop = Math.max(0, originY * nextZoom + canvasOffset.value.y - anchor.y)
  }
}
function onFlowWheel(event: WheelEvent): void {
  if (!event.ctrlKey) return
  event.preventDefault()
  const viewport = flowScroll.value
  if (!viewport || !event.deltaY) return
  const bounds = viewport.getBoundingClientRect()
  void setZoom(zoom.value + (event.deltaY < 0 ? 0.05 : -0.05), {
    x: event.clientX - bounds.left,
    y: event.clientY - bounds.top,
  })
}
watch(
  () => session.workspaceContextId,
  () => {
    closeDetails()
    cancelPan()
  },
)
watch(selectedStep, (step) => {
  if (!step) closeDetails()
})
</script>

<style scoped>
.workspace-flow-dashboard {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--border-color);
  border-radius: 7px;
  background: var(--bg-primary);
}

.workspace-flow-dashboard.is-expanded {
  position: fixed;
  inset: 60px 12px 36px 76px;
  z-index: 900;
  box-shadow: 0 12px 40px color-mix(in srgb, var(--text-primary) 25%, transparent);
}

.flow-expand {
  border: 1px solid var(--border-color);
  border-radius: 4px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  width: 25px;
  height: 25px;
}

.flow-expand:focus-visible {
  outline: 2px solid var(--accent-color);
}
.flow-header {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 8px;
  border-bottom: 1px solid var(--border-color);
  padding: 5px 9px;
  min-height: 33px;
}
h2 {
  font-size: 12px;
  margin: 0;
  color: var(--text-primary);
}
h2 i {
  color: var(--accent-color);
}
label {
  display: flex;
  gap: 4px;
  font-size: 10px;
  color: var(--text-secondary);
  align-items: center;
}
input[type='range'] {
  width: 88px;
  accent-color: var(--accent-color);
}
output {
  min-width: 30px;
  font-variant-numeric: tabular-nums;
}
.flow-viewport {
  position: relative;
  flex: 1;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}
.flow-scroll {
  position: absolute;
  inset: 0;
  overflow: auto;
  cursor: grab;
}
.flow-overview {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 1;
  display: flex;
  gap: 8px;
  max-width: calc(100% - 16px);
  pointer-events: none;
}
.flow-overview :deep(> *) {
  pointer-events: auto;
}
.flow-scroll.is-panning,
.flow-scroll.is-panning :deep(*) {
  cursor: grabbing;
  user-select: none;
}
.flow-canvas {
  position: absolute;
  transform-origin: top left;
}

.flow-size {
  position: relative;
  overflow: hidden;
}
.positioned-step {
  position: absolute;
}
.flow-edges {
  position: absolute;
  inset: 0;
  pointer-events: none;
  color: var(--text-secondary);
}
.flow-edges > path {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5px;
}
.flow-edges marker path {
  fill: currentColor;
}
.flow-empty {
  padding: 12px;
  font-size: 12px;
  color: var(--text-secondary);
}
.step-run-action {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  color: var(--text-primary);
  font-size: 13px;
}
.flow-header h2 {
  flex: 1;
}
</style>
