<template>
  <section class="workspace-flow-dashboard" aria-label="Flow diagram">
    <header class="flow-header">
      <h2><i class="ri-node-tree" aria-hidden="true" /> Flow</h2>
      <span class="flow-execution-summary" role="status">{{ executionSummary }}</span>
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
        class="flow-fit"
        aria-label="Fit flow diagram"
        title="Fit flow diagram"
        @click="fitDiagram"
      >
        <i class="ri-aspect-ratio-line" aria-hidden="true" />
      </button>
    </header>
    <div class="flow-viewport">
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
              '--flow-step-width': `${FLOW_CARD.width}px`,
              '--flow-step-height': `${FLOW_CARD.height}px`,
            }"
          >
            <svg
              class="flow-edges"
              :width="graphWidth"
              :height="graphHeight"
              aria-hidden="true"
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
              <path
                v-for="(path, index) in parallelTransitions"
                :key="`stage-${index}`"
                :d="path"
                :marker-end="`url(#${arrowId})`"
              />
            </svg>
            <div
              v-for="group in parallelGroups"
              :key="group.stage"
              class="flow-parallel-group"
              :style="{
                left: `${group.x}px`,
                top: `${group.y}px`,
                width: `${FLOW_CARD.width}px`,
                height: `${group.height}px`,
              }"
            >
              <span>Stage {{ group.stage }} · {{ group.count }} steps</span>
            </div>
            <FlowStepCard
              v-for="node in positionedSteps"
              :key="node.step.id"
              :step="node.step"
              :waiting="waitingIds.has(node.step.id)"
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
              :eligible="steps[steps.length - 1]?.status === 'succeeded'"
            />
          </div>
        </div>
      </div>
      <div v-if="$slots.overview" class="flow-overview" aria-label="Flow status overview">
        <slot name="overview" />
      </div>
      <div v-if="$slots.metrics" class="flow-metrics" aria-label="Flow key metrics">
        <slot name="metrics" />
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
      <div v-if="selectedStep && detailKind === 'run'" class="step-run-action">
        <dl v-if="selectedInputs.length" class="step-inputs">
          <div v-for="[input, source] in selectedInputs" :key="input">
            <dt>{{ input.replace(/_/g, ' ') }}</dt>
            <dd>{{ source }}</dd>
          </div>
        </dl>
        <FlowRunControl
          :key="selectedStep.id"
          :step="selectedStep.id"
          :status="selectedStep.status"
          show-step-actions
        />
      </div>
    </Dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue'
import Dialog from 'primevue/dialog'
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
import { isUsableLayoutThumbnail } from './layoutThumbnail'
import FlowStepCard from './FlowStepCard.vue'
import StepChecklistDialog from './StepChecklistDialog.vue'
import StepReportsDialog from './StepReportsDialog.vue'
import StepLogDialog from './StepLogDialog.vue'
import FlowSignoffCard from './FlowSignoffCard.vue'
import { useFlowDiagramPan } from './useFlowDiagramPan'
import { useCenteredFlowViewport } from './useCenteredFlowViewport'
import { FLOW_CARD, flowGraphLayout } from './flowGraphLayout'

