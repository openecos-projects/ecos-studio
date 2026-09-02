<template>
  <div class="frontend-analysis-content" aria-label="Frontend project analysis">
    <div
      v-show="selectedAnalysisTab === 'dashboard'"
      id="analysis-dashboard-panel"
      class="analysis-dashboard fe-dashboard"
      role="tabpanel"
      aria-labelledby="analysis-tab-dashboard"
    >
      <section class="fe-health-band" aria-label="Verification health">
        <div class="fe-flow-progress">
          <span class="fe-eyebrow">Frontend flow</span>
          <div class="fe-progress-headline">
            <strong>{{ analysis.progressPercent }}%</strong>
            <span>
              {{ analysis.completedSteps }}/{{ analysis.totalSteps }} steps complete
            </span>
          </div>
          <div class="fe-progress-track" aria-hidden="true">
            <i :style="{ width: `${analysis.progressPercent}%` }"></i>
          </div>
        </div>
        <dl class="fe-health-metrics">
          <div>
            <dt>Workspaces</dt>
            <dd>{{ analysis.completeWorkspaceCount }}/{{ analysis.workspaceCount }}</dd>
            <small>flow complete</small>
          </div>
          <div>
            <dt>Simulation</dt>
            <dd :class="analysis.failedCases > 0 ? 'tone-bad' : 'tone-good'">
              {{ passRateLabel(analysis.passRate) }}
            </dd>
            <small
              >{{ analysis.passedCases }}/{{ analysis.totalCases }} cases passed</small
            >
          </div>
          <div>
            <dt>Quality of Results</dt>
            <dd :class="projectQorTone">
              {{ analysis.qorPassWorkspaceCount }}/{{ analysis.workspaceCount }}
            </dd>
            <small>
              {{ analysis.qorBlockedWorkspaceCount }} blocked ·
              {{ analysis.qorIncompleteWorkspaceCount }} incomplete
            </small>
          </div>
          <div>
            <dt>Failures</dt>
            <dd :class="analysis.failedWorkspaceCount > 0 ? 'tone-bad' : ''">
              {{ analysis.failedWorkspaceCount }}
            </dd>
            <small>workspaces failed</small>
          </div>
          <div>
            <dt>Attention</dt>
            <dd :class="analysis.findings.length > 0 ? 'tone-warn' : 'tone-good'">
              {{ analysis.findings.length }}
            </dd>
            <small>actionable findings</small>
          </div>
        </dl>
      </section>

      <section class="fe-workspace-compare" aria-label="Frontend workspace comparison">
        <header class="fe-section-heading">
          <span>Workspace comparison</span>
          <small>{{ analysis.workspaces.length }} total</small>
        </header>
        <div class="fe-compare-table" role="table" aria-label="Workspace comparison">
          <div class="fe-compare-row is-head" role="row">
            <span role="columnheader">Workspace</span>
            <span role="columnheader">Progress</span>
            <span role="columnheader">QoR</span>
            <span role="columnheader">Errors</span>
            <span role="columnheader">Warnings</span>
            <span role="columnheader">Simulation</span>
            <span role="columnheader">Cycles</span>
            <span role="columnheader">Difftest</span>
          </div>
          <button
            v-for="workspace in analysis.workspaces"
            :key="workspace.workspaceId"
            type="button"
            class="fe-compare-row is-data"
            :class="{ selected: workspace.workspaceId === selectedWorkspaceId }"
            role="row"
            @click="selectWorkspace(workspace.workspaceId)"
          >
            <span role="cell" class="fe-workspace-cell">
              <i :class="statusIcon(workspace.status)" aria-hidden="true"></i>
              <strong>{{ workspace.workspaceId }}</strong>
              <small>{{ workspace.workspaceName }}</small>
            </span>
            <span role="cell" class="fe-progress-cell">
              <strong>{{ workspace.completedSteps }}/{{ workspace.totalSteps }}</strong>
              <i><b :style="{ width: `${workspace.progressPercent}%` }"></b></i>
            </span>
            <span role="cell">
              <span class="fe-qor-status" :class="`is-${workspace.qorStatus}`">
                <i :class="qorStatusIcon(workspace.qorStatus)" aria-hidden="true"></i>
                {{ qorStatusLabel(workspace.qorStatus) }}
              </span>
            </span>
            <span role="cell" :class="workspace.errors > 0 ? 'tone-bad' : 'tone-good'">
              {{ workspace.errors }}
            </span>
            <span
              role="cell"
              :class="workspace.actionableWarnings > 0 ? 'tone-warn' : 'tone-good'"
              :title="`${workspace.warnings} total warnings`"
            >
              {{ workspace.actionableWarnings }} actionable
            </span>
            <span role="cell" :class="workspace.failedCases > 0 ? 'tone-bad' : ''">
              {{ workspace.passedCases }}/{{ workspace.totalCases }}
            </span>
            <span role="cell">{{ numberLabel(workspace.cycles) }}</span>
            <span role="cell">{{ workspace.difftestPassed }}</span>
          </button>
        </div>
      </section>

      <section class="fe-attention" aria-label="Needs attention">
        <header class="fe-section-heading">
          <span>Needs attention</span>
          <small>{{ analysis.findings.length }} findings</small>
        </header>
        <ul v-if="analysis.findings.length > 0" class="fe-attention-list">
          <li v-for="finding in visibleFindings" :key="finding.id">
            <button type="button" @click="openFinding(finding)">
              <i :class="findingIcon(finding.severity)" aria-hidden="true"></i>
              <span class="fe-finding-origin">
                {{ finding.workspaceId }} / {{ stageLabel(finding.stage) }}
              </span>
              <strong>{{ finding.title }}</strong>
              <small>{{ finding.detail }}</small>
              <i class="ri-arrow-right-s-line" aria-hidden="true"></i>
            </button>
          </li>
        </ul>
        <div v-else class="fe-attention-empty">
          <i class="ri-checkbox-circle-line" aria-hidden="true"></i>
          <span>No actionable frontend findings</span>
        </div>
        <button
          v-if="analysis.findings.length > FINDING_PREVIEW_LIMIT"
          type="button"
          class="fe-show-more"
          @click="findingsExpanded = !findingsExpanded"
        >
          {{ findingsExpanded ? 'Show fewer' : `Show all ${analysis.findings.length}` }}
        </button>
      </section>
    </div>

    <div
      v-show="selectedAnalysisTab === 'step'"
      id="analysis-step-panel"
      class="analysis-step-panel fe-step-analysis"
      role="tabpanel"
      aria-labelledby="analysis-tab-step"
    >
      <nav class="fe-stage-tabs" aria-label="Frontend flow steps">
        <button
          v-for="stage in frontendStages"
          :key="stage"
          type="button"
          :class="{ selected: stage === activeStage }"
          @click="emit('select-step', stage)"
        >
          <i :class="stageIcon(stage)" aria-hidden="true"></i>
          <span>{{ stageLabel(stage) }}</span>
          <em :class="stepStatusClass(stepForStage(stage)?.status)"></em>
        </button>
      </nav>

      <section v-if="activeWorkspace" class="fe-step-detail">
        <header class="fe-step-detail-heading">
          <div>
            <span class="fe-eyebrow">{{ stageLabel(activeStage) }}</span>
            <h3>{{ activeWorkspace.workspaceId }}</h3>
          </div>
          <label>
            <span>Workspace</span>
            <select
              :value="activeWorkspace.workspaceId"
              @change="selectWorkspace(($event.target as HTMLSelectElement).value)"
            >
              <option
                v-for="workspace in analysis.workspaces"
                :key="workspace.workspaceId"
                :value="workspace.workspaceId"
              >
                {{ workspace.workspaceId }} · {{ workspace.workspaceName }}
              </option>
            </select>
          </label>
        </header>

        <template v-if="activeStep?.available || activeStep?.qor.available">
          <dl class="fe-step-metrics">
            <div v-for="metric in activeStep.metrics" :key="metric.id">
              <dt>{{ metric.label }}</dt>
              <dd :class="`tone-${metric.tone}`">{{ metric.display }}</dd>
            </div>
            <div>
              <dt>Runtime</dt>
              <dd>{{ activeStep.runtime }}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd :class="stepStatusTextClass(activeStep.status)">
                {{ stepStatusLabel(activeStep.status) }}
              </dd>
            </div>
          </dl>

          <section class="fe-step-qor" aria-label="Quality of Results">
            <header class="fe-section-heading fe-qor-heading">
              <div>
                <span>Quality of Results</span>
                <small>Contract, structural, lint, and verification quality</small>
              </div>
              <span class="fe-qor-status" :class="`is-${activeStep.qor.status}`">
                <i :class="qorStatusIcon(activeStep.qor.status)" aria-hidden="true"></i>
                {{ qorStatusLabel(activeStep.qor.status) }}
              </span>
            </header>

            <div v-if="activeStep.qor.available" class="fe-qor-body">
              <div class="fe-qor-gates">
                <span class="fe-eyebrow">Quality gates</span>
                <div class="fe-qor-gate-list">
                  <div v-for="gate in activeStep.qor.gates" :key="gate.id">
                    <i :class="qorGateIcon(gate.state)" aria-hidden="true"></i>
                    <span>{{ gate.label }}</span>
                    <small>{{ qorGateEvidence(gate) }}</small>
                  </div>
                </div>
              </div>

              <div class="fe-qor-metrics">
                <span class="fe-eyebrow">Measured results</span>
                <dl>
                  <div v-for="metric in activeStep.qor.metrics" :key="metric.id">
                    <dt>{{ metric.label }}</dt>
                    <dd>{{ metric.display }}</dd>
                    <small>{{ metric.category }}</small>
                  </div>
                </dl>
              </div>

              <div v-if="activeStep.qor.hotspots.length > 0" class="fe-qor-hotspots">
                <span class="fe-eyebrow">QoR hotspots</span>
                <ul>
                  <li v-for="hotspot in activeStep.qor.hotspots" :key="hotspot.id">
                    <i :class="qorHotspotIcon(hotspot.severity)" aria-hidden="true"></i>
                    <div>
                      <strong>{{ hotspot.label }}</strong>
                      <p>{{ hotspot.description }}</p>
                      <small v-if="hotspot.source">{{ hotspot.source }}</small>
                    </div>
                  </li>
                </ul>
              </div>
            </div>
            <div v-else class="fe-qor-unavailable">
              QoR artifacts are not available for this step. Run or rerun the step with a
              current ECC-FE runtime.
            </div>
          </section>

          <section class="fe-step-findings" aria-label="Step findings">
            <header class="fe-section-heading">
              <span>Findings</span>
              <small>{{ activeStep.findings.length }} actionable</small>
            </header>
            <ul v-if="activeStep.findings.length > 0">
              <li v-for="finding in activeStep.findings" :key="finding.id">
                <i :class="findingIcon(finding.severity)" aria-hidden="true"></i>
                <div>
                  <strong>{{ finding.title }}</strong>
                  <p>{{ finding.detail }}</p>
                  <small v-if="finding.source">
                    {{ finding.source
                    }}<template v-if="finding.line">:{{ finding.line }}</template>
                  </small>
                </div>
              </li>
            </ul>
            <div v-else class="fe-attention-empty compact">
              <i class="ri-checkbox-circle-line" aria-hidden="true"></i>
              <span>No actionable findings in this step</span>
            </div>
          </section>
        </template>
        <div v-else class="fe-step-unavailable">
          <i class="ri-file-search-line" aria-hidden="true"></i>
          <strong>Analysis data unavailable</strong>
          <span>{{ stepStatusLabel(activeStep?.status ?? 'unstart') }}</span>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  FRONTEND_FLOW_STEPS,
  type ProjectManagementProject,
  type ProjectStage,
} from '@/utils/projectManagement'
import type {
  FrontendAnalysisFinding,
  FrontendAnalysisStage,
  FrontendAnalysisStepStatus,
  FrontendQorGate,
  FrontendQorHotspot,
  FrontendQorStatus,
} from './frontendProjectAnalysis'

type AnalysisTab = 'dashboard' | 'step'

const FINDING_PREVIEW_LIMIT = 8

const props = defineProps<{
  project: ProjectManagementProject
  selectedAnalysisTab: AnalysisTab
  selectedStep: ProjectStage
  selectedWorkspaceId: string
}>()

const emit = defineEmits<{
  'select-analysis-tab': [tab: AnalysisTab]
  'select-step': [step: ProjectStage]
  'select-workspace': [workspaceId: string]
}>()

const findingsExpanded = ref(false)
const analysis = computed(() => props.project.frontendAnalysis!)
const frontendStages = FRONTEND_FLOW_STEPS
const activeStage = computed<FrontendAnalysisStage>(() =>
  frontendStages.includes(props.selectedStep as FrontendAnalysisStage)
    ? (props.selectedStep as FrontendAnalysisStage)
    : 'prepare',
)
const activeWorkspace = computed(
  () =>
    analysis.value.workspaces.find(
      (workspace) => workspace.workspaceId === props.selectedWorkspaceId,
    ) ?? analysis.value.workspaces[0],
)
const activeStep = computed(() => stepForStage(activeStage.value))
const visibleFindings = computed(() =>
  findingsExpanded.value
    ? analysis.value.findings
    : analysis.value.findings.slice(0, FINDING_PREVIEW_LIMIT),
)
const projectQorTone = computed(() =>
  analysis.value.qorBlockedWorkspaceCount > 0
    ? 'tone-bad'
    : analysis.value.qorIncompleteWorkspaceCount > 0
      ? 'tone-warn'
      : 'tone-good',
)
watch(
  () => props.project.id,
  () => {
    findingsExpanded.value = false
  },
)