const emit = defineEmits<{ layout: [thumbnail: HomeLayoutThumbnail] }>()
const { projectedSteps, activeOperation, isLoading, error } = useBackendFlowStages()
const { layoutThumbnails } = useHomeSnapshots()
const session = useBackendWorkspaceSession()
const arrowId = `flow-arrow-${useId()}`
const zoom = ref(0.75)
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
const layout = computed(() => flowGraphLayout(topology.value))
const positions = computed(() => layout.value.positions)
const parallelGroups = computed(() =>
  topology.value.parallelGroups.map(({ stage, stepIds }) => {
    const first = positions.value.get(stepIds[0]!)!
    const last = positions.value.get(stepIds[stepIds.length - 1]!)!
    return {
      ...first,
      stage,
      count: stepIds.length,
      height: last.y - first.y + FLOW_CARD.height,
    }
  }),
)
const parallelTransitions = computed(() => {
  const firstGroup = parallelGroups.value[0]
  if (!firstGroup) return []
  const center = firstGroup.y + firstGroup.height / 2
  const groupX = new Set(parallelGroups.value.map((group) => group.x))
  const columns = [
    ...new Set(topology.value.nodes.map((node) => positions.value.get(node.id)!.x)),
  ]
  return columns.slice(0, -1).flatMap((x, index) => {
    const next = columns[index + 1]!
    if (!groupX.has(x) && !groupX.has(next)) return []
    const from = x + FLOW_CARD.width + (groupX.has(x) ? 6 : 0)
    const to = next - (groupX.has(next) ? 8 : 3)
    return [`M ${from} ${center} H ${to}`]
  })
})
const runningCount = computed(
  () => steps.value.filter((step) => step.status === 'running').length,
)
const waitingIds = computed(() => {
  const scope = activeOperation.value?.flowScope
  if (!scope) return new Set<string>()
  const start = scope.fromStep
    ? steps.value.findIndex((step) => step.id === scope.fromStep)
    : 0
  if (start < 0) return new Set<string>()
  return new Set(
    steps.value
      .slice(start)
      .filter((step) => step.status === 'queued')
      .map((step) => step.id),
  )
})
const executionSummary = computed(() => {
  const waiting = waitingIds.value.size
  const failed = steps.value.filter((step) => step.status === 'failed').length
  if (runningCount.value || waiting)
    return `${runningCount.value} running${waiting ? ` · ${waiting} waiting` : ''}`
  if (failed) return `${failed} failed`
  return ''
})
const signoffPosition = computed(() => positions.value.get(SIGNOFF_MILESTONE_ID))
const positionedSteps = computed(() =>
  steps.value.map((step) => ({ step, ...positions.value.get(step.id)! })),
)
const graphWidth = computed(() => layout.value.width)
const graphHeight = computed(() => layout.value.height)
const flowContentReady = computed(
  () => Boolean(session.workspaceContextId) && !isLoading.value && steps.value.length > 0,
)
const { surfaceSize, canvasOffset, fitToViewport } = useCenteredFlowViewport(
  flowScroll,
  graphWidth,
  graphHeight,
  zoom,
  computed(() => session.workspaceContextId),
  flowContentReady,
)
const selectedStep = computed(
  () => steps.value.find((step) => step.id === selectedId.value) ?? null,
)
const selectedInputs = computed(() => {
  const step = selectedStep.value
  if (!step) return []
  if (step.inputProducers) {
    const stepLabel = (id: string) =>
      steps.value.find((candidate) => candidate.id === id)?.label ?? id
    const inputs = Object.entries(step.inputProducers).map(([input, source]) => [
      input,
      source ? stepLabel(source) : 'No upstream step',
    ])
    if (step.designSource !== undefined) {
      inputs.unshift([
        'Design input',
        step.designSource ? stepLabel(step.designSource) : 'Workspace origin',
      ])
    }
    return inputs
  }
  return step.inputStep ? [['Input step', step.inputStep]] : []
})
function edgePath(edge: FlowEdge): string {
  const from = positions.value.get(edge.from)!
  const to = positions.value.get(edge.to)!
  const startX = from.x + FLOW_CARD.width
  const startY = from.y + FLOW_CARD.height / 2
  const endY = to.y + FLOW_CARD.height / 2
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
function fitDiagram(): void {
  cancelPan()
  void fitToViewport()
}
function openLayout(step: DashboardFlowStep): void {
  if (isUsableLayoutThumbnail(step.thumbnail)) {
    emit('layout', step.thumbnail)
    return
  }
  if (isUsableLayoutThumbnail(step.macroPlacementSource)) {
    emit('layout', step.macroPlacementSource)
  }
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
  container-type: inline-size;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--border-color);
  border-radius: 7px;
  background: var(--bg-primary);
}

.flow-fit {
  border: 1px solid var(--border-color);
  border-radius: 4px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  width: 25px;
  height: 25px;
}

.flow-fit:focus-visible {
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
  min-height: 240px;
  min-width: 0;
  overflow: hidden;
}
.flow-scroll {
  position: absolute;
  inset: 0;
  overflow: auto;
  scrollbar-gutter: stable both-edges;
  cursor: grab;
}
.flow-overview,
.flow-metrics {
  position: absolute;
  left: 8px;
  z-index: 2;
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-start;
  align-items: stretch;
  gap: 8px;
  flex: 0 0 auto;
  width: fit-content;
  max-width: calc(100% - 16px);
  box-sizing: border-box;
  pointer-events: none;
}
.flow-overview {
  top: 8px;
}
.flow-metrics {
  bottom: 8px;
}
.flow-overview :deep(> *),
.flow-metrics :deep(> *) {
  align-self: stretch;
  width: fit-content;
  max-width: 100%;
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
  cursor: default;
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
  flex-direction: column;
  gap: 16px;
  color: var(--text-primary);
  font-size: 13px;
}
.flow-header h2 {
  flex: 1;
}
.flow-parallel-group {
  position: absolute;
  outline: 1px solid var(--border-color);
  outline-offset: 5px;
  border-radius: 6px;
  pointer-events: none;
}
.flow-parallel-group span {
  position: absolute;
  bottom: calc(100% + 9px);
  color: var(--text-secondary);
  font-size: 13px;
  white-space: nowrap;
}
.flow-execution-summary {
  color: var(--text-secondary);
  font-size: 11px;
  white-space: nowrap;
}
.step-inputs {
  margin: 0;
}
.step-inputs div {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 12px;
  padding-block: 3px;
}
.step-inputs dt {
  color: var(--text-secondary);
}
.step-inputs dd {
  margin: 0;
}
</style>