function stepForStage(stage: FrontendAnalysisStage) {
  return activeWorkspace.value?.steps.find((step) => step.stage === stage)
}

function selectWorkspace(workspaceId: string): void {
  emit('select-workspace', workspaceId)
}

function openFinding(finding: FrontendAnalysisFinding): void {
  emit('select-workspace', finding.workspaceId)
  emit('select-step', finding.stage)
  emit('select-analysis-tab', 'step')
}

function stageLabel(stage: FrontendAnalysisStage): string {
  return (
    {
      prepare: 'Prepare',
      review: 'RTL Review',
      elab: 'Elaboration',
      lint: 'Lint',
      sim: 'Simulation',
    } satisfies Record<FrontendAnalysisStage, string>
  )[stage]
}

function stageIcon(stage: FrontendAnalysisStage): string {
  return (
    {
      prepare: 'ri-inbox-archive-line',
      review: 'ri-node-tree',
      elab: 'ri-git-merge-line',
      lint: 'ri-error-warning-line',
      sim: 'ri-play-circle-line',
    } satisfies Record<FrontendAnalysisStage, string>
  )[stage]
}

function statusIcon(status: string): string {
  if (status === 'success') return 'ri-checkbox-circle-fill tone-good'
  if (status === 'failed') return 'ri-close-circle-fill tone-bad'
  if (status === 'running' || status === 'in_progress')
    return 'ri-loader-4-line tone-warn'
  return 'ri-checkbox-blank-circle-line'
}

function qorStatusLabel(status: FrontendQorStatus): string {
  if (status === 'pass') return 'Pass'
  if (status === 'blocked') return 'Blocked'
  if (status === 'incomplete') return 'Incomplete'
  return 'Unavailable'
}

function qorStatusIcon(status: FrontendQorStatus): string {
  if (status === 'pass') return 'ri-shield-check-fill'
  if (status === 'blocked') return 'ri-shield-cross-fill'
  if (status === 'incomplete') return 'ri-shield-flash-line'
  return 'ri-shield-line'
}

function qorGateIcon(state: FrontendQorGate['state']): string {
  if (state === 'pass') return 'ri-checkbox-circle-fill tone-good'
  if (state === 'failed') return 'ri-close-circle-fill tone-bad'
  return 'ri-question-line tone-warn'
}

function qorGateEvidence(gate: FrontendQorGate): string {
  if (!gate.operator || gate.actual === null || gate.expected === null) return gate.state
  return `${gate.actual} ${gate.operator} ${gate.expected}`
}

function qorHotspotIcon(severity: FrontendQorHotspot['severity']): string {
  if (severity === 'critical') return 'ri-close-circle-fill tone-bad'
  if (severity === 'warning') return 'ri-error-warning-fill tone-warn'
  return 'ri-information-fill'
}

function findingIcon(severity: FrontendAnalysisFinding['severity']): string {
  if (severity === 'error') return 'ri-close-circle-fill tone-bad'
  if (severity === 'warning') return 'ri-error-warning-fill tone-warn'
  return 'ri-information-fill'
}

function stepStatusClass(status?: FrontendAnalysisStepStatus): string {
  return `status-${status ?? 'unstart'}`
}

function stepStatusTextClass(status: FrontendAnalysisStepStatus): string {
  if (status === 'success' || status === 'reused') return 'tone-good'
  if (status === 'failed') return 'tone-bad'
  if (status === 'running') return 'tone-warn'
  return 'tone-neutral'
}

function stepStatusLabel(status: FrontendAnalysisStepStatus): string {
  if (status === 'unstart') return 'Not started'
  if (status === 'reused') return 'Reused'
  return status.charAt(0).toUpperCase() + status.slice(1)
}

function passRateLabel(value: number | null): string {
  return value === null ? 'N/A' : `${Math.round(value * 100)}%`
}

function numberLabel(value: number | null): string {
  return value === null ? 'N/A' : new Intl.NumberFormat('en-US').format(value)
}
</script>

<style scoped src="./frontendProjectAnalysisPanel.css"></style>
