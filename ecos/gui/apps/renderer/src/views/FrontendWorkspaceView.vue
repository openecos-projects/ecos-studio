<template>
  <FrontendSrcWorkspace
    v-if="isGlobalSrcView"
    :active-source="activeSource"
    :file-icon="fileIcon"
    :short-path="shortPath"
    :source-artifacts="sourceArtifacts"
    :source-diagnostic-label="sourceDiagnosticLabel"
    :source-display-name="sourceDisplayName"
    :source-focus-target="sourceFocusTarget"
    :source-items="sourceItems"
    @open-source="openSource"
    @refresh="refresh"
  />

  <FrontendWaveWorkspace
    v-if="isGlobalWaveView"
    :active-waveform="activeWaveform"
    :file-name="fileName"
    :short-path="shortPath"
    :surfer-viewer-url="surferViewerUrl"
    :wave-items="waveItems"
    :wave-status-message="waveStatusMessage"
    :waveform-error="waveformError"
    @frame-change="handleSurferFrameChange"
    @frame-load="handleSurferFrameLoad"
    @open-wave-external="openWaveExternal"
    @select-waveform="selectWaveform"
  />

  <div v-show="!isGlobalSrcView && !isGlobalWaveView" class="frontend-workspace">
    <div class="frontend-header">
      <div>
        <p class="frontend-kicker">
          {{ isHomeView ? 'Frontend Workspace' : 'Frontend Flow' }}
        </p>
        <h1>{{ stepTitle }}</h1>
      </div>
      <div v-if="!isHomeView" class="header-actions">
        <button
          v-if="!isSimStep && !isGlobalSrcView"
          type="button"
          class="run-btn"
          :class="{ danger: runBusy }"
          @click="runBusy ? cancelCurrentRun() : runCurrentStep()"
        >
          <i :class="runBusy ? 'ri-stop-circle-line' : 'ri-play-circle-line'"></i>
          {{ runBusy ? `Cancel ${runPhaseDisplayLabel(runPhase)}` : 'Run' }}
        </button>
        <button type="button" class="refresh-btn" :disabled="loading" @click="refresh">
          <i :class="loading ? 'ri-loader-4-line animate-spin' : 'ri-refresh-line'"></i>
        </button>
      </div>
    </div>

    <div v-if="error" class="state-panel error">
      <i class="ri-error-warning-line"></i>
      <span>{{ error }}</span>
    </div>

    <div v-else class="frontend-grid">
      <section class="panel detail-panel detail-panel-full">
        <div class="panel-header">
          <h2>
            {{
              isHomeView
                ? 'Workspace Summary'
                : isGlobalSrcView
                  ? 'Source Workspace'
                  : 'Step Detail'
            }}
          </h2>
          <span>{{
            isHomeView
              ? 'frontend'
              : isGlobalSrcView
                ? 'CPU RTL'
                : currentStep?.tool || '--'
          }}</span>
        </div>

        <div v-if="isHomeView" class="detail-content home-detail-content">
          <Splitter layout="vertical" class="home-splitter frontend-resizable-splitter">
            <SplitterPanel :size="20" :minSize="12" class="home-pane">
              <section class="summary-grid home-summary-grid">
                <div class="summary-tile">
                  <span>Workspace</span>
                  <strong :title="currentProject?.name || ''">{{
                    currentProject?.name || 'Frontend Workspace'
                  }}</strong>
                </div>
                <div class="summary-tile">
                  <span>Flow Steps</span>
                  <strong>{{ steps.length }}</strong>
                </div>
                <div class="summary-tile">
                  <span>Completed</span>
                  <strong>{{ completedCount }}/{{ steps.length }}</strong>
                </div>
                <div
                  class="summary-tile"
                  :class="nextPendingStep ? stateClass(nextPendingStep.state) : ''"
                >
                  <span>Next Step</span>
                  <strong>{{
                    nextPendingStep ? labelForStep(nextPendingStep.name) : 'Complete'
                  }}</strong>
                </div>
              </section>
            </SplitterPanel>

            <SplitterPanel :size="42" :minSize="18" class="home-pane">
              <section class="frontend-config-card home-fill-card">
                <div class="frontend-config-card__head">
                  <div>
                    <strong>Frontend Configuration</strong>
                    <span>Read-only selections from this workspace.</span>
                  </div>
                  <span class="frontend-config-card__badge">Read only</span>
                </div>
                <div class="frontend-config-grid">
                  <div
                    v-for="item in frontendConfigItems"
                    :key="item.label"
                    class="frontend-config-item"
                    :class="{ wide: item.wide }"
                  >
                    <span>{{ item.label }}</span>
                    <strong
                      :title="item.value"
                      :class="{ mono: item.mono, highlight: item.highlight }"
                    >
                      {{ item.value }}
                    </strong>
                  </div>
                </div>
              </section>
            </SplitterPanel>

            <SplitterPanel :size="38" :minSize="20" class="home-pane">
              <section class="home-lower-grid">
                <section class="workspace-home-card home-fill-card">
                  <div class="workspace-home-card__head">
                    <strong>Workspace Home</strong>
                    <span
                      >Choose a step from the left sidebar to inspect logs, reports,
                      source, and waveforms.</span
                    >
                  </div>
                  <div class="workspace-home-card__body">
                    <div class="workspace-home-metric">
                      <span>Current Status</span>
                      <strong>{{ currentOverallState }}</strong>
                    </div>
                    <div class="workspace-home-metric">
                      <span>Latest Tool</span>
                      <strong>{{ latestActiveTool }}</strong>
                    </div>
                    <div class="workspace-home-metric">
                      <span>Simulation</span>
                      <strong>{{ simStepState }}</strong>
                    </div>
                  </div>
                </section>

                <section class="workspace-guide-card home-fill-card">
                  <div
                    v-for="item in workspaceGuideItems"
                    :key="item.title"
                    class="workspace-guide-item"
                  >
                    <i :class="item.icon"></i>
                    <div>
                      <strong>{{ item.title }}</strong>
                      <span>{{ item.text }}</span>
                    </div>
                  </div>
                </section>
              </section>
            </SplitterPanel>
          </Splitter>
        </div>

        <div
          v-else-if="!currentStep && !isGlobalSrcView && !isGlobalWaveView"
          class="state-panel"
        >
          <i class="ri-file-list-3-line"></i>
          <span>No flow step selected.</span>
        </div>

        <div v-else class="detail-content">
          <section v-if="!isGlobalSrcView && !isGlobalWaveView" class="step-compact-meta">
            <div>
              <span>Status</span>
              <strong :class="stateClass(currentStepDisplayState)">{{
                currentStepDisplayState
              }}</strong>
            </div>
            <div>
              <span>Runtime</span>
              <strong class="runtime-value">{{ currentStepRuntime }}</strong>
            </div>
            <div>
              <span>Tool</span>
              <strong>{{ detail?.tool || currentStep?.tool || 'frontend' }}</strong>
            </div>
            <div v-if="isSimStep">
              <span>Cases</span>
              <strong>{{ passedCases }}/{{ totalCases }}</strong>
            </div>
            <button
              v-if="hasStepLogs"
              type="button"
              class="step-meta-action"
              @click="openStepLog"
            >
              <i class="ri-terminal-box-line"></i>
              Log
            </button>
          </section>

          <section v-if="isSimStep" class="sim-run-card">
            <div class="sim-run-head">
              <div class="sim-controls">
                <label class="sim-select-field">
                  <span>Suite</span>
                  <select v-model="simSuite" :disabled="runBusy">
                    <option v-for="suite in simSuites" :key="suite.id" :value="suite.id">
                      {{ suite.label }}
                    </option>
                  </select>
                </label>
                <label v-if="simSuite === 'cpu_tests'" class="sim-select-field compact">
                  <span>Mode</span>
                  <select v-model="simCpuMode" :disabled="runBusy">
                    <option value="selected">Selected</option>
                    <option value="all">All</option>
                  </select>
                </label>
                <div
                  v-if="simSuite === 'cpu_tests' && simCpuMode === 'selected'"
                  class="cpu-case-picker-shell"
                >
                  <span class="cpu-case-picker-label">Cases</span>
                  <button
                    type="button"
                    class="cpu-case-dropdown"
                    :disabled="runBusy"
                    @click="cpuCasePickerOpen = !cpuCasePickerOpen"
                  >
                    <span>{{ cpuCaseSelectionLabel }}</span>
                    <i
                      class="ri-arrow-down-s-line"
                      :class="{ open: cpuCasePickerOpen }"
                    ></i>
                  </button>
                  <div v-if="cpuCasePickerOpen" class="case-picker dropdown">
                    <button
                      v-for="name in availableCpuTests"
                      :key="name"
                      type="button"
                      class="case-chip"
                      :class="{ active: selectedCpuCases.includes(name) }"
                      @click="toggleCpuCase(name)"
                    >
                      {{ name }}
                    </button>
                    <span v-if="!availableCpuTests.length" class="case-picker-empty"
                      >Run Prepare to load CPU tests.</span
                    >
                  </div>
                </div>
              </div>
              <button
                type="button"
                class="run-btn sim-run-action"
                :class="{ running: runBusy }"
                @click="runBusy ? cancelCurrentRun() : runCurrentStep()"
              >
                <i :class="runBusy ? 'ri-stop-circle-line' : 'ri-play-circle-line'"></i>
                <span class="sim-run-action-label">
                  {{
                    runBusy ? `Cancel ${runningSimSuiteLabel}` : `Run ${simSuiteLabel}`
                  }}
                </span>
                <span v-if="runBusy" class="run-timer-badge">{{
                  runElapsedSecondsLabel
                }}</span>
              </button>
            </div>
            <div v-if="simSuite === 'coremark'" class="coremark-compile-panel">
              <div class="coremark-compile-grid">
                <label class="sim-select-field">
                  <span>Preset</span>
                  <select v-model="coremarkCompilePreset" :disabled="runBusy">
                    <option
                      v-for="preset in coremarkCompilePresets"
                      :key="preset.id"
                      :value="preset.id"
                    >
                      {{ preset.label }}
                    </option>
                  </select>
                </label>
                <label class="sim-select-field compact">
                  <span>Opt</span>
                  <select
                    v-model="coremarkOptLevel"
                    :disabled="runBusy || coremarkCompilePreset !== 'custom'"
                  >
                    <option
                      v-for="level in coremarkOptLevels"
                      :key="level"
                      :value="level"
                    >
                      {{ level }}
                    </option>
                  </select>
                </label>
                <label class="sim-select-field">
                  <span>ISA</span>
                  <select v-model="coremarkMarch" :disabled="runBusy">
                    <option
                      v-for="march in coremarkMarchOptions"
                      :key="march"
                      :value="march"
                    >
                      {{ march }}
                    </option>
                  </select>
                </label>
                <label class="sim-select-field compact">
                  <span>ABI</span>
                  <select v-model="coremarkMabi" :disabled="runBusy">
                    <option v-for="mabi in coremarkMabiOptions" :key="mabi" :value="mabi">
                      {{ mabi }}
                    </option>
                  </select>
                </label>
                <label class="sim-select-field compact">
                  <span>Iterations</span>
                  <input
                    v-model.number="coremarkIterations"
                    type="number"
                    min="1"
                    step="1"
                    :disabled="runBusy"
                  />
                </label>
                <label class="sim-select-field compact">
                  <span>Data</span>
                  <input
                    v-model.number="coremarkTotalDataSize"
                    type="number"
                    min="1"
                    step="1"
                    :disabled="runBusy"
                  />
                </label>
              </div>
              <label class="coremark-extra-flags">
                <span>Extra CFLAGS</span>
                <input
                  v-model="coremarkExtraCflags"
                  type="text"
                  :disabled="runBusy"
                  placeholder="-funroll-loops -fno-inline"
                />
              </label>
              <label class="coremark-float-toggle">
                <input v-model="coremarkHasFloat" type="checkbox" :disabled="runBusy" />
                <span>Enable float reporting</span>
              </label>
              <div class="coremark-compile-summary">{{ coremarkCompileSummary }}</div>
            </div>
            <div class="sim-run-context" :class="simResultFreshness.state">
              <div>
                <span>Current Selection</span>
                <strong>{{ simContextLabel(currentSimRunContext) }}</strong>
              </div>
              <div>
                <span>Displayed Result</span>
                <strong>{{
                  resultSimRunContext
                    ? simContextLabel(resultSimRunContext)
                    : 'No result yet'
                }}</strong>
              </div>
              <div>
                <span>Result State</span>
                <strong>{{ simRunSubtitle }}</strong>
              </div>
            </div>
          </section>

          <div v-if="shouldShowStepTabs" class="frontend-step-tabs">
            <button
              v-for="tab in visibleTabs"
              :key="tab.id"
              type="button"
              class="frontend-step-tab"
              :class="{ active: activeTab === tab.id }"
              @click="activeTab = tab.id"
            >
              <i :class="tab.icon"></i>
              <span>{{ tab.label }}</span>
            </button>
          </div>

          <div v-if="stepStaleReason" class="sim-stale-banner step-stale-banner">
            <i class="ri-time-line"></i>
            <span>{{ stepStaleReason }}</span>
          </div>

          <main class="tab-content">
            <section v-if="activeTab === 'summary'" class="summary-panel">
              <template v-if="isPrepareStep && prepareReport">
                <section class="review-overview">
                  <div
                    v-for="tile in prepareSummaryTiles"
                    :key="tile.label"
                    class="review-tile"
                    :class="tile.tone"
                  >
                    <span>{{ tile.label }}</span>
                    <strong>{{ tile.value }}</strong>
                  </div>
                </section>
                <section class="summary-grid prepare-grid">
                  <div class="summary-card prepare-card">
                    <header>
                      <span>Configuration</span>
                      <strong>{{ prepareReadiness.status || 'Pending' }}</strong>
                    </header>
                    <div class="prepare-kv-list">
                      <div
                        v-for="item in prepareConfiguration"
                        :key="item.label"
                        class="prepare-kv"
                        :class="{ mono: item.mono }"
                      >
                        <span>{{ item.label }}</span>
                        <strong>{{ item.value || '--' }}</strong>
                      </div>
                    </div>
                  </div>
                  <div class="summary-card prepare-card">
                    <header>
                      <span>Inputs</span>
                      <strong
                        >{{ numberLabel(prepareInputs.total_rtl_files) }} RTL</strong
                      >
                    </header>
                    <div class="summary-metrics prepare-metrics">
                      <span
                        >CPU RTL
                        <strong>{{
                          numberLabel(prepareInputs.cpu_rtl_files)
                        }}</strong></span
                      >
                      <span
                        >Total RTL
                        <strong>{{
                          numberLabel(prepareInputs.total_rtl_files)
                        }}</strong></span
                      >
                      <span
                        >Includes
                        <strong>{{ numberLabel(prepareInputs.incdirs) }}</strong></span
                      >
                      <span
                        >Defines
                        <strong>{{ numberLabel(prepareInputs.defines) }}</strong></span
                      >
                    </div>
                    <div v-if="prepareOwnershipRows.length" class="ownership-strip">
                      <span v-for="item in prepareOwnershipRows" :key="item.ownership">
                        {{ titleCase(item.ownership) }} <strong>{{ item.count }}</strong>
                      </span>
                    </div>
                    <div class="prepare-source-list">
                      <div
                        v-for="source in prepareInputSources"
                        :key="`${source.label}:${source.path || source.skipped}`"
                        class="prepare-source-row"
                      >
                        <span>
                          <strong>{{ source.label }}</strong>
                          <small>{{
                            source.path ? shortPath(source.path) : source.skipped
                          }}</small>
                        </span>
                        <em>{{ numberLabel(source.rtl_files) }} files</em>
                      </div>
                    </div>
                  </div>
                  <div class="summary-card prepare-card">
                    <header>
                      <span>Contracts</span>
                      <strong>{{ prepareContractSummary }}</strong>
                    </header>
                    <div class="prepare-contract-list">
                      <div
                        v-if="prepareCpuTopContract.module"
                        class="prepare-contract-row"
                        :class="
                          prepareStatusTone(
                            String(prepareCpuTopContract.status || 'pending'),
                          )
                        "
                      >
                        <i
                          :class="
                            prepareStatusIcon(
                              String(prepareCpuTopContract.status || 'pending'),
                            )
                          "
                        ></i>
                        <span>
                          <strong>{{ prepareCpuTopContract.module }}</strong>
                          <small>{{ prepareCpuTopContractDetail }}</small>
                        </span>
                        <em>{{
                          titleCase(String(prepareCpuTopContract.status || 'pending'))
                        }}</em>
                      </div>
                      <div
                        v-for="contract in prepareContracts"
                        :key="contract.label"
                        class="prepare-contract-row"
                        :class="prepareStatusTone(contract.status)"
                      >
                        <i :class="prepareStatusIcon(contract.status)"></i>
                        <span>
                          <strong>{{ contract.label }}</strong>
                          <small>{{ contract.detail }}</small>
                        </span>
                        <em>{{ contract.status }}</em>
                      </div>
                    </div>
                  </div>
                  <div class="summary-card prepare-card">
                    <header>
                      <span>Runtime Plan</span>
                      <strong>{{
                        prepareReadiness.message ? 'Ready Check' : 'Pending'
                      }}</strong>
                    </header>
                    <p>{{ prepareReadiness.message || humanSummaryText }}</p>
                    <div class="prepare-kv-list">
                      <div
                        v-for="item in prepareRuntimePlan"
                        :key="item.label"
                        class="prepare-kv"
                        :class="{ mono: item.mono }"
                      >
                        <span>{{ item.label }}</span>
                        <strong>{{ item.value || '--' }}</strong>
                      </div>
                    </div>
                  </div>
                </section>
              </template>
              <template v-else-if="isReviewStep && reviewReport">
                <section class="review-overview">
                  <div
                    v-for="tile in reviewSummaryTiles"
                    :key="tile.label"
                    class="review-tile"
                    :class="tile.tone"
                  >
                    <span>{{ tile.label }}</span>
                    <strong>{{ tile.value }}</strong>
                  </div>
                </section>
                <section class="summary-grid">
                  <div class="summary-card">
                    <header>
                      <span>Review Delta</span>
                      <strong>{{
                        reviewDelta.baseline === 'previous_run'
                          ? 'Previous Run'
                          : 'No Baseline'
                      }}</strong>
                    </header>
                    <div class="summary-metrics">
                      <span
                        >New <strong>{{ numberLabel(reviewDelta.new) }}</strong></span
                      >
                      <span
                        >Existing
                        <strong>{{ numberLabel(reviewDelta.existing) }}</strong></span
                      >
                      <span
                        >Resolved
                        <strong>{{
                          numberLabel(reviewResolvedIssues.length)
                        }}</strong></span
                      >
                      <span
                        >Waived
                        <strong>{{ numberLabel(reviewWaivers.applied) }}</strong></span
                      >
                    </div>
                    <p v-if="numberValue(reviewWaivers.invalid?.length)">
                      {{ numberLabel(reviewWaivers.invalid?.length) }} invalid waiver
                      record(s)
                    </p>
                  </div>
                  <div class="summary-card">
                    <header>
                      <span>Yosys Precheck</span>
                      <strong>{{ reviewStructuralStatus }}</strong>
                    </header>
                    <p>{{ reviewStructuralReason || reviewStructuralQualityLabel }}</p>
                    <div class="summary-metrics">
                      <span
                        >Cells
                        <strong>{{
                          numberLabel(reviewStructuralMetrics.cells)
                        }}</strong></span
                      >
                      <span
                        >Fanout
                        <strong>{{
                          numberLabel(reviewStructuralMetrics.max_fanout)
                        }}</strong></span
                      >
                      <span
                        >Fanin
                        <strong>{{
                          numberLabel(reviewStructuralMetrics.max_fanin)
                        }}</strong></span
                      >
                      <span
                        >Depth
                        <strong>{{
                          numberLabel(reviewStructuralMetrics.max_comb_depth)
                        }}</strong></span
                      >
                    </div>
                  </div>
                  <div class="summary-card">
                    <header>
                      <span>Next Action</span>
                      <strong>{{ reviewNextAction.title }}</strong>
                    </header>
                    <p>{{ reviewNextAction.detail }}</p>
                    <button
                      type="button"
                      class="text-action"
                      @click="openReviewMode(reviewNextAction.mode)"
                    >
                      <i class="ri-arrow-right-line"></i>
                      Open {{ reviewNextAction.label }}
                    </button>
                  </div>
                </section>
                <section class="summary-card grow">
                  <header>
                    <span>Top Problems</span>
                    <strong>{{ reviewTopIssues.length }}</strong>
                  </header>
                  <div class="summary-issue-list">
                    <button
                      v-for="issue in reviewTopIssues"
                      :key="reviewIssueKey(issue)"
                      type="button"
                      class="review-issue"
                      :class="[issue.severity, { waived: issue.waived }]"
                      @click="openReviewIssue(issue)"
                    >
                      <div class="review-issue-icon">
                        <i :class="problemIcon(issue.severity)"></i>
                      </div>
                      <div class="review-issue-body">
                        <div class="review-issue-title">
                          <strong>{{ issue.title }}</strong>
                          <span>{{ reviewIssueMeta(issue) }}</span>
                        </div>
                        <p>{{ issue.detail }}</p>
                        <small v-if="issue.recommendation">{{
                          issue.recommendation
                        }}</small>
                        <em v-if="reviewIssueSource(issue)">{{
                          reviewIssueLocationLabel(issue)
                        }}</em>
                        <em v-else-if="reviewEvidenceLabel(issue)">{{
                          reviewEvidenceLabel(issue)
                        }}</em>
                      </div>
                    </button>
                    <div v-if="reviewTopIssues.length === 0" class="empty-panel compact">
                      <i class="ri-checkbox-circle-line"></i>
                      <span>No review problems reported.</span>
                    </div>
                  </div>
                </section>
              </template>
              <template v-else-if="isElabStep && elabReport">
                <section class="review-overview">
                  <div
                    v-for="tile in elabSummaryTiles"
                    :key="tile.label"
                    class="review-tile"
                    :class="tile.tone"
                  >
                    <span>{{ tile.label }}</span>
                    <strong>{{ tile.value }}</strong>
                  </div>
                </section>
                <section class="summary-grid elab-summary-grid">
                  <div class="summary-card">
                    <header>
                      <span>Top Readiness</span>
                      <strong>{{ elabReadiness.status || elabStatusLabel }}</strong>
                    </header>
                    <p>{{ elabReadiness.message || humanSummaryText }}</p>
                    <div class="summary-metrics elab-readiness-metrics">
                      <span
                        >Top <strong>{{ elabTopModuleName }}</strong></span
                      >
                      <span
                        >Top Found
                        <strong>{{ elabTopFound ? 'Yes' : 'No' }}</strong></span
                      >
                      <span
                        >Errors
                        <strong>{{
                          numberLabel(elabReadiness.errors || elabSummary.errors)
                        }}</strong></span
                      >
                      <span
                        >Warnings
                        <strong>{{
                          numberLabel(elabReadiness.warnings || elabSummary.warnings)
                        }}</strong></span
                      >
                    </div>
                  </div>
                  <div class="summary-card">
                    <header>
                      <span>Hierarchy Inventory</span>
                      <strong
                        >{{
                          numberLabel(elabReadiness.modules || elabSummary.modules)
                        }}
                        modules</strong
                      >
                    </header>
                    <p>
                      {{ numberLabel(elabTopChildren.length) }} direct child module
                      type(s) are referenced by {{ elabTopModuleName }}.
                    </p>
                    <div class="elab-chip-list">
                      <span
                        v-for="child in elabTopChildren.slice(0, 8)"
                        :key="child"
                        class="elab-chip"
                      >
                        {{ child }}
                      </span>
                      <span v-if="elabTopChildren.length === 0" class="elab-chip muted"
                        >No direct child detected</span
                      >
                    </div>
                  </div>
                  <div class="summary-card">
                    <header>
                      <span>Compiler Result</span>
                      <strong>{{
                        numberLabel(elabDiagnostics.length + elabUnresolvedModules.length)
                      }}</strong>
                    </header>
                    <p v-if="elabDiagnostics.length || elabUnresolvedModules.length">
                      {{ elabAuthorityLabel }} reported diagnostics or unresolved module
                      references.
                    </p>
                    <p v-else>
                      {{ elabAuthorityLabel }} reported no blocking diagnostics.
                    </p>
                    <div class="summary-metrics">
                      <span
                        >Slang
                        <strong>{{ numberLabel(elabDiagnostics.length) }}</strong></span
                      >
                      <span
                        >Compiler Missing
                        <strong>{{
                          numberLabel(elabUnresolvedModules.length)
                        }}</strong></span
                      >
                      <span
                        >Heuristic
                        <strong>{{
                          numberLabel(elabHeuristicCandidates.length)
                        }}</strong></span
                      >
                      <span
                        >Refs
                        <strong>{{
                          numberLabel(
                            elabReadiness.referenced_modules ||
                              elabSummary.referenced_modules,
                          )
                        }}</strong></span
                      >
                    </div>
                  </div>
                  <div class="summary-card">
                    <header>
                      <span>Next Action</span>
                      <strong>{{
                        elabNextAction.title ||
                        (elabDiagnostics.length || elabUnresolvedModules.length
                          ? 'Fix Elab'
                          : 'Continue')
                      }}</strong>
                    </header>
                    <p>
                      {{
                        elabNextAction.detail ||
                        (elabDiagnostics.length
                          ? 'Open diagnostics and jump to source.'
                          : 'Inspect modules or continue to RTL Review.')
                      }}
                    </p>
                    <button type="button" class="text-action" @click="activeTab = 'elab'">
                      <i class="ri-arrow-right-line"></i>
                      Open Elab
                    </button>
                  </div>
                </section>
                <section class="summary-card grow">
                  <header>
                    <span>Largest Modules</span>
                    <strong>{{ elabLargestModules.length }}</strong>
                  </header>
                  <div class="elab-largest-list">
                    <button
                      v-for="moduleItem in elabLargestModules"
                      :key="`${moduleItem.module}:${moduleItem.path}`"
                      type="button"
                      class="elab-module-row compact"
                      :class="{ top: moduleItem.module === elabTopModuleName }"
                      @click="openElabModule(moduleItem)"
                    >
                      <span>
                        <strong>{{ moduleItem.module }}</strong>
                        <small
                          >{{ shortPath(moduleItem.path || '') }}:{{
                            moduleItem.line || 1
                          }}</small
                        >
                      </span>
                      <em>{{
                        moduleItem.module === elabTopModuleName
                          ? 'TOP'
                          : `${numberLabel(moduleItem.instances)} inst`
                      }}</em>
                    </button>
                  </div>
                </section>
              </template>
              <template v-else>
                <section class="review-overview">
                  <div
                    v-for="tile in humanSummaryTiles"
                    :key="tile.label"
                    class="review-tile"
                    :class="tile.tone"
                  >
                    <span>{{ tile.label }}</span>
                    <strong>{{ tile.value }}</strong>
                  </div>
                </section>
                <section class="summary-grid">
                  <div class="summary-card">
                    <header>
                      <span>Result Overview</span>
                      <strong>{{ humanStepTitle }}</strong>
                    </header>
                    <p>{{ humanSummaryText }}</p>
                    <div class="summary-metrics">
                      <span v-for="metric in humanSummaryMetrics" :key="metric.label">
                        {{ metric.label }}
                        <strong>{{ metric.value }}</strong>
                      </span>
                    </div>
                  </div>
                  <div class="summary-card">
                    <header>
                      <span>Next Action</span>
                      <strong>{{ humanNextAction.title }}</strong>
                    </header>
                    <p>{{ humanNextAction.detail }}</p>
                    <button
                      v-if="humanNextAction.tab"
                      type="button"
                      class="text-action"
                      :disabled="
                        !visibleTabs.some((tab) => tab.id === humanNextAction.tab)
                      "
                      @click="activeTab = humanNextAction.tab"
                    >
                      <i class="ri-arrow-right-line"></i>
                      Open {{ humanNextAction.label }}
                    </button>
                  </div>
                </section>
              </template>
            </section>

            <section v-else-if="activeTab === 'review'" class="review-panel">
              <div v-if="!reviewReport" class="empty-panel">
                <i class="ri-search-eye-line"></i>
                <span>No RTL review report yet. Run RTL Review first.</span>
              </div>
              <template v-else>
                <section class="review-overview">
                  <div
                    v-for="tile in reviewSummaryTiles"
                    :key="tile.label"
                    class="review-tile"
                    :class="tile.tone"
                  >
                    <span>{{ tile.label }}</span>
                    <strong>{{ tile.value }}</strong>
                  </div>
                </section>

                <section class="review-main">
                  <aside class="review-sidebar">
                    <div class="review-mode-list">
                      <button
                        v-for="mode in reviewModeItems"
                        :key="mode.id"
                        type="button"
                        class="review-mode-button"
                        :class="{ active: reviewMode === mode.id }"
                        @click="reviewMode = mode.id"
                      >
                        <i :class="mode.icon"></i>
                        <span>
                          <strong>{{ mode.label }}</strong>
                          <em>{{ mode.count }}</em>
                        </span>
                      </button>
                    </div>
                    <div
                      v-if="reviewStructuralProbe"
                      class="review-structural"
                      :class="reviewStructuralTone"
                    >
                      <div>
                        <span>Yosys Precheck</span>
                        <strong>{{ reviewStructuralStatus }}</strong>
                      </div>
                      <p v-if="reviewStructuralReason">{{ reviewStructuralReason }}</p>
                      <p v-else>{{ reviewStructuralQualityLabel }}</p>
                      <div class="review-structural-grid">
                        <span
                          >Cells
                          <strong>{{
                            numberLabel(reviewStructuralMetrics.cells)
                          }}</strong></span
                        >
                        <span
                          >Wires
                          <strong>{{
                            numberLabel(reviewStructuralMetrics.wires)
                          }}</strong></span
                        >
                        <span
                          >Diag
                          <strong>{{
                            numberLabel(reviewStructuralDiagnostics)
                          }}</strong></span
                        >
                        <span
                          >Fanout
                          <strong>{{
                            numberLabel(reviewStructuralMetrics.max_fanout)
                          }}</strong></span
                        >
                        <span
                          >Fanin
                          <strong>{{
                            numberLabel(reviewStructuralMetrics.max_fanin)
                          }}</strong></span
                        >
                        <span
                          >Depth
                          <strong>{{
                            numberLabel(reviewStructuralMetrics.max_comb_depth)
                          }}</strong></span
                        >
                      </div>
                    </div>
                    <div v-if="reviewMode === 'source'" class="review-metrics">
                      <div v-for="metric in reviewMetricRows" :key="metric.label">
                        <span>{{ metric.label }}</span>
                        <strong>{{ metric.value }}</strong>
                      </div>
                    </div>
                    <div v-else class="review-metrics">
                      <div
                        v-for="metric in reviewStructuralMetricRows"
                        :key="metric.label"
                      >
                        <span>{{ metric.label }}</span>
                        <strong>{{ metric.value }}</strong>
                      </div>
                    </div>
                  </aside>

                  <div class="review-stage">
                    <section v-if="reviewMode === 'source'" class="review-layer">
                      <header class="review-layer-head">
                        <div>
                          <span>Source Scan</span>
                          <strong>RTL source rules</strong>
                        </div>
                        <em>{{ sourceScanIssues.length }}</em>
                      </header>
                      <div class="review-issues">
                        <button
                          v-for="issue in sourceScanIssues"
                          :key="reviewIssueKey(issue)"
                          type="button"
                          class="review-issue"
                          :class="[issue.severity, { waived: issue.waived }]"
                          @click="openReviewIssue(issue)"
                        >
                          <div class="review-issue-icon">
                            <i :class="problemIcon(issue.severity)"></i>
                          </div>
                          <div class="review-issue-body">
                            <div class="review-issue-title">
                              <strong>{{ issue.title }}</strong>
                              <span>{{ reviewIssueMeta(issue) }}</span>
                            </div>
                            <p>{{ issue.detail }}</p>
                            <small v-if="issue.recommendation">{{
                              issue.recommendation
                            }}</small>
                            <em v-if="reviewIssueSource(issue)">{{
                              reviewIssueLocationLabel(issue)
                            }}</em>
                          </div>
                        </button>
                        <div v-if="sourceScanIssues.length === 0" class="empty-panel">
                          <i class="ri-checkbox-circle-line"></i>
                          <span>No source scan issues.</span>
                        </div>
                      </div>
                    </section>

                    <section v-else-if="reviewMode === 'yosys'" class="review-layer">
                      <header class="review-layer-head">
                        <div>
                          <span>Yosys Precheck</span>
                          <strong>Diagnostics and structural timing candidates</strong>
                        </div>
                        <em>{{
                          reviewYosysDiagnostics.length +
                          reviewYosysIssues.length +
                          reviewStructuralHotspots.length
                        }}</em>
                      </header>
                      <div class="review-yosys-grid">
                        <div class="review-yosys-column">
                          <div class="review-column-head">
                            <span>Diagnostics</span>
                            <strong>{{
                              reviewYosysDiagnostics.length + reviewYosysIssues.length
                            }}</strong>
                          </div>
                          <div class="review-yosys-list">
                            <button
                              v-for="issue in reviewYosysIssues"
                              :key="reviewIssueKey(issue)"
                              type="button"
                              class="review-issue"
                              :class="[issue.severity, { waived: issue.waived }]"
                              @click="openReviewIssue(issue)"
                            >
                              <div class="review-issue-icon">
                                <i :class="problemIcon(issue.severity)"></i>
                              </div>
                              <div class="review-issue-body">
                                <div class="review-issue-title">
                                  <strong>{{ issue.title }}</strong>
                                  <span>{{ reviewIssueMeta(issue) }}</span>
                                </div>
                                <p>{{ issue.detail }}</p>
                                <small v-if="issue.recommendation">{{
                                  issue.recommendation
                                }}</small>
                                <em v-if="reviewIssueSource(issue)">{{
                                  reviewIssueLocationLabel(issue)
                                }}</em>
                                <em v-if="reviewEvidenceLabel(issue)">{{
                                  reviewEvidenceLabel(issue)
                                }}</em>
                              </div>
                            </button>
                            <button
                              v-for="diagnostic in reviewYosysDiagnostics"
                              :key="yosysDiagnosticKey(diagnostic)"
                              type="button"
                              class="review-issue yosys"
                              :class="diagnostic.severity || 'info'"
                              @click="openYosysDiagnostic(diagnostic)"
                            >
                              <div class="review-issue-icon">
                                <i
                                  :class="problemIcon(diagnostic.severity || 'info')"
                                ></i>
                              </div>
                              <div class="review-issue-body">
                                <div class="review-issue-title">
                                  <strong>{{
                                    titleCase(String(diagnostic.category || 'diagnostic'))
                                  }}</strong>
                                  <span>Yosys</span>
                                </div>
                                <p>{{ diagnostic.message || 'Yosys diagnostic' }}</p>
                                <em v-if="yosysDiagnosticSource(diagnostic)">{{
                                  yosysDiagnosticLocationLabel(diagnostic)
                                }}</em>
                              </div>
                            </button>
                            <div
                              v-if="
                                reviewYosysDiagnostics.length === 0 &&
                                reviewYosysIssues.length === 0
                              "
                              class="empty-panel compact"
                            >
                              <i class="ri-checkbox-circle-line"></i>
                              <span>No Yosys diagnostics.</span>
                            </div>
                          </div>
                        </div>

                        <div class="review-yosys-column">
                          <div class="review-column-head">
                            <span>Hotspots</span>
                            <strong>{{ reviewStructuralHotspots.length }}</strong>
                          </div>
                          <div
                            v-for="hotspot in reviewStructuralHotspots"
                            :key="hotspotKey(hotspot)"
                            role="button"
                            tabindex="0"
                            class="review-hotspot-card"
                            :class="hotspot.tone"
                            @click="openReviewHotspot(hotspot)"
                            @keydown.enter.prevent="openReviewHotspot(hotspot)"
                          >
                            <div class="review-hotspot-title">
                              <strong>{{ hotspot.title }}</strong>
                              <em>{{ hotspot.value }}</em>
                            </div>
                            <p>{{ hotspot.detail }}</p>
                          </div>
                          <div
                            v-if="reviewStructuralHotspots.length === 0"
                            class="empty-panel compact"
                          >
                            <i class="ri-checkbox-circle-line"></i>
                            <span
                              >No fanout, fanin, or depth hotspot above threshold.</span
                            >
                          </div>
                        </div>
                      </div>
                    </section>

                    <section v-else class="review-layer">
                      <header class="review-layer-head">
                        <div>
                          <span>Modules</span>
                          <strong>Yosys module risk ranking</strong>
                        </div>
                        <em>{{ reviewRiskyModules.length }}</em>
                      </header>
                      <div class="review-module-grid">
                        <button
                          v-for="module in reviewRiskyModules"
                          :key="String(module.module)"
                          type="button"
                          class="review-module-card"
                          :class="String(module.risk || 'low')"
                        >
                          <div class="review-module-title">
                            <strong>{{ module.module }}</strong>
                            <em>{{ titleCase(String(module.risk || 'low')) }}</em>
                          </div>
                          <p>{{ moduleRiskReason(module) }}</p>
                          <div class="review-module-metrics">
                            <span
                              >Cells
                              <strong>{{ numberLabel(module.cells) }}</strong></span
                            >
                            <span
                              >Mux
                              <strong>{{ numberLabel(module.mux_cells) }}</strong></span
                            >
                            <span
                              >Arith
                              <strong>{{
                                numberLabel(module.arithmetic_cells)
                              }}</strong></span
                            >
                            <span
                              >Mem
                              <strong>{{
                                numberLabel(module.memory_cells)
                              }}</strong></span
                            >
                            <span
                              >Fanout
                              <strong>{{ numberLabel(module.max_fanout) }}</strong></span
                            >
                            <span
                              >Fanin
                              <strong>{{ numberLabel(module.max_fanin) }}</strong></span
                            >
                            <span
                              >Depth
                              <strong>{{
                                numberLabel(module.max_comb_depth)
                              }}</strong></span
                            >
                            <span
                              >Score
                              <strong>{{ numberLabel(module.score) }}</strong></span
                            >
                          </div>
                        </button>
                        <div
                          v-if="reviewRiskyModules.length === 0"
                          class="empty-panel compact"
                        >
                          <i class="ri-checkbox-circle-line"></i>
                          <span>No risky modules reported.</span>
                        </div>
                      </div>
                    </section>
                  </div>
                </section>
              </template>
            </section>

            <section v-else-if="activeTab === 'elab'" class="elab-panel">
              <div v-if="!elabReport" class="empty-panel">
                <i class="ri-node-tree"></i>
                <span>No ELAB summary yet. Run ELAB first.</span>
              </div>
              <template v-else>
                <section class="review-overview">
                  <div
                    v-for="tile in elabSummaryTiles"
                    :key="tile.label"
                    class="review-tile"
                    :class="tile.tone"
                  >
                    <span>{{ tile.label }}</span>
                    <strong>{{ tile.value }}</strong>
                  </div>
                </section>

                <section class="elab-main">
                  <div class="elab-column">
                    <header class="review-layer-head">
                      <div>
                        <span>Authoritative</span>
                        <strong>Slang elaboration diagnostics</strong>
                      </div>
                      <em>{{ elabDiagnostics.length + elabUnresolvedModules.length }}</em>
                    </header>
                    <div class="elab-list">
                      <button
                        v-for="diagnostic in elabDiagnostics"
                        :key="elabDiagnosticKey(diagnostic)"
                        type="button"
                        class="review-issue"
                        :class="diagnostic.severity || 'info'"
                        @click="openElabDiagnostic(diagnostic)"
                      >
                        <div class="review-issue-icon">
                          <i :class="problemIcon(diagnostic.severity || 'info')"></i>
                        </div>
                        <div class="review-issue-body">
                          <div class="review-issue-title">
                            <strong>{{
                              titleCase(diagnostic.severity || 'info')
                            }}</strong>
                            <span>Slang</span>
                          </div>
                          <p>{{ diagnostic.message || 'Slang diagnostic' }}</p>
                          <em v-if="diagnostic.source">{{
                            elabDiagnosticLocationLabel(diagnostic)
                          }}</em>
                        </div>
                      </button>
                      <div
                        v-for="moduleName in elabUnresolvedModules"
                        :key="moduleName"
                        class="elab-unresolved"
                      >
                        <i class="ri-question-line"></i>
                        <span>
                          <strong>{{ moduleName }}</strong>
                          <small>Reported unresolved by Slang elaboration.</small>
                        </span>
                      </div>
                      <div
                        v-for="moduleName in elabHeuristicCandidates"
                        :key="`heuristic:${moduleName}`"
                        class="elab-unresolved informational"
                      >
                        <i class="ri-information-line"></i>
                        <span>
                          <strong>{{ moduleName }}</strong>
                          <small>Source-scan candidate; excluded from readiness.</small>
                        </span>
                      </div>
                      <div
                        v-if="
                          elabDiagnostics.length === 0 &&
                          elabUnresolvedModules.length === 0 &&
                          elabHeuristicCandidates.length === 0
                        "
                        class="empty-panel compact"
                      >
                        <i class="ri-checkbox-circle-line"></i>
                        <span>No elaboration diagnostics or source-scan candidates.</span>
                      </div>
                    </div>
                  </div>

                  <div class="elab-column">
                    <header class="review-layer-head">
                      <div>
                        <span>Module Inventory</span>
                        <strong>Informational source inventory</strong>
                      </div>
                      <em>{{ elabModules.length }}</em>
                    </header>
                    <div class="elab-module-list">
                      <button
                        v-for="moduleItem in elabModules"
                        :key="`${moduleItem.module}:${moduleItem.path}`"
                        type="button"
                        class="elab-module-row"
                        :class="{ top: moduleItem.module === elabTopModuleName }"
                        @click="openElabModule(moduleItem)"
                      >
                        <span>
                          <strong>{{ moduleItem.module }}</strong>
                          <small
                            >{{ shortPath(moduleItem.path || '') }}:{{
                              moduleItem.line || 1
                            }}</small
                          >
                        </span>
                        <em>{{
                          moduleItem.module === elabTopModuleName
                            ? 'TOP'
                            : `${numberLabel(moduleItem.instances)} inst`
                        }}</em>
                        <div class="elab-module-meta">
                          <span
                            >Ports
                            <strong>{{ numberLabel(moduleItem.ports) }}</strong></span
                          >
                          <span
                            >Params
                            <strong>{{
                              numberLabel(moduleItem.parameters)
                            }}</strong></span
                          >
                          <span
                            >Refs
                            <strong>{{
                              numberLabel(moduleItem.instantiates?.length)
                            }}</strong></span
                          >
                        </div>
                      </button>
                      <div v-if="elabModules.length === 0" class="empty-panel compact">
                        <i class="ri-node-tree"></i>
                        <span>No module inventory was generated.</span>
                      </div>
                    </div>
                  </div>
                </section>
              </template>
            </section>

            <section v-else-if="activeTab === 'lint'" class="lint-panel">
              <div v-if="!lintReport" class="empty-panel">
                <i class="ri-bug-line"></i>
                <span>No lint summary yet. Run Lint first.</span>
              </div>
              <template v-else>
                <section class="review-overview">
                  <div
                    v-for="tile in lintSummaryTiles"
                    :key="tile.label"
                    class="review-tile"
                    :class="tile.tone"
                  >
                    <span>{{ tile.label }}</span>
                    <strong>{{ tile.value }}</strong>
                  </div>
                </section>
                <div
                  v-if="lintOwnershipRows.length"
                  class="ownership-strip lint-ownership-strip"
                >
                  <span v-for="item in lintOwnershipRows" :key="String(item.ownership)">
                    {{ titleCase(String(item.ownership || 'unknown')) }}
                    <strong>{{ numberLabel(item.total) }}</strong>
                  </span>
                </div>

                <section class="lint-main">
                  <div class="lint-column lint-diagnostics">
                    <header class="review-layer-head">
                      <div>
                        <span>Diagnostics</span>
                        <strong>{{
                          lintScope === 'actionable'
                            ? 'CPU and tool diagnostics'
                            : 'All Verilator diagnostics'
                        }}</strong>
                      </div>
                      <div class="lint-scope-control">
                        <button
                          type="button"
                          :class="{ active: lintScope === 'actionable' }"
                          @click="lintScope = 'actionable'"
                        >
                          CPU {{ lintActionableDiagnostics.length }}
                        </button>
                        <button
                          type="button"
                          :class="{ active: lintScope === 'all' }"
                          @click="lintScope = 'all'"
                        >
                          All {{ lintDiagnostics.length }}
                        </button>
                      </div>
                    </header>
                    <div class="lint-list">
                      <button
                        v-for="diagnostic in lintVisibleDiagnostics"
                        :key="lintDiagnosticKey(diagnostic)"
                        type="button"
                        class="review-issue"
                        :class="diagnostic.severity || 'info'"
                        @click="openLintDiagnostic(diagnostic)"
                      >
                        <div class="review-issue-icon">
                          <i :class="problemIcon(diagnostic.severity || 'info')"></i>
                        </div>
                        <div class="review-issue-body">
                          <div class="review-issue-title">
                            <strong>{{
                              diagnostic.code || titleCase(diagnostic.category || 'lint')
                            }}</strong>
                            <span
                              >{{ titleCase(diagnostic.ownership || 'unknown') }} ·
                              {{ titleCase(diagnostic.category || 'lint') }}</span
                            >
                          </div>
                          <p>{{ diagnostic.message || 'Verilator lint diagnostic' }}</p>
                          <em v-if="diagnostic.source">{{
                            lintDiagnosticLocationLabel(diagnostic)
                          }}</em>
                        </div>
                      </button>
                      <div
                        v-if="lintVisibleDiagnostics.length === 0"
                        class="empty-panel compact"
                      >
                        <i class="ri-checkbox-circle-line"></i>
                        <span>{{
                          lintScope === 'actionable'
                            ? 'No CPU or tool lint diagnostics.'
                            : 'No Verilator lint diagnostics.'
                        }}</span>
                      </div>
                    </div>
                  </div>

                  <div class="lint-column">
                    <header class="review-layer-head">
                      <div>
                        <span>Rule Breakdown</span>
                        <strong>Which lint rules are firing</strong>
                      </div>
                      <em>{{ lintRules.length }}</em>
                    </header>
                    <div class="lint-side-list">
                      <div
                        v-for="rule in lintRules"
                        :key="String(rule.code)"
                        class="lint-rule-row"
                        :class="{ error: numberValue(rule.errors) > 0 }"
                      >
                        <div>
                          <strong>{{ rule.code }}</strong>
                          <span>{{ titleCase(String(rule.category || 'lint')) }}</span>
                        </div>
                        <em
                          >{{ numberLabel(rule.errors) }}E /
                          {{ numberLabel(rule.warnings) }}W</em
                        >
                        <small v-if="rule.example">{{ rule.example }}</small>
                      </div>
                      <div v-if="lintRules.length === 0" class="empty-panel compact">
                        <i class="ri-checkbox-circle-line"></i>
                        <span>No lint rule hit.</span>
                      </div>
                    </div>

                    <header class="review-layer-head secondary">
                      <div>
                        <span>File Hotspots</span>
                        <strong>Where diagnostics concentrate</strong>
                      </div>
                      <em>{{ lintFiles.length }}</em>
                    </header>
                    <div class="lint-side-list compact">
                      <button
                        v-for="file in lintFiles"
                        :key="String(file.path)"
                        type="button"
                        class="lint-file-row"
                        :class="{ error: numberValue(file.errors) > 0 }"
                        @click="openSourceAt(String(file.path || ''), 1, 1)"
                      >
                        <span>
                          <strong>{{
                            file.label || fileName(String(file.path || ''))
                          }}</strong>
                          <small
                            >{{ titleCase(String(file.ownership || 'unknown')) }} ·
                            {{ shortPath(String(file.path || '')) }}</small
                          >
                        </span>
                        <em
                          >{{ numberLabel(file.errors) }}E /
                          {{ numberLabel(file.warnings) }}W</em
                        >
                      </button>
                      <div v-if="lintFiles.length === 0" class="empty-panel compact">
                        <i class="ri-file-search-line"></i>
                        <span>No file hotspot reported.</span>
                      </div>
                    </div>
                  </div>
                </section>
              </template>
            </section>

            <section v-else-if="activeTab === 'cases'" class="cases-panel">
              <div class="sim-cases-workspace">
                <div class="sim-cases-main">
                  <section v-if="cases.length" class="sim-insight-grid">
                    <div class="sim-insight-card">
                      <header>
                        <span>Run Regression</span>
                        <strong>{{
                          simRegression.baseline_run_id || 'No baseline'
                        }}</strong>
                      </header>
                      <div class="sim-regression-grid">
                        <div
                          v-for="tile in simRegressionTiles"
                          :key="tile.label"
                          :class="tile.tone"
                        >
                          <span>{{ tile.label }}</span>
                          <strong>{{ tile.value }}</strong>
                        </div>
                      </div>
                      <div v-if="simCycleChanges.length" class="sim-cycle-changes">
                        <span
                          v-for="change in simCycleChanges"
                          :key="String(change.name)"
                        >
                          <strong>{{ change.name }}</strong>
                          <em
                            :class="numberValue(change.delta) > 0 ? 'slower' : 'faster'"
                          >
                            {{ signedNumber(change.delta) }} cycles
                          </em>
                        </span>
                      </div>
                    </div>
                    <div class="sim-insight-card">
                      <header>
                        <span>Run History</span>
                        <strong>{{ simHistory.length }} recent</strong>
                      </header>
                      <div class="sim-history-list">
                        <div
                          v-for="run in simHistory.slice(0, 5)"
                          :key="String(run.run_id)"
                        >
                          <i
                            :class="
                              run.ok
                                ? 'ri-checkbox-circle-line ok'
                                : 'ri-close-circle-line failed'
                            "
                          ></i>
                          <span>
                            <strong>{{ run.run_id }}</strong>
                            <small
                              >{{ titleCase(String(run.suite || 'simulation')) }} ·
                              {{ numberLabel(run.cases) }} cases</small
                            >
                          </span>
                          <em>{{
                            run.ok ? 'PASS' : `${run.failed_cases?.length || 0} FAIL`
                          }}</em>
                        </div>
                        <div v-if="!simHistory.length" class="empty-panel compact">
                          <span>No prior run.</span>
                        </div>
                      </div>
                    </div>
                  </section>
                  <Splitter
                    v-if="shouldShowSimTerminal"
                    layout="vertical"
                    class="sim-cases-splitter frontend-resizable-splitter"
                  >
                    <SplitterPanel :size="58" :minSize="18" class="sim-cases-pane">
                      <div v-if="simResultIsStale" class="sim-stale-banner">
                        <i class="ri-time-line"></i>
                        <span
                          >{{ simResultFreshness.message }} Run again to refresh these
                          case results.</span
                        >
                      </div>
                      <div v-if="cases.length === 0" class="empty-panel">
                        <i class="ri-file-list-3-line"></i>
                        <span>No simulation case result yet.</span>
                      </div>
                      <div v-else class="cases-table-wrap">
                        <table class="cases-table">
                          <thead>
                            <tr>
                              <th>Case</th>
                              <th>Status</th>
                              <th>Cycles</th>
                              <th>Outcome</th>
                              <th>Difftest</th>
                              <th>Code</th>
                              <th>RC</th>
                              <th>Wave</th>
                              <th>Image</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr
                              v-for="testCase in cases"
                              :key="testCase.name"
                              :class="{
                                selected: selectedCase?.name === testCase.name,
                                failed: !testCase.ok,
                              }"
                              @click="selectCase(testCase)"
                            >
                              <td>
                                <div class="case-name">
                                  <i
                                    :class="
                                      testCase.ok
                                        ? 'ri-checkbox-circle-line'
                                        : 'ri-close-circle-line'
                                    "
                                  ></i>
                                  <span>
                                    <strong>{{ testCase.name }}</strong>
                                    <small
                                      v-if="caseIssue(testCase)"
                                      :title="caseIssue(testCase)"
                                    >
                                      {{ caseIssue(testCase) }}
                                    </small>
                                  </span>
                                </div>
                              </td>
                              <td>
                                <span
                                  class="case-status"
                                  :class="testCase.ok ? 'ok' : 'failed'"
                                >
                                  {{ testCase.ok ? 'PASS' : 'FAIL' }}
                                </span>
                              </td>
                              <td>{{ caseCycles(testCase) }}</td>
                              <td>
                                <span class="path-pill">{{
                                  caseTermination(testCase)
                                }}</span>
                              </td>
                              <td>
                                <button
                                  v-if="
                                    caseDifftestPc(testCase) &&
                                    testCase.program?.disassembly
                                  "
                                  type="button"
                                  class="path-pill path-button difftest-jump"
                                  :title="`Open disassembly at ${caseDifftestPc(testCase)}`"
                                  @click.stop="
                                    openDisassembly(testCase, caseDifftestPc(testCase))
                                  "
                                >
                                  <i class="ri-focus-3-line"></i>
                                  {{ caseDifftestStatus(testCase) }}
                                  <small>{{ caseDifftestPc(testCase) }}</small>
                                </button>
                                <span v-else class="path-pill">{{
                                  caseDifftestStatus(testCase)
                                }}</span>
                              </td>
                              <td>
                                <button
                                  v-if="testCase.program?.disassembly"
                                  type="button"
                                  class="case-icon-action"
                                  :class="{
                                    active:
                                      disassemblyPanelOpen &&
                                      selectedCase?.name === testCase.name,
                                  }"
                                  :title="
                                    disassemblyPanelOpen &&
                                    selectedCase?.name === testCase.name
                                      ? 'Hide disassembly'
                                      : `Open ${testCase.name} disassembly`
                                  "
                                  @click.stop="toggleDisassembly(testCase)"
                                >
                                  <i class="ri-code-s-slash-line"></i>
                                </button>
                                <span v-else class="path-pill">-</span>
                              </td>
                              <td>{{ testCase.returncode ?? '-' }}</td>
                              <td>
                                <button
                                  v-if="testCase.wave"
                                  type="button"
                                  class="path-pill path-button"
                                  :title="testCase.wave"
                                  @click.stop="openWaveform(testCase.wave, testCase.name)"
                                >
                                  <i class="ri-pulse-line"></i>
                                  {{ fileName(testCase.wave) }}
                                </button>
                                <span v-else class="path-pill">-</span>
                              </td>
                              <td>
                                <span class="path-pill" :title="testCase.image || ''">
                                  {{ testCase.image ? fileName(testCase.image) : '-' }}
                                </span>
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </SplitterPanel>
                    <SplitterPanel :size="42" :minSize="18" class="sim-terminal-pane">
                      <section class="sim-terminal-card">
                        <header class="sim-terminal-head">
                          <div>
                            <span>Simulation Terminal</span>
                            <strong>{{ simTerminalTitle }}</strong>
                          </div>
                          <div class="sim-terminal-actions">
                            <select
                              v-if="simTerminalLogs.length"
                              v-model="selectedLogPath"
                              class="log-select compact"
                              @change="loadSelectedLog"
                            >
                              <option
                                v-for="log in simTerminalLogs"
                                :key="log.path"
                                :value="log.path"
                              >
                                {{ log.label }}
                              </option>
                            </select>
                            <button
                              type="button"
                              class="icon-action compact"
                              :disabled="logLoading || !selectedLogPath"
                              @click="loadSelectedLog"
                            >
                              <i
                                :class="
                                  logLoading
                                    ? 'ri-loader-4-line animate-spin'
                                    : 'ri-refresh-line'
                                "
                              ></i>
                            </button>
                          </div>
                        </header>
                        <div
                          v-if="selectedCase && !selectedCase.ok && selectedCase.failure"
                          class="sim-failure-summary"
                        >
                          <strong>{{
                            selectedCase.failure.message ||
                            titleCase(selectedCase.failure.kind || 'simulation failure')
                          }}</strong>
                          <span v-if="selectedCase.failure.first_error">{{
                            selectedCase.failure.first_error
                          }}</span>
                        </div>
                        <pre class="sim-terminal-output">{{ simTerminalContent }}</pre>
                      </section>
                    </SplitterPanel>
                  </Splitter>
                  <template v-else>
                    <div v-if="simResultIsStale" class="sim-stale-banner">
                      <i class="ri-time-line"></i>
                      <span
                        >{{ simResultFreshness.message }} Run again to refresh these case
                        results.</span
                      >
                    </div>
                    <div v-if="cases.length === 0" class="empty-panel">
                      <i class="ri-file-list-3-line"></i>
                      <span>No simulation case result yet.</span>
                    </div>
                    <div v-else class="cases-table-wrap">
                      <table class="cases-table">
                        <thead>
                          <tr>
                            <th>Case</th>
                            <th>Status</th>
                            <th>Cycles</th>
                            <th>Outcome</th>
                            <th>Difftest</th>
                            <th>Code</th>
                            <th>RC</th>
                            <th>Wave</th>
                            <th>Image</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr
                            v-for="testCase in cases"
                            :key="testCase.name"
                            :class="{
                              selected: selectedCase?.name === testCase.name,
                              failed: !testCase.ok,
                            }"
                            @click="selectCase(testCase)"
                          >
                            <td>
                              <div class="case-name">
                                <i
                                  :class="
                                    testCase.ok
                                      ? 'ri-checkbox-circle-line'
                                      : 'ri-close-circle-line'
                                  "
                                ></i>
                                <span>
                                  <strong>{{ testCase.name }}</strong>
                                  <small
                                    v-if="caseIssue(testCase)"
                                    :title="caseIssue(testCase)"
                                  >
                                    {{ caseIssue(testCase) }}
                                  </small>
                                </span>
                              </div>
                            </td>
                            <td>
                              <span
                                class="case-status"
                                :class="testCase.ok ? 'ok' : 'failed'"
                              >
                                {{ testCase.ok ? 'PASS' : 'FAIL' }}
                              </span>
                            </td>
                            <td>{{ caseCycles(testCase) }}</td>
                            <td>
                              <span class="path-pill">{{
                                caseTermination(testCase)
                              }}</span>
                            </td>
                            <td>
                              <button
                                v-if="
                                  caseDifftestPc(testCase) &&
                                  testCase.program?.disassembly
                                "
                                type="button"
                                class="path-pill path-button difftest-jump"
                                :title="`Open disassembly at ${caseDifftestPc(testCase)}`"
                                @click.stop="
                                  openDisassembly(testCase, caseDifftestPc(testCase))
                                "
                              >
                                <i class="ri-focus-3-line"></i>
                                {{ caseDifftestStatus(testCase) }}
                                <small>{{ caseDifftestPc(testCase) }}</small>
                              </button>
                              <span v-else class="path-pill">{{
                                caseDifftestStatus(testCase)
                              }}</span>
                            </td>
                            <td>
                              <button
                                v-if="testCase.program?.disassembly"
                                type="button"
                                class="case-icon-action"
                                :class="{
                                  active:
                                    disassemblyPanelOpen &&
                                    selectedCase?.name === testCase.name,
                                }"
                                :title="
                                  disassemblyPanelOpen &&
                                  selectedCase?.name === testCase.name
                                    ? 'Hide disassembly'
                                    : `Open ${testCase.name} disassembly`
                                "
                                @click.stop="toggleDisassembly(testCase)"
                              >
                                <i class="ri-code-s-slash-line"></i>
                              </button>
                              <span v-else class="path-pill">-</span>
                            </td>
                            <td>{{ testCase.returncode ?? '-' }}</td>
                            <td>
                              <button
                                v-if="testCase.wave"
                                type="button"
                                class="path-pill path-button"
                                :title="testCase.wave"
                                @click.stop="openWaveform(testCase.wave, testCase.name)"
                              >
                                <i class="ri-pulse-line"></i>
                                {{ fileName(testCase.wave) }}
                              </button>
                              <span v-else class="path-pill">-</span>
                            </td>
                            <td>
                              <span class="path-pill" :title="testCase.image || ''">
                                {{ testCase.image ? fileName(testCase.image) : '-' }}
                              </span>
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </template>
                </div>
                <aside v-if="disassemblyPanelOpen" class="sim-disassembly-pane">
                  <FrontendDisassemblyViewer
                    :path="selectedDisassemblyPath"
                    :target-address="disassemblyTarget.address"
                    :target-token="disassemblyTarget.token"
                    closable
                    @close="closeDisassembly"
                  />
                </aside>
              </div>
            </section>
          </main>

          <section
            v-if="shouldShowStepConsole"
            class="frontend-console"
            :class="{ collapsed: consoleCollapsed, resizing: consoleResizing }"
            :style="consoleStyle"
          >
            <div
              v-if="!consoleCollapsed"
              class="console-resizer"
              role="separator"
              aria-orientation="horizontal"
              title="Drag to resize console"
              @pointerdown="startConsoleResize"
              @dblclick="resetConsoleHeight"
            ></div>
            <header class="console-head">
              <div class="console-tabs">
                <button
                  type="button"
                  class="console-tab"
                  :class="{ active: consoleTab === 'problems' }"
                  @click="openConsoleTab('problems')"
                >
                  <i class="ri-error-warning-line"></i>
                  <span>Problems</span>
                  <em v-if="consoleProblemCount">{{ consoleProblemCount }}</em>
                </button>
                <button
                  type="button"
                  class="console-tab"
                  :class="{ active: consoleTab === 'log' }"
                  @click="openConsoleTab('log')"
                >
                  <i class="ri-terminal-box-line"></i>
                  <span>Log</span>
                </button>
              </div>
              <div class="console-actions">
                <span :title="consoleContext">{{ consoleContext }}</span>
                <button
                  type="button"
                  class="icon-action compact"
                  :title="consoleCollapsed ? 'Expand console' : 'Collapse console'"
                  @click="consoleCollapsed = !consoleCollapsed"
                >
                  <i
                    :class="
                      consoleCollapsed ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'
                    "
                  ></i>
                </button>
              </div>
            </header>

            <div v-if="!consoleCollapsed" class="console-body">
              <section v-if="consoleTab === 'problems'" class="problem-panel">
                <button
                  v-for="problem in consoleProblems"
                  :key="problemKey(problem)"
                  type="button"
                  class="problem-row"
                  :class="problem.severity"
                  :title="problemTooltip(problem)"
                  @click="openProblem(problem)"
                >
                  <i :class="problemIcon(problem.severity)"></i>
                  <span>
                    <strong>{{ problem.title }}</strong>
                    <small>{{ problem.detail }}</small>
                  </span>
                  <em class="problem-target">
                    {{ problem.sourcePath ? 'Src' : 'Log' }}
                  </em>
                </button>
                <div v-if="!consoleProblems.length" class="console-empty">
                  <i class="ri-checkbox-circle-line"></i>
                  <span>No problems detected in the selected log.</span>
                </div>
              </section>

              <section v-else class="console-log-panel">
                <div class="console-log-tools">
                  <select
                    v-model="selectedLogPath"
                    class="log-select compact"
                    @change="loadSelectedLog"
                  >
                    <option
                      v-for="log in textViewFiles"
                      :key="log.path"
                      :value="log.path"
                    >
                      {{ log.label }}
                    </option>
                  </select>
                  <button
                    type="button"
                    class="icon-action compact"
                    :disabled="logLoading || !selectedLogPath"
                    @click="loadSelectedLog"
                  >
                    <i
                      :class="
                        logLoading ? 'ri-loader-4-line animate-spin' : 'ri-refresh-line'
                      "
                    ></i>
                  </button>
                </div>
                <pre class="console-log">{{ logContent || 'No log content.' }}</pre>
              </section>
            </div>
          </section>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { DesignRuntimeEvent, WorkspaceStepResource } from '@ecos-studio/shared'
import {
  getWorkspaceResourceIndexApi,
  resolveWorkspaceStepInfoApi,
} from '@/api/workspaceResources'
import { CMDEnum, InfoEnum, StateEnum, getStepMetadata } from '@/api/type'
import { runStepApi } from '@/api/flow'
import { loadFrontendStepDetailApi } from '@/api/frontendDetail'
import { useWorkspace } from '@/composables/useWorkspace'
import { isFlowExecutionActiveForWorkspace } from '@/composables/useFlowRunner'
import { useParameters } from '@/composables/useParameters'
import { readOptionalProjectTextFileTail } from '@/utils/projectFiles'
import {
  SIM_SUITE_IDS,
  simContextsEqual,
  type SimRunContext,
  type SimSuite,
} from '@/utils/simRunContext'
import { getDesktopApi } from '@/platform/desktop'
import FrontendDisassemblyViewer from '@/components/frontend/FrontendDisassemblyViewer.vue'
import FrontendSrcWorkspace from '@/components/frontend/FrontendSrcWorkspace.vue'
import FrontendWaveWorkspace from '@/components/frontend/FrontendWaveWorkspace.vue'
import Splitter from 'primevue/splitter'
import SplitterPanel from 'primevue/splitterpanel'
import {
  diagnosticMatchesPath,
  fileName as diagnosticFileName,
  parseVerilatorDiagnostics,
  type VerilatorDiagnostic,
} from '@/utils/verilatorDiagnostics'

interface PathItem {
  label: string
  path: string
}

interface SimCase {
  name: string
  ok: boolean
  suite?: string
  returncode?: number
  image?: string
  log?: string
  report_log?: string
  run_log?: string
  wave?: string
  run_id?: string
  program?: {
    source?: string
    elf?: string
    binary?: string
    image?: string
    disassembly?: string
  }
  validation?: {
    type?: string
    required_markers?: string[]
    missing_markers?: string[]
  }
  metrics?: SimCaseMetrics
  failure?: SimFailure
}

interface SimCaseMetrics {
  cycles?: number | null
  max_cycles?: number | null
  termination?: string
  trap_code?: number | null
  timeout_accepted?: boolean
  difftest?: {
    enabled?: boolean
    status?: string
    last_pc?: string | null
    last_npc?: string | null
    first_mismatch?: { message?: string; pc?: string | null } | null
  }
  [key: string]: unknown
}

interface SimFailure {
  kind?: string
  message?: string
  first_error?: string
  log_tail?: string
  wave?: string
}

interface SimRegression {
  has_baseline?: boolean
  baseline_run_id?: string
  new_failures?: string[]
  persistent_failures?: string[]
  fixed?: string[]
  added?: string[]
  removed?: string[]
  cycle_changes?: Array<{
    name?: string
    previous?: number
    current?: number
    delta?: number
    delta_percent?: number | null
  }>
}

interface SimHistoryRun {
  run_id?: string
  suite?: string
  ok?: boolean
  cases?: number
  failed_cases?: string[]
  regression?: SimRegression
}

interface SimReport {
  run_id?: string
  suite?: string
  regression?: SimRegression
  history?: SimHistoryRun[]
  history_path?: string
}

interface FrontendStepDetail {
  step: string
  tool: string
  state: string
  runtime: string
  peak_memory_mb?: number
  summary: Record<string, unknown>
  prepare?: PrepareReport
  cases?: SimCase[]
  sim?: SimReport
  review?: RtlReviewReport
  elab?: ElabReport
  lint?: LintReport
  logs: PathItem[]
  reports: PathItem[]
  artifacts: PathItem[]
  info?: Record<string, unknown>
  provenance?: Record<string, unknown>
}

interface WaveSelection {
  path: string
  caseName?: string
}

interface FrontendSourceSelection {
  label: string
  path: string
}

interface FrontendConfigItem {
  label: string
  value: string
  mono?: boolean
  highlight?: boolean
  wide?: boolean
}

interface PrepareInfoItem {
  label: string
  value: string
  mono?: boolean
}

interface PrepareInputSource {
  label: string
  path?: string
  rtl_files?: number
  filtered_rtl_files?: number
  skipped?: string
}

interface PrepareContract {
  label: string
  status: string
  detail: string
}

interface PrepareReport {
  readiness?: {
    status?: string
    message?: string
    rtl_files?: number
    incdirs?: number
    defines?: number
  }
  configuration?: PrepareInfoItem[]
  inputs?: {
    cpu_rtl_files?: number
    total_rtl_files?: number
    incdirs?: number
    defines?: number
    sources?: PrepareInputSource[]
    manifest?: string
    merged_filelist?: string
    rtl_sources?: Array<{ path?: string; ownership?: string; source?: string }>
  }
  ownership?: Record<string, number>
  cpu_top_contract?: {
    status?: string
    module?: string
    source?: string
    ports?: Array<{ name?: string; direction?: string; width?: number }>
    expected_ports?: number
    differences?: Record<string, unknown>
  }
  contracts?: PrepareContract[]
  runtime?: PrepareInfoItem[]
  reports?: Record<string, unknown>
}

type TabId = 'summary' | 'review' | 'elab' | 'lint' | 'cases' | 'src'
type ConsoleTabId = 'problems' | 'log'
type RunPhase = 'idle' | 'queued' | 'running' | 'refreshing'
type ReviewMode = 'source' | 'yosys' | 'modules'
type CoremarkCompilePreset = 'balanced' | 'speed' | 'size' | 'debug' | 'custom'

interface ConsoleProblem {
  severity: 'error' | 'warning' | 'info'
  title: string
  detail: string
  path?: string
  sourcePath?: string
  line?: number
  column?: number
}

interface DiagnosticCount {
  errors: number
  warnings: number
  total: number
}

interface SourcePathItem extends PathItem {
  diagnostics?: DiagnosticCount
}

interface RtlReviewIssue {
  severity: 'error' | 'warning' | 'info'
  category: string
  title: string
  detail: string
  source?: string
  line?: number
  column?: number
  evidence?: Record<string, unknown>
  recommendation?: string
  fingerprint?: string
  confidence?: string
  origin?: string
  ownership?: string
  status?: string
  waived?: boolean
  waiver?: { reason?: string }
}

interface RtlReviewReport {
  path?: string
  scope?: string
  summary?: Record<string, unknown>
  metrics?: Record<string, unknown>
  issues?: RtlReviewIssue[]
  source_files?: Array<{ path: string; label?: string; lines?: number }>
  structural_probe?: Record<string, unknown>
  yosys_precheck?: Record<string, unknown>
  next_analyzers?: string[]
  delta?: {
    baseline?: string
    new?: number
    existing?: number
    resolved?: number
  }
  resolved_issues?: RtlReviewIssue[]
  waivers?: {
    configured?: number
    applied?: number
    invalid?: unknown[]
  }
}

interface ElabDiagnostic {
  severity?: 'error' | 'warning' | 'info'
  message?: string
  source?: string
  line?: number
  column?: number
  ownership?: string
}

interface ElabModule {
  module?: string
  path?: string
  line?: number
  ports?: number
  parameters?: number
  instances?: number
  instantiates?: string[]
  ownership?: string
}

interface ElabReadiness {
  status?: string
  message?: string
  top_module?: string
  top_found?: boolean
  errors?: number
  warnings?: number
  diagnostics?: number
  unresolved_modules?: number
  rtl_files?: number
  modules?: number
  referenced_modules?: number
}

interface ElabHierarchy {
  top_module?: string
  top_children?: string[]
  module_count?: number
  referenced_count?: number
  unresolved?: string[]
  largest_modules?: ElabModule[]
  heuristic_unresolved_candidates?: string[]
  inventory_source?: string
  inventory_authoritative?: boolean
}

interface ElabNextAction {
  title?: string
  detail?: string
  target?: string
}

interface ElabReport {
  path?: string
  tool?: string
  status?: string
  returncode?: number
  top_module?: string
  summary?: Record<string, unknown>
  diagnostics?: ElabDiagnostic[]
  modules?: ElabModule[]
  unresolved_modules?: string[]
  heuristic_unresolved_candidates?: string[]
  referenced_modules?: string[]
  readiness?: ElabReadiness
  hierarchy?: ElabHierarchy
  next_action?: ElabNextAction
  inputs?: {
    rtl_files?: string[]
    rtl_file_count?: number
    incdirs?: string[]
    defines?: string[]
  }
  reports?: Record<string, unknown>
  compiler?: { source?: string; authoritative?: boolean; elaboration_mode?: string }
  inventory?: { source?: string; authoritative?: boolean; note?: string }
}

interface LintDiagnostic {
  severity?: 'error' | 'warning' | 'info'
  code?: string
  category?: string
  message?: string
  source?: string
  line?: number
  column?: number
  raw?: string
  ownership?: string
  actionable?: boolean
}

interface LintRule {
  code?: string
  category?: string
  errors?: number
  warnings?: number
  total?: number
  example?: string
}

interface LintFile {
  path?: string
  label?: string
  errors?: number
  warnings?: number
  total?: number
  rules?: string[]
  ownership?: string
  actionable?: boolean
}

interface LintOwnership {
  ownership?: string
  errors?: number
  warnings?: number
  total?: number
  actionable?: boolean
}

interface LintReport {
  path?: string
  tool?: string
  status?: string
  returncode?: number
  top_module?: string
  summary?: Record<string, unknown>
  diagnostics?: LintDiagnostic[]
  rules?: LintRule[]
  files?: LintFile[]
  ownership?: LintOwnership[]
  inputs?: {
    rtl_files?: string[]
    rtl_file_count?: number
    incdirs?: string[]
    defines?: string[]
  }
  reports?: Record<string, unknown>
}

interface YosysDiagnostic {
  severity?: 'error' | 'warning' | 'info'
  message?: string
  category?: string
  source?: string
  line?: number
  column?: number
}

interface ModuleRisk {
  module?: string
  score?: number
  risk?: string
  cells?: number
  wires?: number
  ports?: number
  processes?: number
  mux_cells?: number
  arithmetic_cells?: number
  memory_cells?: number
  max_fanout?: number
  max_fanin?: number
  max_comb_depth?: number
  reasons?: string[]
}

interface ReviewHotspot {
  title: string
  value: string
  detail: string
  tone: 'warning' | 'error' | 'info'
  source?: string
  line?: number
  column?: number
}

const route = useRoute()
const router = useRouter()
const {
  currentProject,
  resourceVersions,
  showToast,
  invalidateWorkspaceResources,
  workspaceSession,
} = useWorkspace()
const { config } = useParameters()
const CONSOLE_MIN_HEIGHT = 128
const CONSOLE_DEFAULT_HEIGHT = 178
const CONSOLE_MAX_HEIGHT = 420

const steps = ref<WorkspaceStepResource[]>([])
const loading = ref(false)
const runBusy = ref(false)
const runPhase = ref<RunPhase>('idle')
const runStartedAt = ref(0)
const runClockTick = ref(0)
const runJobId = ref('')
const logLoading = ref(false)
const error = ref('')
const detail = ref<FrontendStepDetail | null>(null)
const activeTab = ref<TabId>('summary')
const selectedCase = ref<SimCase | null>(null)
const disassemblyPanelOpen = ref(false)
const disassemblyTarget = ref({ address: '', token: 0 })
const selectedLogPath = ref('')
const logContent = ref('')
const activeSource = ref<FrontendSourceSelection | null>(null)
const activeWaveform = ref<WaveSelection | null>(null)
const cachedWaveItems = ref<WaveSelection[]>([])
const consoleCollapsed = ref(true)
const consoleHeight = ref(CONSOLE_DEFAULT_HEIGHT)
const consoleResizing = ref(false)
const consoleTab = ref<ConsoleTabId>('problems')
const reviewMode = ref<ReviewMode>('source')
const lintScope = ref<'actionable' | 'all'>('actionable')
const sourceFocusTarget = ref<{
  path?: string
  line?: number
  column?: number
  token: number
} | null>(null)
let sourceFocusToken = 0
const simSuitePresentation: Record<SimSuite, { label: string; icon: string }> = {
  cpu_tests: { label: 'CPU Tests', icon: 'ri-cpu-line' },
  coremark: { label: 'CoreMark', icon: 'ri-speed-up-line' },
}
const simSuites = SIM_SUITE_IDS.map((id) => ({ id, ...simSuitePresentation[id] }))
const coremarkCompilePresets: Array<{
  id: CoremarkCompilePreset
  label: string
  opt: string
}> = [
  { id: 'balanced', label: 'Balanced', opt: '-O2' },
  { id: 'speed', label: 'Speed', opt: '-O3' },
  { id: 'size', label: 'Size', opt: '-Os' },
  { id: 'debug', label: 'Debug', opt: '-O0' },
  { id: 'custom', label: 'Custom', opt: '-O2' },
]
const coremarkOptLevels = ['-O0', '-O1', '-O2', '-O3', '-Os', '-Og']
const coremarkMarchOptions = ['rv32im_zicsr', 'rv32i_zicsr', 'rv32imc_zicsr']
const coremarkMabiOptions = ['ilp32']
const simSuite = ref<SimSuite>('cpu_tests')
const runningSimSuite = ref<SimSuite | null>(null)
const simCpuMode = ref<'all' | 'selected'>('selected')
const selectedCpuCases = ref<string[]>([])
const cpuCasePickerOpen = ref(false)
const coremarkCompilePreset = ref<CoremarkCompilePreset>('balanced')
const coremarkOptLevel = ref('-O2')
const coremarkMarch = ref('rv32im_zicsr')
const coremarkMabi = ref('ilp32')
const coremarkIterations = ref(128)
const coremarkTotalDataSize = ref(2000)
const coremarkHasFloat = ref(true)
const coremarkExtraCflags = ref('')
const surferFrame = ref<HTMLIFrameElement | null>(null)
const surferReady = ref(false)
const waveformLoading = ref(false)
const waveformError = ref('')
let waveformLoadToken = 0
let loadedWaveformKey = ''
let unsubscribeRuntimeEvents: (() => void) | null = null
let consoleResizeStartY = 0
let consoleResizeStartHeight = 0
let splitterResizing = false
let runClockTimer: number | null = null

const isHomeView = computed(() => route.path.endsWith('/home'))
const isGlobalSrcView = computed(
  () => String(route.params.step || '').toLowerCase() === 'src',
)
const isGlobalWaveView = computed(
  () => String(route.params.step || '').toLowerCase() === 'wave',
)
const currentStepName = computed(() => {
  const param = String(route.params.step || '')
  return param && param !== 'home' && !['src', 'wave'].includes(param.toLowerCase())
    ? param
    : ''
})
const currentStep = computed(
  () =>
    steps.value.find(
      (step) => step.name.toLowerCase() === currentStepName.value.toLowerCase(),
    ) ?? null,
)
const isSimStep = computed(() => currentStepName.value.toLowerCase() === 'sim')
const isPrepareStep = computed(() => currentStepName.value.toLowerCase() === 'prepare')
const isReviewStep = computed(() => currentStepName.value.toLowerCase() === 'review')
const isElabStep = computed(() => currentStepName.value.toLowerCase() === 'elab')
const isLintStep = computed(() => currentStepName.value.toLowerCase() === 'lint')
const detailRequestStepName = computed(() => {
  if (isGlobalSrcView.value) return 'prepare'
  if (isGlobalWaveView.value) return 'sim'
  return currentStepName.value
})
const completedCount = computed(
  () => steps.value.filter((step) => step.state === 'Success').length,
)
const nextPendingStep = computed(
  () => steps.value.find((step) => step.state !== 'Success') ?? null,
)
const stepTitle = computed(() => {
  if (isHomeView.value) {
    return currentProject.value?.name || 'Frontend Workspace'
  }
  if (isGlobalSrcView.value) return 'Source Workspace'
  if (isGlobalWaveView.value) return 'Waveform Workspace'
  return labelForStep(currentStepName.value || 'Step')
})
const currentOverallState = computed(() => {
  if (steps.value.some((step) => step.state === 'Ongoing')) return 'Running'
  if (steps.value.some((step) => step.state === 'Invalid' || step.state === 'Incomplete'))
    return 'Attention Needed'
  if (steps.value.length > 0 && steps.value.every((step) => step.state === 'Success'))
    return 'Complete'
  return 'Ready'
})
const latestActiveTool = computed(() => {
  const lastStep = steps.value.length > 0 ? steps.value[steps.value.length - 1] : null
  return nextPendingStep.value?.tool || lastStep?.tool || 'frontend'
})
const simStepState = computed(() => {
  const simStep = steps.value.find((step) => step.name.toLowerCase() === 'sim')
  return simStep?.state || 'Unstart'
})
const currentStepDisplayState = computed(() =>
  runBusy.value && currentStep.value
    ? runPhaseDisplayLabel(runPhase.value)
    : detail.value?.state || currentStep.value?.state || 'Unstart',
)
const currentStepRuntime = computed(() =>
  runBusy.value
    ? runElapsedLabel()
    : detail.value?.runtime || currentStep.value?.runtime || '--',
)
const runElapsedSecondsLabel = computed(() => {
  void runClockTick.value
  if (!runStartedAt.value) return '0000s'
  const seconds = Math.max(0, Math.floor((Date.now() - runStartedAt.value) / 1000))
  return `${String(seconds).padStart(4, '0')}s`
})
const simSuiteLabel = computed(() => simSuiteLabelFor(simSuite.value))
const runningSimSuiteLabel = computed(() =>
  simSuiteLabelFor(runningSimSuite.value || simSuite.value),
)
const cases = computed(() => detail.value?.cases || [])
const totalCases = computed(() => cases.value.length)
const passedCases = computed(() => cases.value.filter((testCase) => testCase.ok).length)
const simReport = computed<SimReport>(() => detail.value?.sim || {})
const simRegression = computed<SimRegression>(() => simReport.value.regression || {})
const simHistory = computed<SimHistoryRun[]>(() =>
  Array.isArray(simReport.value.history) ? simReport.value.history.slice(0, 8) : [],
)
const simCycleChanges = computed(() =>
  Array.isArray(simRegression.value.cycle_changes)
    ? simRegression.value.cycle_changes.slice(0, 4)
    : [],
)
const simRegressionTiles = computed(() => [
  {
    label: 'Baseline',
    value: simRegression.value.has_baseline ? 'Compared' : 'First Run',
    tone: simRegression.value.has_baseline ? 'neutral' : 'ok',
  },
  {
    label: 'New Failures',
    value: numberLabel(simRegression.value.new_failures?.length),
    tone: simRegression.value.new_failures?.length ? 'error' : 'ok',
  },
  {
    label: 'Persistent',
    value: numberLabel(simRegression.value.persistent_failures?.length),
    tone: simRegression.value.persistent_failures?.length ? 'warning' : 'ok',
  },
  {
    label: 'Fixed',
    value: numberLabel(simRegression.value.fixed?.length),
    tone: simRegression.value.fixed?.length ? 'ok' : 'neutral',
  },
])
const stepStaleReason = computed(() =>
  detail.value?.info?.stale === true
    ? String(detail.value.info.stale_reason || 'Step inputs changed.')
    : '',
)
const detailWaveItems = computed<WaveSelection[]>(() =>
  uniqueWaveItems([
    ...cases.value
      .filter((testCase) => Boolean(testCase.wave))
      .map((testCase) => ({
        path: String(testCase.wave || ''),
        caseName: testCase.name,
      })),
    ...(detail.value?.artifacts || [])
      .filter((artifact) => isWaveformPath(artifact.path))
      .map((artifact) => ({
        path: artifact.path,
        caseName: caseNameForWaveArtifact(artifact),
      })),
  ]),
)
const fallbackWaveItems = computed<WaveSelection[]>(() =>
  uniqueWaveItems([
    ...cachedWaveItems.value,
    ...(detail.value?.artifacts || [])
      .filter((artifact) => isWaveformPath(artifact.path))
      .map((artifact) => ({
        path: artifact.path,
        caseName: caseNameForWaveArtifact(artifact),
      })),
    ...cases.value
      .filter((testCase) => Boolean(testCase.wave))
      .map((testCase) => ({
        path: String(testCase.wave || ''),
        caseName: testCase.name,
      })),
  ]),
)
const detailIsSimStep = computed(
  () => String(detail.value?.step || '').toLowerCase() === 'sim',
)
const waveItems = computed<WaveSelection[]>(() =>
  detailIsSimStep.value ? detailWaveItems.value : fallbackWaveItems.value,
)
const selectedCpuRunCases = computed(() => cpuRunCasesForSelection())
const cpuCaseSelectionLabel = computed(() => {
  if (!selectedCpuRunCases.value.length) return 'Select CPU test cases'
  if (selectedCpuRunCases.value.length === 1) return selectedCpuRunCases.value[0]
  return `${selectedCpuRunCases.value.length} CPU tests selected`
})
const coremarkCompileSummary = computed(() => {
  const flags = [
    coremarkOptLevel.value,
    `-march=${coremarkMarch.value}`,
    `-mabi=${coremarkMabi.value}`,
    ...splitCompileFlags(coremarkExtraCflags.value),
  ]
  return `${flags.join(' ')} · ${Math.max(1, Number(coremarkIterations.value) || 128)} iterations`
})
const currentSimRunContext = computed<SimRunContext>(() => ({
  suite: simSuite.value,
  mode: simSuite.value === 'cpu_tests' ? simCpuMode.value : 'selected',
  cases: simCasesForSuite(simSuite.value),
}))
const resultSimRunContext = computed<SimRunContext | null>(() =>
  resultContextFromDetail(),
)
const simResultFreshness = computed(() => simResultFreshnessText())
const simResultIsStale = computed(
  () => isSimStep.value && simResultFreshness.value.state === 'stale',
)
const simRunSubtitle = computed(() => {
  if (runBusy.value) return `Running ${runningSimSuiteLabel.value}`
  if (!cases.value.length) return 'No simulation result yet'
  return simResultFreshness.value.message
})
const shouldShowSimTerminal = computed(
  () =>
    isSimStep.value &&
    (runBusy.value || cases.value.length > 0 || textViewFiles.value.length > 0),
)
const simTerminalLogs = computed(() => textViewFiles.value)
const selectedDisassemblyPath = computed(
  () => selectedCase.value?.program?.disassembly || '',
)
const simTerminalTitle = computed(() => {
  if (runBusy.value) return `Running ${runningSimSuiteLabel.value}`
  if (selectedCase.value?.name)
    return `${selectedCase.value.name} · ${selectedCase.value.ok ? 'PASS' : 'FAIL'}`
  if (resultSimRunContext.value) return simContextLabel(resultSimRunContext.value)
  return simSuiteLabel.value
})
const simTerminalContent = computed(() => {
  if (logContent.value) return logContent.value
  if (runBusy.value) {
    return [
      `Running ${runningSimSuiteLabel.value}...`,
      'Waiting for simulation output.',
      'The terminal will refresh when the run completes.',
    ].join('\n')
  }
  return 'No simulation output yet.'
})
const frontendConfigItems = computed<FrontendConfigItem[]>(() => [
  {
    label: 'Design',
    value: config.design || currentProject.value?.name || '--',
    highlight: true,
  },
  { label: 'Top Module', value: config.topModule || '--', mono: true },
  {
    label: 'CPU Source',
    value: displayCatalogId(
      config.frontend.coreId || (config.frontend.cpuFilelist ? 'custom-filelist' : ''),
    ),
  },
  {
    label: 'CPU Wrapper',
    value: displayCatalogId(
      config.frontend.cpuWrapperTop || config.frontend.cpuWrapperContract || '',
    ),
    mono: true,
  },
  {
    label: 'CPU Socket',
    value: displayCatalogId(config.frontend.cpuSocketContract || ''),
    mono: true,
  },
  {
    label: 'SoC Harness',
    value: displayCatalogId(
      config.frontend.socHarnessId || config.frontend.socVariant || '',
    ),
  },
  { label: 'Toolchain', value: displayCatalogId(config.frontend.toolchainId || '') },
  { label: 'Test Suite', value: displayCatalogId(config.frontend.testSuiteId || '') },
  { label: 'Clock', value: config.clock || '--' },
  {
    label: 'Target Frequency',
    value: config.frequencyMax ? `${config.frequencyMax} MHz` : '--',
  },
  {
    label: 'CPU Filelist',
    value: config.frontend.cpuFilelist || config.frontend.inputFilelist || '--',
    mono: true,
    wide: true,
  },
  {
    label: 'Default Cases',
    value: config.frontend.simAllTests
      ? 'All CPU tests'
      : config.frontend.simProgramNames.length
        ? config.frontend.simProgramNames.join(', ')
        : '--',
    mono: true,
    wide: true,
  },
])
const workspaceGuideItems = computed(() => [
  {
    icon: 'ri-cpu-line',
    title: 'CPU and SoC contract',
    text: `${displayCatalogId(config.frontend.coreId || 'Custom CPU')} runs through ${displayCatalogId(config.frontend.socHarnessId || config.frontend.socVariant || 'Selected harness')}.`,
  },
  {
    icon: 'ri-play-list-2-line',
    title: 'Simulation workflow',
    text: 'Run prepare first, then choose CPU Tests or CoreMark in Sim. Changed selections are marked stale until rerun.',
  },
  {
    icon: 'ri-bug-line',
    title: 'Debug loop',
    text: 'Use Problems for diagnostics, Src for editable RTL, and Wave for waveform inspection.',
  },
])
const availableCpuTests = computed(() => {
  const raw = detail.value?.summary?.available_cpu_tests
  return Array.isArray(raw) ? raw.map((item) => String(item)).filter(Boolean) : []
})
const defaultCpuTests = computed(() => {
  const raw = detail.value?.summary?.default_cpu_tests
  return Array.isArray(raw) ? raw.map((item) => String(item)).filter(Boolean) : []
})
const reports = computed(() => detail.value?.reports || [])
const prepareReport = computed<PrepareReport | null>(() => {
  const prepare = detail.value?.prepare
  if (!prepare) return null
  if (prepare.readiness || prepare.configuration?.length || prepare.contracts?.length)
    return prepare
  return null
})
const prepareReadiness = computed(() => prepareReport.value?.readiness || {})
const prepareConfiguration = computed(() => prepareReport.value?.configuration || [])
const prepareInputs = computed(() => prepareReport.value?.inputs || {})
const prepareInputSources = computed(() => prepareInputs.value.sources || [])
const prepareOwnershipRows = computed(() =>
  Object.entries(prepareReport.value?.ownership || {})
    .map(([ownership, count]) => ({ ownership, count: numberValue(count) }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count),
)
const prepareCpuTopContract = computed(() => prepareReport.value?.cpu_top_contract || {})
const prepareCpuTopContractDetail = computed(() => {
  const detected = prepareCpuTopContract.value.ports?.length || 0
  const expected = numberValue(prepareCpuTopContract.value.expected_ports)
  if (expected > 0) return `${detected} detected / ${expected} expected ports`
  return `${detected} detected ports · module presence validated`
})
const prepareContracts = computed(() => prepareReport.value?.contracts || [])
const prepareContractStatuses = computed(() => [
  ...prepareContracts.value.map((item) => item.status),
  ...(prepareCpuTopContract.value.module
    ? [String(prepareCpuTopContract.value.status || 'pending')]
    : []),
])
const prepareRuntimePlan = computed(() => prepareReport.value?.runtime || [])
const prepareSummaryTone = computed(() =>
  prepareStatusTone(
    String(prepareReadiness.value.status || currentStepDisplayState.value),
  ),
)
const prepareSummaryTiles = computed(() => [
  {
    label: 'Readiness',
    value: String(
      prepareReadiness.value.status || currentStepDisplayState.value || 'Pending',
    ),
    tone: prepareSummaryTone.value,
  },
  {
    label: 'CPU RTL',
    value: numberLabel(prepareInputs.value.cpu_rtl_files),
    tone: 'neutral',
  },
  {
    label: 'Total RTL',
    value: numberLabel(prepareInputs.value.total_rtl_files),
    tone: 'neutral',
  },
  {
    label: 'Contracts',
    value: prepareContractSummary.value,
    tone: prepareContractStatuses.value.some(
      (status) => prepareStatusTone(status) === 'error',
    )
      ? 'error'
      : 'ok',
  },
  { label: 'Includes', value: numberLabel(prepareInputs.value.incdirs), tone: 'neutral' },
  { label: 'Defines', value: numberLabel(prepareInputs.value.defines), tone: 'neutral' },
])
const prepareContractSummary = computed(() => {
  const failed = prepareContractStatuses.value.filter(
    (status) => prepareStatusTone(status) === 'error',
  ).length
  const warnings = prepareContractStatuses.value.filter(
    (status) => prepareStatusTone(status) === 'warning',
  ).length
  if (failed) return `${failed} failed`
  if (warnings) return `${warnings} warning`
  return `${prepareContractStatuses.value.length} OK`
})
const allArtifacts = computed(() => {
  const fromCases = cases.value
    .flatMap((testCase) => [
      testCase.wave ? { label: `${testCase.name} wave`, path: testCase.wave } : null,
      testCase.image ? { label: `${testCase.name} image`, path: testCase.image } : null,
      testCase.log ? { label: `${testCase.name} log`, path: testCase.log } : null,
    ])
    .filter(Boolean) as PathItem[]
  return uniquePathItems([...(detail.value?.artifacts || []), ...fromCases])
})
const reviewSourceArtifacts = computed<PathItem[]>(() => {
  const sources = reviewReport.value?.source_files || []
  return sources
    .map((source) => ({
      label: source.label || fileName(source.path),
      path: source.path,
    }))
    .filter((item) => item.path)
})
const elabReport = computed<ElabReport | null>(() => {
  const elab = detail.value?.elab
  if (!elab) return null
  if (elab.path || elab.summary || elab.modules?.length || elab.diagnostics?.length)
    return elab
  return null
})
const elabSourceArtifacts = computed<PathItem[]>(() => {
  const files = elabReport.value?.inputs?.rtl_files || []
  return files
    .map((path) => ({ label: fileName(path), path }))
    .filter((item) => item.path)
})
const lintReport = computed<LintReport | null>(() => {
  const lint = detail.value?.lint
  if (!lint) return null
  if (
    lint.path ||
    lint.summary ||
    lint.diagnostics?.length ||
    lint.rules?.length ||
    lint.files?.length
  )
    return lint
  return null
})
const lintSourceArtifacts = computed<PathItem[]>(() => {
  const files = lintReport.value?.inputs?.rtl_files || []
  return files
    .map((path) => ({ label: fileName(path), path }))
    .filter((item) => item.path)
})
const sourceArtifacts = computed(() =>
  uniquePathItems([
    ...allArtifacts.value.filter((item) => isSourceArtifactPath(item.path)),
    ...reviewSourceArtifacts.value,
    ...elabSourceArtifacts.value,
    ...lintSourceArtifacts.value,
  ]),
)
const logDiagnostics = computed(() => parseVerilatorDiagnostics(logContent.value))
const sourceDiagnosticCounts = computed(() => {
  const counts = new Map<string, DiagnosticCount>()
  for (const source of sourceArtifacts.value) {
    const next: DiagnosticCount = { errors: 0, warnings: 0, total: 0 }
    for (const diagnostic of logDiagnostics.value) {
      if (!diagnosticMatchesPath(diagnostic.file, source.path)) continue
      if (diagnostic.severity === 'error') next.errors += 1
      if (diagnostic.severity === 'warning') next.warnings += 1
      next.total += 1
    }
    for (const diagnostic of lintDiagnostics.value) {
      if (!diagnosticMatchesPath(String(diagnostic.source || ''), source.path)) continue
      if (diagnostic.severity === 'error') next.errors += 1
      if (diagnostic.severity === 'warning') next.warnings += 1
      next.total += 1
    }
    if (next.total) counts.set(source.path, next)
  }
  return counts
})
const sourceItems = computed<SourcePathItem[]>(() =>
  sourceArtifacts.value.map((item) => ({
    ...item,
    diagnostics: sourceDiagnosticCounts.value.get(item.path),
  })),
)
const availableLogs = computed(() => {
  const logs = [...(detail.value?.logs || [])]
  const selected = selectedCase.value
  if (!selected) return logs
  const caseLogs = [
    selected.log ? { label: `${selected.name} log`, path: selected.log } : null,
    selected.report_log
      ? { label: `${selected.name} report log`, path: selected.report_log }
      : null,
    selected.run_log
      ? { label: `${selected.name} run log`, path: selected.run_log }
      : null,
  ].filter(Boolean) as PathItem[]
  return uniquePathItems([...caseLogs, ...logs])
})
const readableReports = computed(() =>
  reports.value.filter((item) => isReadableReportPath(item.path)),
)
const textViewFiles = computed(() =>
  uniquePathItems([...availableLogs.value, ...readableReports.value]),
)
const hasStepLogs = computed(() => textViewFiles.value.length > 0)
const shouldShowStepTabs = computed(() => visibleTabs.value.length > 1)
const shouldShowStepConsole = computed(
  () => consoleProblemCount.value > 0 || (!consoleCollapsed.value && hasStepLogs.value),
)
const humanStepTitle = computed(() => labelForStep(currentStepName.value || 'Step'))
const humanSummaryStateTone = computed(() => {
  const state = currentStepDisplayState.value
  if (state === StateEnum.Success || state === 'Success') return 'ok'
  if (
    state === StateEnum.Imcomplete ||
    state === StateEnum.Invalid ||
    state === 'Incomplete' ||
    state === 'Invalid'
  )
    return 'error'
  if (state === StateEnum.Ongoing || state === 'Ongoing' || runBusy.value)
    return 'warning'
  return 'neutral'
})
const humanSummaryTiles = computed(() => [
  { label: 'Step', value: humanStepTitle.value, tone: 'neutral' },
  {
    label: 'Status',
    value: currentStepDisplayState.value || '--',
    tone: humanSummaryStateTone.value,
  },
  { label: 'Runtime', value: currentStepRuntime.value || '--', tone: 'neutral' },
  {
    label: 'Tool',
    value: detail.value?.tool || currentStep.value?.tool || '--',
    tone: 'neutral',
  },
  {
    label: 'Problems',
    value: numberLabel(consoleProblemCount.value),
    tone: consoleProblemCount.value ? 'warning' : 'ok',
  },
  {
    label: 'Logs',
    value: numberLabel(availableLogs.value.length),
    tone: availableLogs.value.length ? 'neutral' : 'ok',
  },
])
const humanSummaryMetrics = computed(() => {
  if (isSimStep.value) {
    return [
      { label: 'Cases', value: numberLabel(totalCases.value) },
      { label: 'Passed', value: numberLabel(passedCases.value) },
      {
        label: 'Failed',
        value: numberLabel(Math.max(0, totalCases.value - passedCases.value)),
      },
      { label: 'Suite', value: simSuiteLabel.value },
    ]
  }
  if (isElabStep.value && elabReport.value) {
    return [
      { label: 'Files', value: numberLabel(elabSummary.value.rtl_files) },
      { label: 'Modules', value: numberLabel(elabSummary.value.modules) },
      { label: 'Diagnostics', value: numberLabel(elabDiagnostics.value.length) },
      { label: 'Missing', value: numberLabel(elabUnresolvedModules.value.length) },
    ]
  }
  if (isLintStep.value && lintReport.value) {
    return [
      { label: 'Errors', value: numberLabel(lintSummary.value.errors) },
      { label: 'Warnings', value: numberLabel(lintSummary.value.warnings) },
      { label: 'Rules', value: numberLabel(lintRules.value.length) },
      { label: 'Files', value: numberLabel(lintFiles.value.length) },
    ]
  }
  if (isReviewStep.value && reviewReport.value) {
    return [
      { label: 'Issues', value: numberLabel(reviewIssues.value.length) },
      { label: 'Warnings', value: numberLabel(reviewReport.value.summary?.warnings) },
      { label: 'Sources', value: numberLabel(reviewReport.value.summary?.source_files) },
      { label: 'Modules', value: numberLabel(reviewReport.value.summary?.modules) },
    ]
  }
  if (isPrepareStep.value && prepareReport.value) {
    return [
      { label: 'CPU RTL', value: numberLabel(prepareInputs.value.cpu_rtl_files) },
      { label: 'Total RTL', value: numberLabel(prepareInputs.value.total_rtl_files) },
      { label: 'Contracts', value: prepareContractSummary.value },
      { label: 'Includes', value: numberLabel(prepareInputs.value.incdirs) },
    ]
  }
  return [
    { label: 'Logs', value: numberLabel(availableLogs.value.length) },
    { label: 'Sources', value: numberLabel(sourceArtifacts.value.length) },
    { label: 'Problems', value: numberLabel(consoleProblemCount.value) },
  ]
})
const humanSummaryText = computed(() => {
  const state = currentStepDisplayState.value
  if (isSimStep.value) return simRunSubtitle.value
  if (isElabStep.value && elabReport.value) {
    if (elabDiagnostics.value.length)
      return 'ELAB reported diagnostics. Open Elab or Problems to jump to the source line.'
    if (elabUnresolvedModules.value.length)
      return 'Slang elaboration reported unresolved module references.'
    if (elabHeuristicCandidates.value.length)
      return 'Elaboration passed; source scan also reported informational module-name candidates.'
    return 'ELAB completed the configured design universe check and generated a module inventory.'
  }
  if (isLintStep.value && lintReport.value) {
    if (lintActionableDiagnostics.value.length)
      return 'Lint found CPU or tool diagnostics. Open Lint to inspect source locations.'
    if (lintHiddenDiagnostics.value)
      return 'CPU lint is clean; infrastructure diagnostics remain available in the All view.'
    return 'Lint completed without Verilator diagnostics.'
  }
  if (isPrepareStep.value && prepareReport.value) {
    return String(
      prepareReadiness.value.message ||
        'Prepare normalized the project inputs and generated the runtime plan.',
    )
  }
  if (isReviewStep.value && reviewReport.value) return reviewNextAction.value.detail
  if (state === StateEnum.Success || state === 'Success') {
    return `${humanStepTitle.value} completed. Keep going unless Problems reports something actionable.`
  }
  if (
    state === StateEnum.Imcomplete ||
    state === StateEnum.Invalid ||
    state === 'Incomplete' ||
    state === 'Invalid'
  ) {
    return `${humanStepTitle.value} needs attention. Start from Problems; source diagnostics jump to SRC when a location is available.`
  }
  return `${humanStepTitle.value} has not produced a specialized result view yet. Run the step to generate a readable result.`
})
const humanNextAction = computed<{
  title: string
  detail: string
  label: string
  tab?: TabId
}>(() => {
  if (consoleProblemCount.value) {
    return {
      title: 'Inspect Problems',
      detail:
        'Start from the bottom Problems console; clickable diagnostics will open source when a location is available.',
      label: 'Problems',
    }
  }
  if (isElabStep.value && elabReport.value) {
    return {
      title: 'Inspect Elab',
      detail:
        'Review the module inventory and unresolved module candidates before moving to RTL Review.',
      label: 'Elab',
      tab: 'elab',
    }
  }
  if (isLintStep.value && lintReport.value) {
    return {
      title: lintActionableDiagnostics.value.length ? 'Inspect Lint' : 'CPU Lint Clean',
      detail: lintActionableDiagnostics.value.length
        ? 'Open CPU and tool diagnostics before running simulation.'
        : 'No actionable CPU lint diagnostics are reported.',
      label: 'Lint',
      tab: 'lint',
    }
  }
  if (isSimStep.value) {
    return {
      title: 'Inspect Cases',
      detail:
        'Open case results to check pass/fail status, logs, and waveforms when available.',
      label: 'Cases',
      tab: 'cases',
    }
  }
  if (hasStepLogs.value) {
    return {
      title: 'Check Log',
      detail: 'Use the bottom Log console only when the result overview is not enough.',
      label: 'Log',
    }
  }
  return {
    title: 'Run Step',
    detail: 'Run this step to generate a result overview, logs, and reports.',
    label: '',
  }
})
const reviewReport = computed<RtlReviewReport | null>(() => {
  const review = detail.value?.review
  if (!review) return null
  if (review.path || review.issues?.length || review.source_files?.length) return review
  return null
})
const reviewIssues = computed(() =>
  normalizeReviewIssues(reviewReport.value?.issues || []),
)
const reviewActionableIssues = computed(() =>
  reviewIssues.value.filter(
    (issue) => !issue.waived && (issue.ownership === 'cpu' || !issue.ownership),
  ),
)
const reviewDelta = computed(() => reviewReport.value?.delta || {})
const reviewWaivers = computed(() => reviewReport.value?.waivers || {})
const reviewResolvedIssues = computed(() =>
  normalizeReviewIssues(reviewReport.value?.resolved_issues || []),
)
const sourceScanIssues = computed(() =>
  reviewIssues.value.filter((issue) => !isYosysIssue(issue)),
)
const reviewYosysIssues = computed(() =>
  reviewIssues.value.filter((issue) => isYosysIssue(issue)),
)
const reviewStructuralProbe = computed(() => {
  const probe = reviewReport.value?.yosys_precheck || reviewReport.value?.structural_probe
  return probe && Object.keys(probe).length ? probe : null
})
const reviewStructuralMetrics = computed(() => {
  const metrics = reviewStructuralProbe.value?.metrics
  return metrics && typeof metrics === 'object'
    ? (metrics as Record<string, unknown>)
    : {}
})
const reviewStructuralQuality = computed(() => {
  const quality = reviewStructuralProbe.value?.quality
  return quality && typeof quality === 'object'
    ? (quality as Record<string, unknown>)
    : {}
})
const reviewStructuralStatus = computed(() =>
  titleCase(String(reviewStructuralProbe.value?.status || 'not run')),
)
const reviewStructuralReason = computed(() =>
  String(reviewStructuralProbe.value?.reason || '').trim(),
)
const reviewStructuralDiagnostics = computed(() => {
  const diagnostics = reviewStructuralProbe.value?.diagnostics
  return Array.isArray(diagnostics) ? diagnostics.length : 0
})
const reviewYosysDiagnostics = computed<YosysDiagnostic[]>(() => {
  const diagnostics = reviewStructuralProbe.value?.diagnostics
  return Array.isArray(diagnostics)
    ? diagnostics.filter((item): item is YosysDiagnostic =>
        Boolean(item && typeof item === 'object'),
      )
    : []
})
const reviewRiskyModules = computed<ModuleRisk[]>(() => {
  const risks = reviewStructuralProbe.value?.module_risks
  return Array.isArray(risks)
    ? risks
        .filter((item): item is ModuleRisk => Boolean(item && typeof item === 'object'))
        .slice(0, 8)
    : []
})
const reviewStructuralHotspots = computed<ReviewHotspot[]>(() => {
  const metrics = reviewStructuralMetrics.value
  const hotspots: ReviewHotspot[] = []
  for (const item of readRecordList(metrics.high_fanout_nets).slice(0, 4)) {
    hotspots.push({
      title: `High fanout · ${String(item.module || '--')}`,
      value: numberLabel(item.fanout),
      detail: `${String(item.net || 'net')} drives ${numberLabel(item.fanout)} consumers.`,
      tone: 'warning',
      source: String(item.source || ''),
      line: numberValue(item.line),
      column: numberValue(item.column) || 1,
    })
  }
  for (const item of readRecordList(metrics.high_fanin_cells).slice(0, 4)) {
    hotspots.push({
      title: `Wide fanin · ${String(item.module || '--')}`,
      value: numberLabel(item.fanin),
      detail: `${String(item.cell || 'cell')} reads ${numberLabel(item.fanin)} input bits.`,
      tone: 'warning',
      source: String(item.source || ''),
      line: numberValue(item.line),
      column: numberValue(item.column) || 1,
    })
  }
  for (const item of readRecordList(metrics.deep_comb_paths).slice(0, 4)) {
    hotspots.push({
      title: `Comb depth · ${String(item.module || '--')}`,
      value: numberLabel(item.depth),
      detail: `${String(item.endpoint || 'endpoint')} is the current deepest structural endpoint.`,
      tone: 'warning',
      source: String(item.source || ''),
      line: numberValue(item.line),
      column: numberValue(item.column) || 1,
    })
  }
  const cycles = Array.isArray(metrics.comb_cycle_modules)
    ? metrics.comb_cycle_modules.map(String).filter(Boolean)
    : []
  for (const moduleName of cycles.slice(0, 4)) {
    hotspots.push({
      title: `Comb cycle · ${moduleName}`,
      value: 'cycle',
      detail: 'The structural graph could not be fully topologically ordered.',
      tone: 'error',
    })
  }
  return hotspots.slice(0, 12)
})
const reviewModeItems = computed(() => [
  {
    id: 'source' as const,
    label: 'Source Scan',
    icon: 'ri-code-s-slash-line',
    count: sourceScanIssues.value.length,
  },
  {
    id: 'yosys' as const,
    label: 'Yosys',
    icon: 'ri-cpu-line',
    count:
      reviewYosysDiagnostics.value.length +
      reviewYosysIssues.value.length +
      reviewStructuralHotspots.value.length,
  },
  {
    id: 'modules' as const,
    label: 'Modules',
    icon: 'ri-node-tree',
    count: reviewRiskyModules.value.length,
  },
])
const reviewTopIssues = computed(() =>
  [...reviewIssues.value]
    .sort(
      (a, b) =>
        Number(Boolean(a.waived)) - Number(Boolean(b.waived)) ||
        Number(b.status === 'new') - Number(a.status === 'new'),
    )
    .slice(0, 6),
)
const reviewNextAction = computed<{
  title: string
  detail: string
  label: string
  mode: ReviewMode
}>(() => {
  if (
    reviewYosysIssues.value.some((issue) => !issue.waived) ||
    reviewYosysDiagnostics.value.length ||
    reviewStructuralHotspots.value.length
  ) {
    return {
      title: 'Inspect Yosys',
      detail:
        'Open Yosys diagnostics and hotspots first. These issues usually block or distort structural quality analysis.',
      label: 'Yosys',
      mode: 'yosys',
    }
  }
  if (sourceScanIssues.value.some((issue) => !issue.waived)) {
    return {
      title: 'Fix Source',
      detail:
        'Open source scan issues and clean the RTL coding/style risks before running simulation again.',
      label: 'Source Scan',
      mode: 'source',
    }
  }
  if (reviewRiskyModules.value.length) {
    return {
      title: 'Review Modules',
      detail:
        'Open module ranking to inspect large mux, arithmetic, memory, fanout, fanin, and depth hotspots.',
      label: 'Modules',
      mode: 'modules',
    }
  }
  return {
    title: 'Looks Clean',
    detail:
      'No Review issue is currently reported. Continue with simulation or inspect source files.',
    label: 'Source Scan',
    mode: 'source',
  }
})
const reviewStructuralQualityLabel = computed(() => {
  const gate = String(reviewStructuralQuality.value.gate || '').trim()
  const complexity = String(reviewStructuralQuality.value.complexity || '').trim()
  if (!gate && !complexity) return 'CPU RTL parsed by Yosys precheck.'
  return `Gate: ${titleCase(gate || '--')} · Complexity: ${titleCase(complexity || '--')}`
})
const reviewStructuralTone = computed(() => {
  const status = String(reviewStructuralProbe.value?.status || '').toLowerCase()
  if (status === 'success') return 'ok'
  if (status === 'unavailable' || status === 'skipped') return 'muted'
  if (status === 'failed' || status === 'timeout') return 'warning'
  return 'muted'
})
const reviewSummaryTiles = computed(() => {
  const summary = reviewReport.value?.summary || {}
  return [
    {
      label: 'Status',
      value: titleCase(String(summary.status || 'pending')),
      tone: reviewActionableIssues.value.length ? 'warning' : 'ok',
    },
    {
      label: 'Actionable',
      value: numberLabel(
        summary.actionable_issues ?? reviewActionableIssues.value.length,
      ),
      tone: reviewActionableIssues.value.length ? 'warning' : 'ok',
    },
    {
      label: 'New',
      value: numberLabel(reviewDelta.value.new),
      tone: numberValue(reviewDelta.value.new) ? 'warning' : 'ok',
    },
    {
      label: 'Existing',
      value: numberLabel(reviewDelta.value.existing),
      tone: 'neutral',
    },
    {
      label: 'Resolved',
      value: numberLabel(reviewDelta.value.resolved),
      tone: numberValue(reviewDelta.value.resolved) ? 'ok' : 'neutral',
    },
    {
      label: 'Waived',
      value: numberLabel(reviewWaivers.value.applied),
      tone: numberValue(reviewWaivers.value.applied) ? 'neutral' : 'ok',
    },
  ]
})
const elabSummary = computed(() => elabReport.value?.summary || {})
const elabReadiness = computed<ElabReadiness>(() => elabReport.value?.readiness || {})
const elabHierarchy = computed<ElabHierarchy>(() => elabReport.value?.hierarchy || {})
const elabNextAction = computed<ElabNextAction>(() => elabReport.value?.next_action || {})
const elabDiagnostics = computed<ElabDiagnostic[]>(() => {
  const diagnostics = elabReport.value?.diagnostics
  if (!Array.isArray(diagnostics)) return []
  return diagnostics
    .filter((item): item is ElabDiagnostic => Boolean(item && typeof item === 'object'))
    .map((item) => ({
      severity:
        item.severity === 'error' || item.severity === 'warning' ? item.severity : 'info',
      message: String(item.message || 'Slang diagnostic'),
      source: String(item.source || ''),
      line: numberValue(item.line),
      column: numberValue(item.column) || 1,
      ownership: String(item.ownership || 'unknown'),
    }))
})
const elabModules = computed<ElabModule[]>(() => {
  const modules = elabReport.value?.modules
  if (!Array.isArray(modules)) return []
  const top = String(elabSummary.value.top_module || elabReport.value?.top_module || '')
  return modules
    .filter((item): item is ElabModule => Boolean(item && typeof item === 'object'))
    .map((item) => ({
      module: String(item.module || ''),
      path: String(item.path || ''),
      line: numberValue(item.line) || 1,
      ports: numberValue(item.ports),
      parameters: numberValue(item.parameters),
      instances: numberValue(item.instances),
      instantiates: Array.isArray(item.instantiates)
        ? item.instantiates.map(String).filter(Boolean)
        : [],
      ownership: String(item.ownership || 'unknown'),
    }))
    .sort((a, b) => {
      if (a.module === top) return -1
      if (b.module === top) return 1
      return (
        numberValue(b.instances) - numberValue(a.instances) ||
        String(a.module).localeCompare(String(b.module))
      )
    })
})
const elabUnresolvedModules = computed(() =>
  Array.isArray(elabHierarchy.value.unresolved)
    ? elabHierarchy.value.unresolved.map(String).filter(Boolean)
    : Array.isArray(elabReport.value?.unresolved_modules)
      ? elabReport.value.unresolved_modules.map(String).filter(Boolean)
      : [],
)
const elabHeuristicCandidates = computed(() => {
  const hierarchyCandidates = elabHierarchy.value.heuristic_unresolved_candidates
  const reportCandidates = elabReport.value?.heuristic_unresolved_candidates
  const candidates = Array.isArray(hierarchyCandidates)
    ? hierarchyCandidates
    : reportCandidates
  return Array.isArray(candidates) ? candidates.map(String).filter(Boolean) : []
})
const elabAuthorityLabel = computed(() =>
  elabReport.value?.compiler?.authoritative === false
    ? 'Non-authoritative'
    : 'Slang authoritative',
)
const elabTopChildren = computed(() =>
  Array.isArray(elabHierarchy.value.top_children)
    ? elabHierarchy.value.top_children.map(String).filter(Boolean)
    : [],
)
const elabTopModuleName = computed(() =>
  String(
    elabReadiness.value.top_module ||
      elabHierarchy.value.top_module ||
      elabSummary.value.top_module ||
      elabReport.value?.top_module ||
      '--',
  ),
)
const elabStatusLabel = computed(() =>
  titleCase(
    String(
      elabReadiness.value.status ||
        elabSummary.value.status ||
        elabReport.value?.status ||
        'not run',
    ),
  ),
)
const elabTopFound = computed(() =>
  Boolean(elabReadiness.value.top_found ?? elabSummary.value.top_found),
)
const elabLargestModules = computed<ElabModule[]>(() => {
  const modules = elabHierarchy.value.largest_modules
  if (!Array.isArray(modules)) return elabModules.value.slice(0, 6)
  return modules
    .filter((item): item is ElabModule => Boolean(item && typeof item === 'object'))
    .slice(0, 6)
})
const elabSummaryTiles = computed(() => [
  {
    label: 'Readiness',
    value: elabStatusLabel.value,
    tone: prepareStatusTone(elabStatusLabel.value),
  },
  {
    label: 'Top',
    value: elabTopModuleName.value,
    tone: elabTopFound.value ? 'ok' : 'warning',
  },
  {
    label: 'RTL Files',
    value: numberLabel(
      elabReadiness.value.rtl_files ||
        elabSummary.value.rtl_files ||
        elabReport.value?.inputs?.rtl_file_count,
    ),
    tone: 'neutral',
  },
  {
    label: 'Modules',
    value: numberLabel(elabReadiness.value.modules || elabSummary.value.modules),
    tone: 'neutral',
  },
  {
    label: 'Diagnostics',
    value: numberLabel(elabDiagnostics.value.length),
    tone: elabDiagnostics.value.length ? 'warning' : 'ok',
  },
  {
    label: 'Compiler Missing',
    value: numberLabel(elabUnresolvedModules.value.length),
    tone: elabUnresolvedModules.value.length ? 'warning' : 'ok',
  },
])
const lintSummary = computed(() => lintReport.value?.summary || {})
const lintDiagnostics = computed<LintDiagnostic[]>(() => {
  const diagnostics = lintReport.value?.diagnostics
  if (!Array.isArray(diagnostics)) return []
  return diagnostics
    .filter((item): item is LintDiagnostic => Boolean(item && typeof item === 'object'))
    .map((item) => ({
      severity:
        item.severity === 'error' || item.severity === 'warning' ? item.severity : 'info',
      code: String(item.code || item.severity || 'LINT'),
      category: String(item.category || 'lint'),
      message: String(item.message || item.raw || 'Verilator lint diagnostic'),
      source: String(item.source || ''),
      line: numberValue(item.line) || 1,
      column: numberValue(item.column) || 1,
      raw: String(item.raw || ''),
      ownership: String(item.ownership || 'unknown'),
      actionable: item.actionable === true,
    }))
})
const lintActionableDiagnostics = computed(() =>
  lintDiagnostics.value.filter(
    (item) => item.ownership === 'cpu' || item.ownership === 'tool' || item.actionable,
  ),
)
const lintVisibleDiagnostics = computed(() =>
  lintScope.value === 'all' ? lintDiagnostics.value : lintActionableDiagnostics.value,
)
const lintHiddenDiagnostics = computed(() =>
  Math.max(0, lintDiagnostics.value.length - lintActionableDiagnostics.value.length),
)
const lintOwnershipRows = computed<LintOwnership[]>(() =>
  Array.isArray(lintReport.value?.ownership)
    ? lintReport.value.ownership.filter((item) => numberValue(item.total) > 0)
    : [],
)
const lintRules = computed<LintRule[]>(() => {
  const rules = lintReport.value?.rules
  if (!Array.isArray(rules)) return []
  return rules
    .filter((item): item is LintRule => Boolean(item && typeof item === 'object'))
    .map((item) => ({
      code: String(item.code || 'LINT'),
      category: String(item.category || 'lint'),
      errors: numberValue(item.errors),
      warnings: numberValue(item.warnings),
      total: numberValue(item.total),
      example: String(item.example || ''),
    }))
    .sort(
      (a, b) =>
        numberValue(b.errors) - numberValue(a.errors) ||
        numberValue(b.warnings) - numberValue(a.warnings),
    )
})
const lintFiles = computed<LintFile[]>(() => {
  const files = lintReport.value?.files
  if (!Array.isArray(files)) return []
  return files
    .filter((item): item is LintFile => Boolean(item && typeof item === 'object'))
    .map((item) => ({
      path: String(item.path || ''),
      label: String(item.label || fileName(String(item.path || ''))),
      errors: numberValue(item.errors),
      warnings: numberValue(item.warnings),
      total: numberValue(item.total),
      rules: Array.isArray(item.rules) ? item.rules.map(String).filter(Boolean) : [],
      ownership: String(item.ownership || 'unknown'),
      actionable: item.actionable === true,
    }))
    .filter((item) => item.path)
})
const lintStatusLabel = computed(() =>
  titleCase(String(lintSummary.value.status || lintReport.value?.status || 'not run')),
)
const lintSummaryTiles = computed(() => [
  {
    label: 'Status',
    value: lintStatusLabel.value,
    tone: String(lintStatusLabel.value).toLowerCase() === 'pass' ? 'ok' : 'error',
  },
  {
    label: 'CPU Errors',
    value: numberLabel(lintSummary.value.cpu_errors),
    tone: numberValue(lintSummary.value.cpu_errors) ? 'error' : 'ok',
  },
  {
    label: 'CPU Warnings',
    value: numberLabel(lintSummary.value.cpu_warnings),
    tone: numberValue(lintSummary.value.cpu_warnings) ? 'warning' : 'ok',
  },
  {
    label: 'Actionable',
    value: numberLabel(lintSummary.value.actionable_diagnostics),
    tone: lintActionableDiagnostics.value.length ? 'warning' : 'ok',
  },
  {
    label: 'Infrastructure',
    value: numberLabel(lintHiddenDiagnostics.value),
    tone: lintHiddenDiagnostics.value ? 'neutral' : 'ok',
  },
  {
    label: 'RTL Files',
    value: numberLabel(
      lintSummary.value.rtl_files || lintReport.value?.inputs?.rtl_file_count,
    ),
    tone: 'neutral',
  },
])
const reviewMetricRows = computed(() => {
  const metrics = reviewReport.value?.metrics || {}
  return [
    { label: 'Total Lines', value: numberLabel(metrics.total_lines) },
    { label: 'Always Blocks', value: numberLabel(metrics.always_blocks) },
    { label: 'Sequential', value: numberLabel(metrics.sequential_blocks) },
    { label: 'Combinational', value: numberLabel(metrics.combinational_blocks) },
    { label: 'Assigns', value: numberLabel(metrics.continuous_assigns) },
    { label: 'Case Statements', value: numberLabel(metrics.case_statements) },
    { label: 'Clock Refs', value: numberLabel(metrics.clock_references) },
    { label: 'Reset Refs', value: numberLabel(metrics.reset_references) },
  ]
})
const reviewStructuralMetricRows = computed(() => {
  const metrics = reviewStructuralMetrics.value
  return [
    { label: 'Cells', value: numberLabel(metrics.cells) },
    { label: 'Wires', value: numberLabel(metrics.wires) },
    { label: 'Mux Cells', value: numberLabel(metrics.mux_cells) },
    { label: 'Arithmetic', value: numberLabel(metrics.arithmetic_cells) },
    { label: 'Memory', value: numberLabel(metrics.memory_cells) },
    { label: 'Max Fanout', value: numberLabel(metrics.max_fanout) },
    { label: 'Max Fanin', value: numberLabel(metrics.max_fanin) },
    { label: 'Max Depth', value: numberLabel(metrics.max_comb_depth) },
  ]
})
const consoleStyle = computed(() => ({
  '--console-height': `${consoleHeight.value}px`,
}))
const consoleContext = computed(() => {
  if (isGlobalSrcView.value) return 'Source Workspace'
  if (isGlobalWaveView.value) return 'Waveform Workspace'
  if (selectedCase.value)
    return `${labelForStep(currentStepName.value)} · ${selectedCase.value.name}`
  return labelForStep(currentStepName.value || 'Workspace')
})
const consoleProblems = computed<ConsoleProblem[]>(() => {
  const problems: ConsoleProblem[] = []
  const diagnostics = logDiagnostics.value
  const diagnosticLines = new Set(diagnostics.map((diagnostic) => diagnostic.raw.trim()))
  const state = currentStepDisplayState.value
  if (state === 'Incomplete' || state === 'Invalid') {
    problems.push({
      severity: 'error',
      title: `${labelForStep(currentStepName.value)} needs attention`,
      detail: 'Open the selected log for the tool failure details.',
    })
  }
  if (simResultIsStale.value) {
    problems.push({
      severity: 'warning',
      title: 'Simulation results out of date',
      detail: `${simContextLabel(resultSimRunContext.value || currentSimRunContext.value)} is displayed, but ${simContextLabel(currentSimRunContext.value)} is selected.`,
    })
  }
  for (const issue of reviewIssues.value.filter((item) => !item.waived).slice(0, 30)) {
    problems.push(reviewIssueToProblem(issue))
  }
  for (const diagnostic of reviewYosysDiagnostics.value.slice(0, 30)) {
    problems.push(yosysDiagnosticToProblem(diagnostic))
  }
  for (const diagnostic of elabDiagnostics.value.slice(0, 30)) {
    problems.push(elabDiagnosticToProblem(diagnostic))
  }
  for (const diagnostic of lintActionableDiagnostics.value.slice(0, 30)) {
    problems.push(lintDiagnosticToProblem(diagnostic))
  }
  for (const moduleName of elabUnresolvedModules.value.slice(0, 10)) {
    problems.push({
      severity: 'warning',
      title: `ELAB · unresolved ${moduleName}`,
      detail:
        'This module is referenced by the RTL inventory but was not found in the current file universe.',
    })
  }
  for (const testCase of cases.value.filter((item) => !item.ok)) {
    problems.push({
      severity: 'error',
      title: `${testCase.name} failed`,
      detail: caseIssue(testCase) || 'Simulation case did not pass.',
      path: testCase.log || testCase.report_log || testCase.run_log,
    })
  }
  for (const line of problemLinesFromLog(logContent.value)) {
    if (diagnosticLines.has(line)) continue
    problems.push({
      severity: /warning/i.test(line) ? 'warning' : 'error',
      title: /warning/i.test(line) ? 'Log warning' : 'Log error',
      detail: line,
      path: selectedLogPath.value,
    })
  }
  for (const diagnostic of diagnostics) {
    problems.push(problemFromDiagnostic(diagnostic, selectedLogPath.value))
  }
  return uniqueProblems(problems).slice(0, 40)
})
const consoleProblemCount = computed(
  () => consoleProblems.value.filter((problem) => problem.severity !== 'info').length,
)
const visibleTabs = computed(() => {
  if (isGlobalSrcView.value) {
    return [{ id: 'src' as TabId, label: 'Src', icon: 'ri-code-s-slash-line' }]
  }
  if (isGlobalWaveView.value) {
    return [{ id: 'summary' as TabId, label: 'Wave', icon: 'ri-pulse-line' }]
  }
  const tabs: Array<{ id: TabId; label: string; icon: string }> = []
  if (isReviewStep.value)
    tabs.push({ id: 'review', label: 'Review', icon: 'ri-search-eye-line' })
  else if (isElabStep.value)
    tabs.push({ id: 'elab', label: 'Elab', icon: 'ri-node-tree' })
  else if (isLintStep.value) tabs.push({ id: 'lint', label: 'Lint', icon: 'ri-bug-line' })
  else if (isSimStep.value)
    tabs.push({ id: 'cases', label: 'Cases', icon: 'ri-list-check-3' })
  else tabs.push({ id: 'summary', label: 'Summary', icon: 'ri-dashboard-3-line' })
  return tabs
})
const surferViewerUrl = 'ecos-surfer://viewer/'
const waveStatusMessage = computed(() => {
  if (waveformError.value) return waveformError.value
  if (!activeWaveform.value) return ''
  if (!surferReady.value || waveformLoading.value)
    return 'Loading Surfer waveform viewer...'
  return ''
})

async function refresh(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const index = await getWorkspaceResourceIndexApi()
    steps.value = index.flow.steps
    if (!isHomeView.value) {
      await loadDetail()
    } else {
      detail.value = null
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
    steps.value = []
    detail.value = null
  } finally {
    loading.value = false
  }
}

async function loadDetail(): Promise<void> {
  if (!detailRequestStepName.value) return
  try {
    const directory = currentProject.value?.path || ''
    const info = await loadFrontendStepDetailApi({
      allowRpcFallback: !isFlowExecutionActiveForWorkspace(directory),
      designTool: 'frontend',
      directory,
      workspaceHandle: workspaceSession.value.workspaceId,
      step: detailRequestStepName.value,
    })
    if (!info) {
      detail.value = null
      return
    }
    detail.value = info as unknown as FrontendStepDetail
    await hydrateWaveCasesFromWorkspaceResources()
    const previousCaseName = selectedCase.value?.name || ''
    selectedCase.value =
      cases.value.find((item) => item.name === previousCaseName) || cases.value[0] || null
    syncWaveSelectionFromRoute()
    if (isGlobalSrcView.value) {
      activeTab.value = 'src'
    }
    if (isGlobalWaveView.value) {
      void loadCurrentWaveform()
    }
    if (isSimStep.value && activeTab.value === 'summary') {
      activeTab.value = 'cases'
    }
    if (isReviewStep.value && activeTab.value === 'summary') {
      activeTab.value = 'review'
    }
    if (isElabStep.value && activeTab.value === 'summary') {
      activeTab.value = 'elab'
    }
    if (isLintStep.value && activeTab.value === 'summary') {
      activeTab.value = 'lint'
    }
    ensureActiveTabVisible()
    selectedLogPath.value = preferredLogPath()
    syncDefaultCpuSelection()
    if (!activeSource.value && sourceArtifacts.value.length) {
      activeSource.value = toSourceSelection(sourceArtifacts.value[0])
    }
    await loadSelectedLog()
  } catch (err) {
    detail.value = null
    logContent.value = err instanceof Error ? err.message : String(err)
  }
}

async function loadSelectedLog(): Promise<void> {
  logContent.value = ''
  if (!selectedLogPath.value) return
  logLoading.value = true
  try {
    const content = await readOptionalProjectTextFileTail(
      selectedLogPath.value,
      300_000,
      {
        projectPath: currentProject.value?.path,
      },
    )
    logContent.value = content?.content || 'No readable log content.'
  } catch (err) {
    logContent.value = err instanceof Error ? err.message : String(err)
  } finally {
    logLoading.value = false
  }
}

async function hydrateWaveCasesFromWorkspaceResources(): Promise<void> {
  if (!isGlobalWaveView.value || detailWaveItems.value.length > 0) return

  try {
    const response = await resolveWorkspaceStepInfoApi({
      step: 'sim',
      id: InfoEnum.frontend_detail,
    })
    if (response.response !== 'available') return
    const fallbackCases = Array.isArray(response.info?.cases)
      ? (response.info.cases as SimCase[])
      : []
    if (!fallbackCases.some((testCase) => Boolean(testCase.wave)) || !detail.value) return
    detail.value = {
      ...detail.value,
      cases: fallbackCases,
    }
  } catch (err) {
    console.warn('Failed to load waveform cases from workspace resources:', err)
  }
}

async function runCurrentStep(suiteOverride?: SimSuite): Promise<void> {
  if (!currentProject.value?.path || !currentStepName.value) return
  runBusy.value = true
  runPhase.value = 'queued'
  runStartedAt.value = Date.now()
  startRunClock()
  runningSimSuite.value = isSimStep.value ? suiteOverride || simSuite.value : null
  runJobId.value = ''
  try {
    const payload = simRunPayload(suiteOverride)
    const response = await runStepApi({
      cmd: CMDEnum.run_step,
      data: {
        designTool: 'frontend',
        directory: currentProject.value.path,
        workspaceHandle: workspaceSession.value.workspaceId,
        step: currentStepName.value,
        rerun: true,
        ...payload,
      },
    })
    invalidateWorkspaceResources(['flow', 'step', 'logs'])
    runPhase.value = 'refreshing'
    await refresh()
    showToast({
      severity: response.data?.state === StateEnum.Success ? 'success' : 'error',
      summary:
        response.data?.state === StateEnum.Success ? 'Step Completed' : 'Step Failed',
      detail:
        response.data?.state === StateEnum.Success
          ? currentStepName.value
          : runFailureDetail(response.message, currentStepName.value),
      life: 4000,
    })
  } catch (err) {
    showToast({
      severity: 'error',
      summary: 'Run Failed',
      detail:
        err instanceof Error ? err.message : runFailureDetail([], currentStepName.value),
      life: 6000,
    })
  } finally {
    runBusy.value = false
    runPhase.value = 'idle'
    runStartedAt.value = 0
    stopRunClock()
    runningSimSuite.value = null
    runJobId.value = ''
  }
}

async function cancelCurrentRun(): Promise<void> {
  try {
    const response = await getDesktopApi().runtime.cancel({
      designTool: 'frontend',
      operationId: runJobId.value || undefined,
    })
    invalidateWorkspaceResources(['flow', 'step', 'logs'])
    window.setTimeout(() => {
      void refresh()
    }, 400)
    showToast({
      severity: response.cancelled ? 'warn' : 'info',
      summary: response.cancelled ? 'Run Cancelled' : 'Cancel Request',
      detail: currentStepName.value,
      life: 3500,
    })
  } catch {
    showToast({
      severity: 'error',
      summary: 'Cancel Failed',
      detail: 'Unable to stop the current runtime operation.',
      life: 5000,
    })
  }
}

function handleRuntimeEvent(event: DesignRuntimeEvent): void {
  if (event.designTool !== 'frontend') return
  if (event.type === 'runtime.exited' || !('method' in event)) return
  if (event.method !== 'flow.run_step' && event.method !== 'flow.run') return
  if (
    event.workspaceHandle &&
    event.workspaceHandle !== workspaceSession.value.workspaceId
  ) {
    return
  }
  if (runJobId.value && event.operationId !== runJobId.value) return

  if (event.type === 'operation.started') {
    runBusy.value = true
    runJobId.value = event.operationId
    runPhase.value = 'running'
    runStartedAt.value = runStartedAt.value || Date.now()
    startRunClock()
    runningSimSuite.value =
      runningSimSuite.value || (isSimStep.value ? simSuite.value : null)
    return
  }

  if (
    event.type === 'operation.completed' ||
    event.type === 'operation.failed' ||
    event.type === 'operation.cancelled'
  ) {
    runBusy.value = false
    runPhase.value = 'idle'
    runStartedAt.value = 0
    stopRunClock()
    runningSimSuite.value = null
    runJobId.value = ''
    invalidateWorkspaceResources(['flow', 'step', 'logs'])
    void refresh()
  }
}

function normalizeWorkspacePath(path: string): string {
  const normalized = path.trim().replace(/\\/g, '/')
  return normalized.length > 1 && normalized.endsWith('/')
    ? normalized.slice(0, -1)
    : normalized
}

function simRunPayload(suiteOverride?: SimSuite) {
  if (!isSimStep.value) return {}
  const suite = suiteOverride || simSuite.value
  if (suite === 'coremark') {
    return {
      sim_test_suite: 'coremark',
      sim_compile_preset: coremarkCompilePreset.value,
      sim_compile_opt_level: coremarkOptLevel.value,
      sim_compile_march: coremarkMarch.value,
      sim_compile_mabi: coremarkMabi.value,
      sim_compile_extra_cflags: splitCompileFlags(coremarkExtraCflags.value),
      sim_coremark_iterations: String(
        Math.max(1, Number(coremarkIterations.value) || 128),
      ),
      sim_coremark_total_data_size: String(
        Math.max(1, Number(coremarkTotalDataSize.value) || 2000),
      ),
      sim_coremark_has_float: coremarkHasFloat.value ? 'true' : 'false',
    }
  }
  return {
    sim_test_suite: 'cpu_tests',
    sim_cpu_test_mode: simCpuMode.value,
    sim_cpu_test_cases: simCpuMode.value === 'selected' ? selectedCpuRunCases.value : [],
  }
}

function cpuRunCasesForSelection(): string[] {
  if (simCpuMode.value === 'all') return []
  if (selectedCpuCases.value.length) return selectedCpuCases.value
  if (defaultCpuTests.value.length) return defaultCpuTests.value
  return availableCpuTests.value.slice(0, 1)
}

function resultContextFromDetail(): SimRunContext | null {
  if (!isSimStep.value || !cases.value.length) return null
  const resultSuite = String(
    detail.value?.summary?.suite_id || detail.value?.summary?.test_suite || '',
  )
  const caseNames = resultCaseNames()
  const suite: SimRunContext['suite'] =
    resultSuite === 'coremark' ||
    resultSuite === 'CoreMark' ||
    caseNames.includes('coremark.soc')
      ? 'coremark'
      : 'cpu_tests'
  if (suite === 'coremark') {
    return { suite, mode: 'selected', cases: ['coremark.soc'] }
  }
  const mode =
    String(detail.value?.summary?.cpu_test_mode || '') === 'all' ? 'all' : 'selected'
  return {
    suite,
    mode,
    cases: mode === 'all' ? [] : resultCaseNames(),
  }
}

function simResultFreshnessText(): {
  state: 'empty' | 'fresh' | 'stale' | 'running'
  message: string
} {
  if (!isSimStep.value) return { state: 'empty', message: 'No simulation context' }
  if (runBusy.value)
    return { state: 'running', message: `Running ${runningSimSuiteLabel.value}` }
  const result = resultSimRunContext.value
  if (!result) return { state: 'empty', message: 'No result yet' }
  if (simContextsEqual(currentSimRunContext.value, result)) {
    return { state: 'fresh', message: 'Matches current selection' }
  }
  return { state: 'stale', message: 'Results out of date' }
}

function splitCompileFlags(value: string): string[] {
  return value
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function resultCaseNames(): string[] {
  return cases.value.map((testCase) => testCase.name).filter(Boolean)
}

function simContextLabel(context: SimRunContext): string {
  if (context.suite === 'coremark') return 'CoreMark'
  if (context.mode === 'all') return 'CPU Tests · All'
  return `CPU Tests · ${context.cases.length ? context.cases.join(', ') : 'Selected'}`
}

function simCasesForSuite(suite: SimSuite): string[] {
  if (suite === 'coremark') return ['coremark.soc']
  return selectedCpuRunCases.value
}

function syncDefaultCpuSelection(): void {
  if (!isSimStep.value || selectedCpuCases.value.length) return
  const defaults = defaultCpuTests.value.length
    ? defaultCpuTests.value
    : availableCpuTests.value.slice(0, 1)
  selectedCpuCases.value = defaults
}

function syncWaveSelectionFromRoute(): void {
  if (!isGlobalWaveView.value) return
  const requestedPath = firstQueryValue(route.query.path).trim()
  const requestedCase = firstQueryValue(route.query.case).trim()
  const matched = requestedPath
    ? waveItems.value.find(
        (item) =>
          normalizeWorkspacePath(item.path) === normalizeWorkspacePath(requestedPath),
      )
    : null
  const next =
    matched ||
    (requestedPath
      ? { path: requestedPath, caseName: requestedCase || fileName(requestedPath) }
      : null) ||
    activeWaveform.value ||
    waveItems.value[0] ||
    null
  const previousPath = activeWaveform.value?.path || ''
  activeWaveform.value = next ? { path: next.path, caseName: next.caseName } : null
  if (
    previousPath &&
    activeWaveform.value?.path &&
    normalizeWorkspacePath(previousPath) !==
      normalizeWorkspacePath(activeWaveform.value.path)
  ) {
    loadedWaveformKey = ''
  }
  waveformError.value = ''
}

function firstQueryValue(value: unknown): string {
  if (Array.isArray(value)) return String(value[0] || '')
  return String(value || '')
}

function uniqueWaveItems(items: WaveSelection[]): WaveSelection[] {
  const seen = new Set<string>()
  const result: WaveSelection[] = []
  for (const item of items) {
    const path = String(item.path || '').trim()
    if (!path || seen.has(path)) continue
    seen.add(path)
    result.push({ path, caseName: item.caseName })
  }
  return result
}

function isWaveformPath(path: string): boolean {
  return /\.(vcd|fst|ghw)$/i.test(String(path || '').trim())
}

function caseNameForWaveArtifact(item: PathItem): string {
  const rawLabel = String(item.label || '').trim()
  const waveLabel = rawLabel.replace(/\s+wave(form)?$/i, '')
  if (waveLabel && waveLabel !== rawLabel) return waveLabel

  const normalized = normalizeWorkspacePath(item.path)
  const caseMatch = normalized.match(/\/cases\/([^/]+)\/[^/]+$/)
  if (caseMatch?.[1]) return caseMatch[1]
  return rawLabel || fileName(item.path)
}

function toggleCpuCase(name: string): void {
  if (runBusy.value) return
  selectedCpuCases.value = selectedCpuCases.value.includes(name)
    ? selectedCpuCases.value.filter((item) => item !== name)
    : [...selectedCpuCases.value, name]
}

function simSuiteLabelFor(suite: SimSuite): string {
  return simSuites.find((item) => item.id === suite)?.label || 'CPU Tests'
}

function displayCatalogId(value: string): string {
  if (!value) return '--'
  return value
    .split('-')
    .filter(Boolean)
    .map((part) =>
      part.toUpperCase() === part ? part : part.charAt(0).toUpperCase() + part.slice(1),
    )
    .join(' ')
}

function preferredLogPath(): string {
  if (isSimStep.value && detail.value?.state !== StateEnum.Success) {
    const preferred =
      textViewFiles.value.find((log) => log.label === 'Build programs log') ||
      textViewFiles.value.find((log) => log.label === 'Tool log')
    if (preferred) return preferred.path
  }
  return textViewFiles.value[0]?.path || ''
}

function runFailureDetail(messages: string[] | undefined, step: string): string {
  const lines = (messages || []).map((line) => line.trim()).filter(Boolean)
  if (!lines.length) {
    return step ? `${step} failed. Open Log for details.` : 'Open Log for details.'
  }
  return lines.slice(-4).join('\n')
}

function caseIssue(testCase: SimCase): string {
  if (testCase.failure?.first_error) return testCase.failure.first_error
  if (testCase.failure?.message) return testCase.failure.message
  const missing = testCase.validation?.missing_markers || []
  if (missing.length) {
    return `Missing markers: ${missing.join(', ')}`
  }
  if (!testCase.ok && testCase.returncode && testCase.returncode !== 0) {
    return `Return code ${testCase.returncode}`
  }
  return ''
}

function caseCycles(testCase: SimCase): string {
  const cycles = testCase.metrics?.cycles
  return typeof cycles === 'number' ? cycles.toLocaleString() : '-'
}

function caseTermination(testCase: SimCase): string {
  return titleCase(String(testCase.metrics?.termination || 'unknown').replace(/_/g, ' '))
}

function caseDifftestStatus(testCase: SimCase): string {
  return titleCase(
    String(testCase.metrics?.difftest?.status || 'disabled').replace(/_/g, ' '),
  )
}

function caseDifftestPc(testCase: SimCase): string {
  const difftest = testCase.metrics?.difftest
  return String(
    difftest?.first_mismatch?.pc || difftest?.last_pc || difftest?.last_npc || '',
  )
}

function signedNumber(value: unknown): string {
  const numeric = numberValue(value)
  return numeric > 0 ? `+${numeric}` : String(numeric)
}

function selectCase(testCase: SimCase): void {
  activateCase(testCase)
}

function activateCase(testCase: SimCase): void {
  selectedCase.value = testCase
  selectedLogPath.value =
    testCase.log ||
    testCase.report_log ||
    testCase.run_log ||
    availableLogs.value[0]?.path ||
    ''
  void loadSelectedLog()
}

function toggleDisassembly(testCase: SimCase): void {
  const isActiveCase = selectedCase.value?.name === testCase.name
  if (disassemblyPanelOpen.value && isActiveCase) {
    closeDisassembly()
    return
  }
  openDisassembly(testCase)
}

function openDisassembly(testCase: SimCase, address = ''): void {
  if (!testCase.program?.disassembly) return
  activateCase(testCase)
  disassemblyPanelOpen.value = true
  disassemblyTarget.value = {
    address,
    token: disassemblyTarget.value.token + 1,
  }
}

function closeDisassembly(): void {
  disassemblyPanelOpen.value = false
  disassemblyTarget.value = {
    address: '',
    token: disassemblyTarget.value.token + 1,
  }
}

function openStepLog(): void {
  consoleTab.value = 'log'
  consoleCollapsed.value = false
  if (!selectedLogPath.value) {
    selectedLogPath.value = preferredLogPath()
  }
  void loadSelectedLog()
}

function normalizeArtifactLabel(item: PathItem): string {
  const label = String(item.label || '').trim()
  if (!label) return fileName(item.path)
  return label.replace(/^CPU RTL · /, '')
}

function isReadableReportPath(path: string): boolean {
  return /\.(log|txt|rpt|md|csv|html?)$/i.test(path)
}

async function openSource(item: PathItem): Promise<void> {
  activeSource.value = toSourceSelection(item)
  await openGlobalSrcView()
}

function toSourceSelection(item: PathItem): FrontendSourceSelection {
  return {
    label: sourceDisplayName(item),
    path: item.path,
  }
}

async function openWaveform(path: string, caseName?: string): Promise<void> {
  if (
    normalizeWorkspacePath(activeWaveform.value?.path || '') !==
    normalizeWorkspacePath(path)
  ) {
    loadedWaveformKey = ''
  }
  activeWaveform.value = { path, caseName }
  waveformError.value = ''
  await openGlobalWaveView(path, caseName)
}

async function selectWaveform(item: WaveSelection): Promise<void> {
  if (
    normalizeWorkspacePath(activeWaveform.value?.path || '') !==
    normalizeWorkspacePath(item.path)
  ) {
    loadedWaveformKey = ''
  }
  activeWaveform.value = { path: item.path, caseName: item.caseName }
  waveformError.value = ''
  await router.replace({
    path: '/workspace/wave',
    query: waveRouteQuery(item.path, item.caseName),
  })
  void loadCurrentWaveform()
}

async function openGlobalWaveView(path?: string, caseName?: string): Promise<void> {
  const query = path ? waveRouteQuery(path, caseName) : route.query
  if (!isGlobalWaveView.value) {
    await router.push({ path: '/workspace/wave', query })
  } else if (path) {
    await router.replace({ path: '/workspace/wave', query })
  }
  activeTab.value = 'summary'
}

function waveRouteQuery(path: string, caseName?: string): Record<string, string> {
  return {
    path,
    ...(caseName ? { case: caseName } : {}),
  }
}

async function openWaveExternal(path: string): Promise<void> {
  try {
    await getDesktopApi().system.openExternal(pathToFileUrl(path))
  } catch {
    showToast({
      severity: 'error',
      summary: 'Open Waveform Failed',
      detail: 'Unable to open waveform in external viewer.',
      life: 5000,
    })
  }
}

function pathToFileUrl(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`
  return `file://${normalized.split('/').map(encodeURIComponent).join('/')}`
}

function handleSurferFrameChange(frame: HTMLIFrameElement | null): void {
  if (surferFrame.value === frame) return
  surferFrame.value = frame
  surferReady.value = false
  waveformLoading.value = false
  waveformError.value = ''
  loadedWaveformKey = ''
  waveformLoadToken += 1
  if (frame) {
    requestSurferReady(frame)
    void loadCurrentWaveform()
  }
}

function handleSurferFrameLoad(): void {
  loadedWaveformKey = ''
  waveformError.value = ''
  requestSurferReady(surferFrame.value)
  void loadCurrentWaveform()
}

function handleSurferMessage(event: MessageEvent): void {
  if (event.source !== surferFrame.value?.contentWindow) return
  const data = event.data as {
    source?: string
    command?: string
    loadId?: string
    message?: string
  }
  if (data?.source !== 'ecos-surfer') return

  if (data.command === 'SurferReady') {
    surferReady.value = true
    void loadCurrentWaveform()
    return
  }

  if (data.command === 'SurferWaveformLoaded') {
    const activeWaveKey = normalizeWorkspacePath(activeWaveform.value?.path || '')
    if (!data.loadId || data.loadId !== activeWaveKey) return
    loadedWaveformKey = activeWaveKey
    waveformLoading.value = false
    waveformError.value = ''
    return
  }

  if (data.command === 'SurferError') {
    const activeWaveKey = normalizeWorkspacePath(activeWaveform.value?.path || '')
    if (data.loadId && data.loadId !== activeWaveKey) return
    waveformLoading.value = false
    loadedWaveformKey = ''
    waveformError.value = data.message || 'Surfer viewer failed to initialize.'
  }
}

async function loadCurrentWaveform(): Promise<void> {
  const wave = activeWaveform.value
  const frame = surferFrame.value
  if (!wave || !frame?.contentWindow) return
  const waveKey = normalizeWorkspacePath(wave.path)
  if (surferReady.value && loadedWaveformKey === waveKey) return

  const token = ++waveformLoadToken
  waveformLoading.value = true
  waveformError.value = ''

  if (!surferReady.value) {
    const pingSurferUntilReady = () => {
      if (token !== waveformLoadToken || surferReady.value) return
      requestSurferReady(frame)
      window.setTimeout(pingSurferUntilReady, 500)
    }
    pingSurferUntilReady()
    window.setTimeout(() => {
      if (token === waveformLoadToken && !surferReady.value) {
        waveformLoading.value = false
        waveformError.value =
          'Surfer viewer is not ready. Install the Surfer resource in Resource Manager and reload Wave.'
      }
    }, 12000)
    return
  }

  try {
    const waveformUrl = surferWaveformUrl(wave.path)
    const response = await fetch(waveformUrl, { method: 'HEAD' })
    if (token !== waveformLoadToken) return
    if (!response.ok) {
      throw new Error(`Cannot load waveform: ${response.status} ${response.statusText}`)
    }
    frame.contentWindow.postMessage(
      {
        command: 'LoadUrl',
        initialScope: 'ecos_sim_top',
        loadId: waveKey,
        name: fileName(wave.path),
        url: waveformUrl,
      },
      '*',
    )
  } catch (err) {
    if (token === waveformLoadToken) {
      loadedWaveformKey = ''
      waveformLoading.value = false
      waveformError.value = err instanceof Error ? err.message : String(err)
    }
  }
}

function surferWaveformUrl(path: string): string {
  const name = encodeURIComponent(fileName(path))
  return `ecos-surfer://viewer/waveform/${name}?path=${encodeURIComponent(path)}`
}

function requestSurferReady(frame: HTMLIFrameElement | null): void {
  frame?.contentWindow?.postMessage({ command: 'Ping' }, '*')
}

function labelForStep(step: string): string {
  return getStepMetadata(step)?.label || step
}

function stateClass(state: string): string {
  if (state === 'Success') return 'success'
  if (
    state === 'Ongoing' ||
    state === 'Queued' ||
    state === 'Running' ||
    state === 'Refreshing'
  )
    return 'running'
  if (state === 'Incomplete' || state === 'Invalid') return 'failed'
  return 'pending'
}

function runPhaseDisplayLabel(phase: RunPhase): string {
  if (phase === 'queued') return 'Queued'
  if (phase === 'refreshing') return 'Refreshing'
  if (phase === 'running') return 'Running'
  return 'Idle'
}

function runElapsedLabel(): string {
  void runClockTick.value
  if (!runStartedAt.value) return runPhaseDisplayLabel(runPhase.value)
  const seconds = Math.max(0, Math.floor((Date.now() - runStartedAt.value) / 1000))
  return `${runPhaseDisplayLabel(runPhase.value)} · ${seconds}s`
}

function startRunClock(): void {
  if (runClockTimer) return
  runClockTimer = window.setInterval(() => {
    runClockTick.value += 1
  }, 1000)
}

function stopRunClock(): void {
  if (!runClockTimer) return
  window.clearInterval(runClockTimer)
  runClockTimer = null
}

function fileName(path: string): string {
  return path.split('/').filter(Boolean).pop() || path
}

function shortPath(path: string): string {
  return path.split('/').filter(Boolean).slice(-4).join('/')
}

function sourceDisplayName(item: PathItem): string {
  return normalizeArtifactLabel(item)
}

function sourceDiagnosticLabel(count: DiagnosticCount): string {
  const parts: string[] = []
  if (count.errors) parts.push(`${count.errors}E`)
  if (count.warnings) parts.push(`${count.warnings}W`)
  return parts.join(' ')
}

function fileIcon(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase()
  if (ext === 'json') return 'ri-braces-line'
  if (ext === 'vcd' || ext === 'fst' || ext === 'ghw') return 'ri-pulse-line'
  if (ext === 'bin' || ext === 'elf') return 'ri-cpu-line'
  if (ext === 'v' || ext === 'sv' || ext === 'vh' || ext === 'svh')
    return 'ri-code-s-slash-line'
  if (ext === 'f' || ext === 'fl' || ext === 'filelist') return 'ri-file-list-3-line'
  if (ext === 'rpt') return 'ri-file-chart-line'
  return 'ri-file-text-line'
}

function isSourceArtifactPath(path: string): boolean {
  return /\.(v|sv|vh|svh|c|cc|cpp|h|hpp|f|fl|filelist|py|sh|tcl|s|asm)$/i.test(path)
}

function problemLinesFromLog(content: string): string[] {
  const pattern =
    /(%Error|%Warning|fatal error|error:|warning:|failed|failure|timeout|bad trap|not found|missing image|cannot load)/i
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && pattern.test(line))
    .slice(-20)
}

function uniqueProblems(items: ConsoleProblem[]): ConsoleProblem[] {
  const seen = new Set<string>()
  const result: ConsoleProblem[] = []
  for (const item of items) {
    const key = problemKey(item)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(item)
  }
  return result
}

function problemKey(problem: ConsoleProblem): string {
  return [
    problem.severity,
    problem.title,
    problem.detail,
    problem.path || '',
    problem.sourcePath || '',
    problem.line || '',
    problem.column || '',
  ].join(':')
}

function problemIcon(severity: ConsoleProblem['severity']): string {
  if (severity === 'warning') return 'ri-alert-line'
  if (severity === 'info') return 'ri-information-line'
  return 'ri-close-circle-line'
}

function problemTooltip(problem: ConsoleProblem): string {
  const location = problem.sourcePath
    ? `${problem.sourcePath}:${problem.line || 1}:${problem.column || 1}`
    : problem.path || ''
  return [problem.title, location, problem.detail].filter(Boolean).join('\n')
}

function openProblem(problem: ConsoleProblem): void {
  consoleCollapsed.value = false
  if (problem.title === 'Simulation results out of date') {
    activeTab.value = 'cases'
    return
  }
  if (problem.sourcePath) {
    openSourceAt(problem.sourcePath, problem.line || 1, problem.column || 1)
    return
  }
  consoleTab.value = 'log'
  if (problem.path) {
    selectedLogPath.value = problem.path
    void loadSelectedLog()
  }
}

function normalizeReviewIssues(items: RtlReviewIssue[]): RtlReviewIssue[] {
  return items
    .filter((item) => item && item.title)
    .map((item) => ({
      severity:
        item.severity === 'error' || item.severity === 'warning' ? item.severity : 'info',
      category: String(item.category || 'review'),
      title: String(item.title || 'RTL review issue'),
      detail: String(item.detail || ''),
      source: reviewIssueSource(item),
      line: reviewIssueLine(item),
      column: reviewIssueColumn(item),
      evidence: item.evidence || {},
      recommendation: String(item.recommendation || ''),
      fingerprint: String(item.fingerprint || ''),
      confidence: String(item.confidence || ''),
      origin: String(item.origin || ''),
      ownership: String(item.ownership || ''),
      status: String(item.status || ''),
      waived: item.waived === true,
      waiver: item.waiver || {},
    }))
}

function reviewIssueMeta(issue: RtlReviewIssue): string {
  return [
    titleCase(issue.category),
    issue.confidence ? `${titleCase(issue.confidence)} confidence` : '',
    issue.status ? titleCase(issue.status) : '',
    issue.waived ? 'Waived' : '',
  ]
    .filter(Boolean)
    .join(' · ')
}

function reviewIssueToProblem(issue: RtlReviewIssue): ConsoleProblem {
  const source = reviewIssueSource(issue)
  return {
    severity: issue.severity,
    title: `RTL Review · ${issue.title}`,
    detail: issue.recommendation || issue.detail,
    sourcePath: source ? resolveDiagnosticSourcePath(source) : '',
    line: reviewIssueLine(issue) || 1,
    column: reviewIssueColumn(issue) || 1,
  }
}

function isYosysIssue(issue: RtlReviewIssue): boolean {
  const category = String(issue.category || '').toLowerCase()
  const text = `${issue.title} ${issue.detail}`
  return (
    /yosys|precheck|high fanout net candidate|wide fanin cell candidate|deep combinational path candidate|combinational cycle candidate/i.test(
      text,
    ) ||
    category === 'syntax' ||
    category === 'hierarchy' ||
    category === 'fanout' ||
    category === 'fanin' ||
    (category === 'timing' && /fanout|fanin|yosys|structural/i.test(text)) ||
    (category === 'combinational' && /yosys|structural graph|cycle/i.test(text)) ||
    (category === 'structural' && !issue.source)
  )
}

function yosysDiagnosticToProblem(diagnostic: YosysDiagnostic): ConsoleProblem {
  const severity =
    diagnostic.severity === 'error' || diagnostic.severity === 'warning'
      ? diagnostic.severity
      : 'info'
  const message = String(diagnostic.message || 'Yosys diagnostic')
  const resolvedSource = resolveDiagnosticSourcePath(yosysDiagnosticSource(diagnostic))
  return {
    severity,
    title: `Yosys Precheck · ${titleCase(String(diagnostic.category || 'diagnostic'))}`,
    detail: message,
    sourcePath: resolvedSource,
    line: yosysDiagnosticLine(diagnostic),
    column: yosysDiagnosticColumn(diagnostic),
  }
}

function elabDiagnosticToProblem(diagnostic: ElabDiagnostic): ConsoleProblem {
  const severity =
    diagnostic.severity === 'error' || diagnostic.severity === 'warning'
      ? diagnostic.severity
      : 'info'
  const source = resolveDiagnosticSourcePath(String(diagnostic.source || ''))
  return {
    severity,
    title: `ELAB · ${titleCase(severity)}`,
    detail: String(diagnostic.message || 'Slang diagnostic'),
    sourcePath: source,
    line: numberValue(diagnostic.line) || 1,
    column: numberValue(diagnostic.column) || 1,
  }
}

function lintDiagnosticToProblem(diagnostic: LintDiagnostic): ConsoleProblem {
  const severity =
    diagnostic.severity === 'error' || diagnostic.severity === 'warning'
      ? diagnostic.severity
      : 'info'
  const source = resolveDiagnosticSourcePath(String(diagnostic.source || ''))
  return {
    severity,
    title: `Lint · ${String(diagnostic.code || titleCase(String(diagnostic.category || 'diagnostic')))}`,
    detail: String(diagnostic.message || diagnostic.raw || 'Verilator lint diagnostic'),
    sourcePath: source,
    line: numberValue(diagnostic.line) || 1,
    column: numberValue(diagnostic.column) || 1,
  }
}

function openYosysDiagnostic(diagnostic: YosysDiagnostic): void {
  const source = resolveDiagnosticSourcePath(yosysDiagnosticSource(diagnostic))
  if (source) {
    openSourceAt(
      source,
      yosysDiagnosticLine(diagnostic),
      yosysDiagnosticColumn(diagnostic),
    )
    return
  }
  consoleTab.value = 'problems'
  consoleCollapsed.value = false
}

function yosysDiagnosticKey(diagnostic: YosysDiagnostic): string {
  return [
    diagnostic.severity || '',
    diagnostic.category || '',
    diagnostic.source || '',
    diagnostic.line || '',
    diagnostic.column || '',
    diagnostic.message || '',
  ].join(':')
}

function elabDiagnosticKey(diagnostic: ElabDiagnostic): string {
  return [
    diagnostic.severity || '',
    diagnostic.source || '',
    diagnostic.line || '',
    diagnostic.column || '',
    diagnostic.message || '',
  ].join(':')
}

function lintDiagnosticKey(diagnostic: LintDiagnostic): string {
  return [
    diagnostic.severity || '',
    diagnostic.code || '',
    diagnostic.source || '',
    diagnostic.line || '',
    diagnostic.column || '',
    diagnostic.message || '',
  ].join(':')
}

function reviewIssueKey(issue: RtlReviewIssue): string {
  return [
    issue.severity,
    issue.category,
    issue.title,
    reviewIssueSource(issue),
    reviewIssueLine(issue),
  ].join(':')
}

function moduleRiskReason(module: ModuleRisk): string {
  const reasons = Array.isArray(module.reasons) ? module.reasons.filter(Boolean) : []
  if (reasons.length) return reasons.slice(0, 2).join(' · ')
  const cells = numberLabel(module.cells)
  const wires = numberLabel(module.wires)
  return `cells ${cells} · wires ${wires}`
}

function reviewEvidenceLabel(issue: RtlReviewIssue): string {
  const evidence = issue.evidence || {}
  const parts = [
    evidence.module ? `module ${evidence.module}` : '',
    evidence.net ? `net ${evidence.net}` : '',
    evidence.cell ? `cell ${evidence.cell}` : '',
    evidence.endpoint ? `endpoint ${evidence.endpoint}` : '',
    evidence.fanout ? `fanout ${evidence.fanout}` : '',
    evidence.fanin ? `fanin ${evidence.fanin}` : '',
    evidence.depth ? `depth ${evidence.depth}` : '',
  ].filter(Boolean)
  return parts.join(' · ')
}

function hotspotKey(hotspot: ReviewHotspot): string {
  return [
    hotspot.title,
    hotspot.value,
    hotspot.detail,
    hotspot.source || '',
    hotspot.line || '',
  ].join(':')
}

function openReviewMode(mode: ReviewMode): void {
  reviewMode.value = mode
  activeTab.value = 'review'
}

function openConsoleTab(tab: ConsoleTabId): void {
  consoleTab.value = tab
  consoleCollapsed.value = false
}

function openReviewHotspot(hotspot: ReviewHotspot): void {
  const source = resolveDiagnosticSourcePath(hotspot.source || '')
  if (source) {
    openSourceAt(source, hotspot.line || 1, hotspot.column || 1)
    return
  }
  consoleTab.value = 'problems'
  consoleCollapsed.value = false
}

function titleCase(value: string): string {
  return (
    value
      .split(/[_\s-]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ') || '--'
  )
}

function openReviewIssue(issue: RtlReviewIssue): void {
  const source = resolveDiagnosticSourcePath(reviewIssueSource(issue))
  if (source) {
    openSourceAt(source, reviewIssueLine(issue) || 1, reviewIssueColumn(issue) || 1)
    return
  }
  consoleTab.value = 'problems'
  consoleCollapsed.value = false
}

function reviewIssueLocationLabel(issue: RtlReviewIssue): string {
  const source = resolveDiagnosticSourcePath(reviewIssueSource(issue))
  const line = reviewIssueLine(issue)
  return `${shortPath(source || reviewIssueSource(issue))}${line ? `:${line}` : ''}`
}

function yosysDiagnosticLocationLabel(diagnostic: YosysDiagnostic): string {
  const source = resolveDiagnosticSourcePath(yosysDiagnosticSource(diagnostic))
  const line = yosysDiagnosticLine(diagnostic)
  return `${shortPath(source || yosysDiagnosticSource(diagnostic))}${line ? `:${line}` : ''}`
}

function elabDiagnosticLocationLabel(diagnostic: ElabDiagnostic): string {
  const source = resolveDiagnosticSourcePath(String(diagnostic.source || ''))
  const line = numberValue(diagnostic.line)
  return `${shortPath(source || diagnostic.source || '')}${line ? `:${line}` : ''}`
}

function lintDiagnosticLocationLabel(diagnostic: LintDiagnostic): string {
  const source = resolveDiagnosticSourcePath(String(diagnostic.source || ''))
  const line = numberValue(diagnostic.line)
  return `${shortPath(source || diagnostic.source || '')}${line ? `:${line}` : ''}`
}

function openElabDiagnostic(diagnostic: ElabDiagnostic): void {
  const source = resolveDiagnosticSourcePath(String(diagnostic.source || ''))
  if (source) {
    openSourceAt(
      source,
      numberValue(diagnostic.line) || 1,
      numberValue(diagnostic.column) || 1,
    )
    return
  }
  consoleTab.value = 'problems'
  consoleCollapsed.value = false
}

function openElabModule(moduleItem: ElabModule): void {
  const source = resolveDiagnosticSourcePath(String(moduleItem.path || ''))
  if (source) {
    openSourceAt(source, numberValue(moduleItem.line) || 1, 1)
    return
  }
  void openGlobalSrcView()
}

function openLintDiagnostic(diagnostic: LintDiagnostic): void {
  const source = resolveDiagnosticSourcePath(String(diagnostic.source || ''))
  if (source) {
    openSourceAt(
      source,
      numberValue(diagnostic.line) || 1,
      numberValue(diagnostic.column) || 1,
    )
    return
  }
  consoleTab.value = 'problems'
  consoleCollapsed.value = false
}

function reviewIssueSource(issue: Partial<RtlReviewIssue>): string {
  const evidence = issue.evidence || {}
  return firstText(
    issue.source,
    evidence.source,
    evidence.src,
    evidence.path,
    sourceFromText(issue.detail),
    sourceFromText(issue.recommendation),
  )
}

function reviewIssueLine(issue: Partial<RtlReviewIssue>): number {
  const evidence = issue.evidence || {}
  return (
    firstPositiveNumber(
      issue.line,
      evidence.line,
      lineFromText(issue.detail),
      lineFromText(issue.recommendation),
    ) || 1
  )
}

function reviewIssueColumn(issue: Partial<RtlReviewIssue>): number {
  const evidence = issue.evidence || {}
  return (
    firstPositiveNumber(
      issue.column,
      evidence.column,
      columnFromText(issue.detail),
      columnFromText(issue.recommendation),
    ) || 1
  )
}

function yosysDiagnosticSource(diagnostic: YosysDiagnostic): string {
  return firstText(diagnostic.source, sourceFromText(diagnostic.message))
}

function yosysDiagnosticLine(diagnostic: YosysDiagnostic): number {
  return firstPositiveNumber(diagnostic.line, lineFromText(diagnostic.message)) || 1
}

function yosysDiagnosticColumn(diagnostic: YosysDiagnostic): number {
  return firstPositiveNumber(diagnostic.column, columnFromText(diagnostic.message)) || 1
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const text = String(value || '').trim()
    if (text) return text
  }
  return ''
}

function firstPositiveNumber(...values: unknown[]): number {
  for (const value of values) {
    const next = Number(value)
    if (Number.isFinite(next) && next > 0) return Math.floor(next)
  }
  return 0
}

function sourceFromText(text: unknown): string {
  return parseSourceLocation(text).source
}

function lineFromText(text: unknown): number {
  return parseSourceLocation(text).line
}

function columnFromText(text: unknown): number {
  return parseSourceLocation(text).column
}

function parseSourceLocation(text: unknown): {
  source: string
  line: number
  column: number
} {
  const value = String(text || '')
  if (!value) return { source: '', line: 0, column: 0 }
  const match = value.match(
    /(?<source>(?:\/|\.{1,2}\/)?[^\s:'"]+?\.(?:sv|svh|v|vh)):(?<line>\d+)(?::(?<column>\d+)|\.(?<dotColumn>\d+))?/i,
  )
  if (!match?.groups) return { source: '', line: 0, column: 0 }
  return {
    source: match.groups.source || '',
    line: numberValue(match.groups.line),
    column: numberValue(match.groups.column || match.groups.dotColumn) || 1,
  }
}

function numberValue(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function numberLabel(value: unknown): string {
  return `${numberValue(value)}`
}

function prepareStatusTone(status: unknown): 'ok' | 'warning' | 'error' | 'neutral' {
  const value = String(status || '').toLowerCase()
  if (['ready', 'success', 'ok', 'enabled', 'pass', 'module_only'].includes(value))
    return 'ok'
  if (['failed', 'error', 'missing', 'invalid'].includes(value)) return 'error'
  if (['warning', 'stub', 'disabled', 'pending'].includes(value)) return 'warning'
  return 'neutral'
}

function prepareStatusIcon(status: unknown): string {
  const tone = prepareStatusTone(status)
  if (tone === 'ok') return 'ri-checkbox-circle-line'
  if (tone === 'error') return 'ri-close-circle-line'
  if (tone === 'warning') return 'ri-error-warning-line'
  return 'ri-information-line'
}

function readRecordList(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> =>
        Boolean(item && typeof item === 'object'),
      )
    : []
}

function problemFromDiagnostic(
  diagnostic: VerilatorDiagnostic,
  logPath: string,
): ConsoleProblem {
  return {
    severity: diagnostic.severity,
    title: `${diagnostic.code} · ${diagnosticFileName(diagnostic.file)}:${diagnostic.line}`,
    detail: diagnostic.message || diagnostic.raw,
    path: logPath,
    sourcePath: diagnostic.file,
    line: diagnostic.line,
    column: diagnostic.column,
  }
}

function openSourceAt(path: string, line: number, column: number): void {
  const targetPath = resolveDiagnosticSourcePath(path)
  const source =
    sourceArtifacts.value.find((item) => diagnosticMatchesPath(targetPath, item.path)) ||
    sourceArtifacts.value.find((item) => diagnosticMatchesPath(path, item.path)) ||
    reviewSourceArtifacts.value.find((item) =>
      diagnosticMatchesPath(targetPath, item.path),
    ) ||
    reviewSourceArtifacts.value.find((item) => diagnosticMatchesPath(path, item.path))
  const resolvedTarget = normalizeWorkspacePath(source?.path || targetPath)
  activeSource.value = source
    ? toSourceSelection(source)
    : { label: fileName(resolvedTarget), path: resolvedTarget }
  sourceFocusTarget.value = {
    path: resolvedTarget,
    line,
    column,
    token: ++sourceFocusToken,
  }
  void openGlobalSrcView()
}

async function openGlobalSrcView(): Promise<void> {
  if (!isGlobalSrcView.value) {
    await router.push('/workspace/src')
  }
  activeTab.value = 'src'
}

function ensureActiveTabVisible(): void {
  if (visibleTabs.value.some((tab) => tab.id === activeTab.value)) return
  activeTab.value = defaultTabForCurrentStep()
}

function defaultTabForCurrentStep(): TabId {
  if (isGlobalSrcView.value) return 'src'
  if (isGlobalWaveView.value) return 'summary'
  if (isSimStep.value && visibleTabs.value.some((tab) => tab.id === 'cases'))
    return 'cases'
  if (isReviewStep.value && visibleTabs.value.some((tab) => tab.id === 'review'))
    return 'review'
  if (isElabStep.value && visibleTabs.value.some((tab) => tab.id === 'elab'))
    return 'elab'
  if (isLintStep.value && visibleTabs.value.some((tab) => tab.id === 'lint'))
    return 'lint'
  return 'summary'
}

function resolveDiagnosticSourcePath(path: string): string {
  const trimmed = String(path || '').trim()
  if (!trimmed) return ''
  const normalized = normalizeWorkspacePath(trimmed)
  const projectPath = currentProject.value?.path
  if (normalized.startsWith('/')) return normalized

  const directMatch =
    sourceArtifacts.value.find((item) => diagnosticMatchesPath(normalized, item.path)) ||
    reviewSourceArtifacts.value.find((item) =>
      diagnosticMatchesPath(normalized, item.path),
    )
  if (directMatch) return normalizeWorkspacePath(directMatch.path)

  const cpuFilelist = normalizeWorkspacePath(
    config.frontend.cpuFilelist || config.frontend.inputFilelist || '',
  )
  if (cpuFilelist.includes('/')) {
    const cpuRoot = cpuFilelist.slice(0, cpuFilelist.lastIndexOf('/'))
    const fromCpuRoot = `${cpuRoot}/${normalized}`.replace(/\/+/g, '/')
    const cpuRootMatch =
      sourceArtifacts.value.find((item) =>
        diagnosticMatchesPath(fromCpuRoot, item.path),
      ) ||
      reviewSourceArtifacts.value.find((item) =>
        diagnosticMatchesPath(fromCpuRoot, item.path),
      )
    if (cpuRootMatch) return normalizeWorkspacePath(cpuRootMatch.path)
  }

  if (!projectPath) return normalized
  return `${normalizeWorkspacePath(projectPath)}/${normalized}`.replace(/\/+/g, '/')
}

function startConsoleResize(event: PointerEvent): void {
  if (consoleCollapsed.value) return
  event.preventDefault()
  const target = event.currentTarget as HTMLElement | null
  target?.setPointerCapture?.(event.pointerId)
  consoleResizing.value = true
  consoleResizeStartY = event.clientY
  consoleResizeStartHeight = consoleHeight.value
  window.addEventListener('pointermove', handleConsoleResize)
  window.addEventListener('pointerup', stopConsoleResize)
  window.addEventListener('pointercancel', stopConsoleResize)
}

function handleConsoleResize(event: PointerEvent): void {
  if (!consoleResizing.value) return
  const delta = consoleResizeStartY - event.clientY
  consoleHeight.value = clampConsoleHeight(consoleResizeStartHeight + delta)
}

function stopConsoleResize(): void {
  if (!consoleResizing.value) return
  consoleResizing.value = false
  window.removeEventListener('pointermove', handleConsoleResize)
  window.removeEventListener('pointerup', stopConsoleResize)
  window.removeEventListener('pointercancel', stopConsoleResize)
}

function resetConsoleHeight(): void {
  consoleHeight.value = CONSOLE_DEFAULT_HEIGHT
}

function clampConsoleHeight(value: number): number {
  return Math.min(CONSOLE_MAX_HEIGHT, Math.max(CONSOLE_MIN_HEIGHT, Math.round(value)))
}

function startSplitterResize(event: MouseEvent): void {
  const target = event.target as HTMLElement | null
  const gutter = target?.closest('.frontend-workspace .p-splitter-gutter')
  if (!gutter) return

  splitterResizing = true
  document.body.classList.add('splitter-resizing')

  const splitter = gutter.closest('.p-splitter')
  if (splitter?.classList.contains('p-splitter-vertical')) {
    document.body.classList.add('splitter-resizing-vertical')
  }

  window.getSelection()?.removeAllRanges()
}

function stopSplitterResize(): void {
  if (splitterResizing) {
    splitterResizing = false
  }
  document.body.classList.remove('splitter-resizing')
  document.body.classList.remove('splitter-resizing-vertical')
}

function handleSplitterVisibilityChange(): void {
  if (document.visibilityState !== 'visible') {
    stopSplitterResize()
  }
}

function uniquePathItems(items: PathItem[]): PathItem[] {
  const seen = new Set<string>()
  const result: PathItem[] = []
  for (const item of items) {
    const path = String(item.path || '').trim()
    if (!path || seen.has(path)) continue
    seen.add(path)
    result.push({ ...item, path })
  }
  return result
}

onMounted(refresh)
onMounted(() => {
  unsubscribeRuntimeEvents = getDesktopApi().runtime.events.onEvent(handleRuntimeEvent)
  window.addEventListener('message', handleSurferMessage)
  document.addEventListener('mousedown', startSplitterResize)
  document.addEventListener('mouseup', stopSplitterResize)
  document.addEventListener('pointerup', stopSplitterResize)
  document.addEventListener('dragend', stopSplitterResize)
  window.addEventListener('blur', stopSplitterResize)
  document.addEventListener('visibilitychange', handleSplitterVisibilityChange)
})

onBeforeUnmount(() => {
  window.removeEventListener('message', handleSurferMessage)
  document.removeEventListener('mousedown', startSplitterResize)
  document.removeEventListener('mouseup', stopSplitterResize)
  document.removeEventListener('pointerup', stopSplitterResize)
  document.removeEventListener('dragend', stopSplitterResize)
  window.removeEventListener('blur', stopSplitterResize)
  document.removeEventListener('visibilitychange', handleSplitterVisibilityChange)
  stopSplitterResize()
  stopConsoleResize()
  stopRunClock()
  unsubscribeRuntimeEvents?.()
  unsubscribeRuntimeEvents = null
})

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

watch(
  () => currentProject.value?.path || '',
  () => {
    activeWaveform.value = null
    cachedWaveItems.value = []
    waveformError.value = ''
    waveformLoading.value = false
    loadedWaveformKey = ''
  },
)

watch(
  () => String(route.params.step || ''),
  () => {
    detail.value = null
    logContent.value = ''
    selectedCase.value = null
    disassemblyPanelOpen.value = false
    disassemblyTarget.value = { address: '', token: 0 }
    selectedLogPath.value = ''
    activeTab.value = defaultTabForCurrentStep()
    if (!isGlobalSrcView.value) {
      activeSource.value = null
    }
    if (!isHomeView.value) {
      void loadDetail()
    }
  },
)

watch(
  () => [route.query.path, route.query.case, waveItems.value.length],
  () => {
    if (!isGlobalWaveView.value) return
    syncWaveSelectionFromRoute()
    void loadCurrentWaveform()
  },
)

watch(
  detailWaveItems,
  (items) => {
    if (String(detail.value?.step || '').toLowerCase() !== 'sim') return
    cachedWaveItems.value = uniqueWaveItems(items)
  },
  { immediate: true },
)

watch(coremarkCompilePreset, (preset) => {
  if (preset === 'custom') return
  const selected = coremarkCompilePresets.find((item) => item.id === preset)
  if (selected) coremarkOptLevel.value = selected.opt
})

watch([simSuite, simCpuMode], () => {
  cpuCasePickerOpen.value = false
})

watch(visibleTabs, () => {
  ensureActiveTabVisible()
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
.header-actions,
.panel-header,
.step-title,
.step-meta,
.summary-grid,
.sim-run-head,
.sim-controls,
.frontend-step-tabs,
.source-row,
.wave-header,
.wave-title,
.case-name,
.path-button,
.console-head,
.console-tabs,
.console-tab,
.console-actions,
.console-log-tools,
.problem-row {
  display: flex;
  min-width: 0;
}

.frontend-header {
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}

.frontend-kicker,
.panel-header span,
.step-meta,
.tool,
.summary-tile span,
.empty-panel,
.source-list-head span {
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

.header-actions {
  align-items: center;
  gap: 8px;
}

.refresh-btn,
.run-btn,
.icon-action,
.cpu-case-dropdown,
.frontend-step-tab,
.console-tab,
.case-chip,
.source-row,
.problem-row,
.text-action {
  border: 0;
  color: var(--text-primary);
  cursor: pointer;
}

.refresh-btn,
.run-btn,
.icon-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  height: 34px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-secondary);
}

.icon-action.compact {
  width: 30px;
  height: 30px;
}

.refresh-btn {
  width: 34px;
}

.run-btn {
  padding: 0 12px;
  background: rgba(var(--accent-rgb, 59, 130, 246), 0.12);
  color: var(--accent-color);
  font-weight: 700;
}

.run-btn.running {
  color: #10b981;
  background: rgba(16, 185, 129, 0.14);
  border-color: rgba(16, 185, 129, 0.35);
  box-shadow: 0 10px 24px rgba(16, 185, 129, 0.16);
}

.run-btn.running:hover {
  background: rgba(16, 185, 129, 0.2);
}

.run-btn.danger {
  background: #b91c1c;
  box-shadow: 0 10px 24px rgba(185, 28, 28, 0.2);
}

.run-btn.danger:hover {
  background: #991b1b;
}

.run-btn.subtle {
  background: var(--bg-secondary);
  color: var(--text-primary);
}

button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.frontend-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 14px;
  min-height: 0;
  flex: 1;
}

.detail-panel-full {
  min-width: 0;
}

.panel,
.state-panel {
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

.success {
  color: #10b981;
}

.running {
  color: #10b981;
}

.failed {
  color: #ef4444;
}

.pending {
  color: var(--text-secondary);
}

.step-title span:first-child,
.source-row strong,
.source-row small,
.wave-title span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool,
.console-log {
  font-family: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
}

.detail-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
  flex: 1;
  padding: 14px;
}

.home-detail-content {
  padding: 10px;
}

.summary-grid {
  gap: 10px;
  flex-wrap: wrap;
}

.home-splitter,
.frontend-resizable-splitter {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  border: 0;
  background: transparent;
}

.home-splitter {
  flex-direction: column;
}

.frontend-resizable-splitter :deep(.p-splitterpanel) {
  display: flex;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  contain: style;
}

.frontend-resizable-splitter :deep(.p-splitter-gutter) {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 6px !important;
  cursor: row-resize;
  background: transparent;
  transition: background-color 0.14s ease;
}

.frontend-resizable-splitter :deep(.p-splitter-gutter)::after {
  width: 54px;
  height: 2px;
  border-radius: 999px;
  background: var(--border-color);
  content: '';
  transition:
    background 0.14s ease,
    opacity 0.14s ease;
}

.frontend-resizable-splitter :deep(.p-splitter-gutter:hover)::after,
.frontend-resizable-splitter
  :deep(.p-splitter-gutter[data-p-gutter-resizing='true'])::after {
  background: var(--accent-color);
  opacity: 0.9;
}

.frontend-resizable-splitter :deep(.p-splitter-gutter-handle) {
  display: none;
}

.home-pane {
  display: flex;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.home-pane > * {
  flex: 1 1 auto;
  width: 100%;
  min-width: 0;
  min-height: 0;
}

.home-summary-grid {
  flex: 1;
  align-content: start;
  overflow: auto;
  padding: 4px;
}

.summary-tile {
  min-width: 130px;
  padding: 10px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-primary);
}

.summary-tile span,
.summary-tile strong {
  display: block;
}

.summary-tile span {
  margin-bottom: 4px;
  font-size: 10px;
  text-transform: uppercase;
}

.step-compact-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  flex-shrink: 0;
  padding: 6px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-primary);
}

.step-compact-meta div {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  max-width: 240px;
  padding: 4px 8px;
  border-radius: 6px;
  background: var(--bg-secondary);
}

.step-compact-meta span {
  flex-shrink: 0;
  color: var(--text-secondary);
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
}

.step-compact-meta strong {
  min-width: 0;
  overflow: hidden;
  color: var(--text-primary);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.step-compact-meta .runtime-value {
  display: inline-block;
  width: 16ch;
  font-family: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
  font-variant-numeric: tabular-nums;
}

.step-meta-action {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 24px;
  padding: 0 8px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-secondary);
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 10px;
  font-weight: 700;
}

.step-meta-action:hover {
  color: var(--accent-color);
  border-color: rgba(var(--accent-rgb, 59, 130, 246), 0.28);
}

.frontend-config-card {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-primary);
}

.frontend-config-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-shrink: 0;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border-color);
}

.frontend-config-card__head div {
  min-width: 0;
}

.frontend-config-card__head div > strong,
.frontend-config-card__head div > span {
  display: block;
}

.frontend-config-card__head div > span {
  margin-top: 4px;
  color: var(--text-secondary);
  font-size: 11px;
  line-height: 1.4;
}

.frontend-config-card__badge {
  flex-shrink: 0;
  padding: 4px 8px;
  border: 1px solid var(--border-color);
  border-radius: 999px;
  color: var(--text-secondary);
  background: var(--bg-secondary);
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
}

.frontend-config-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  align-content: start;
  gap: 10px;
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px;
}

.frontend-config-item {
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-secondary);
  cursor: default;
}

.frontend-config-item.wide {
  grid-column: span 2;
}

.frontend-config-item span,
.frontend-config-item strong {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.frontend-config-item span {
  margin-bottom: 6px;
  color: var(--text-secondary);
  font-size: 10px;
  text-transform: uppercase;
}

.frontend-config-item strong {
  font-size: 13px;
}

.frontend-config-item strong.mono {
  font-family: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
  font-size: 12px;
}

.frontend-config-item strong.highlight {
  color: var(--accent-color);
}

.home-fill-card {
  flex: 1;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
}

.workspace-home-card {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-primary);
  padding: 14px;
}

.workspace-home-card__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border-color);
}

.workspace-home-card__head span {
  color: var(--text-secondary);
  font-size: 11px;
  line-height: 1.5;
}

.workspace-home-card__body {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  align-content: start;
  gap: 12px;
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding-top: 14px;
}

.workspace-home-metric {
  padding: 12px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-secondary);
}

.workspace-home-metric span,
.workspace-home-metric strong {
  display: block;
}

.workspace-home-metric span {
  color: var(--text-secondary);
  font-size: 10px;
  text-transform: uppercase;
}

.workspace-home-metric strong {
  margin-top: 6px;
  font-size: 15px;
}

.workspace-guide-card {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  align-content: start;
  gap: 12px;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding: 2px;
}

.home-lower-grid {
  display: grid;
  grid-template-columns: minmax(260px, 0.9fr) minmax(320px, 1.4fr);
  gap: 10px;
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.workspace-guide-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-width: 0;
  padding: 12px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-primary);
}

.workspace-guide-item > i {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border-radius: 7px;
  background: rgba(var(--accent-rgb, 59, 130, 246), 0.1);
  color: var(--accent-color);
}

.workspace-guide-item div {
  min-width: 0;
}

.workspace-guide-item strong,
.workspace-guide-item span {
  display: block;
}

.workspace-guide-item strong {
  margin-bottom: 4px;
  font-size: 12px;
}

.workspace-guide-item span {
  color: var(--text-secondary);
  font-size: 11px;
  line-height: 1.45;
}

.sim-run-card {
  padding: 10px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-primary);
}

.sim-run-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.sim-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.cpu-case-picker-shell {
  position: relative;
  display: grid;
  gap: 4px;
  min-width: 220px;
}

.cpu-case-picker-label {
  color: var(--text-secondary);
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
}

.sim-select-field {
  display: grid;
  gap: 4px;
  min-width: 150px;
}

.sim-select-field.compact {
  min-width: 108px;
}

.sim-select-field span {
  color: var(--text-secondary);
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
}

.sim-select-field select,
.sim-select-field input,
.cpu-case-dropdown {
  min-height: 32px;
  border: 1px solid var(--border-color);
  border-radius: 7px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 12px;
}

.sim-select-field select,
.sim-select-field input {
  padding: 0 28px 0 9px;
}

.sim-select-field input {
  padding-right: 9px;
}

.cpu-case-dropdown {
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: min(300px, 100%);
  padding: 0 9px;
  color: var(--text-secondary);
}

.cpu-case-dropdown i {
  transition: transform 0.15s ease;
}

.cpu-case-dropdown i.open {
  transform: rotate(180deg);
}

.sim-run-action {
  width: 238px;
  flex-shrink: 0;
}

.sim-run-action-label {
  min-width: 0;
  overflow: hidden;
  flex: 1;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.run-timer-badge {
  display: inline-flex;
  justify-content: center;
  flex: 0 0 6ch;
  font-family: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}

.sim-run-context {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--border-color);
}

.sim-run-context div {
  min-width: 0;
  padding: 8px 9px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-secondary);
}

.sim-run-context.stale div:last-child {
  border-color: rgba(245, 158, 11, 0.35);
  background: rgba(245, 158, 11, 0.08);
}

.sim-run-context.fresh div:last-child {
  border-color: rgba(16, 185, 129, 0.28);
  background: rgba(16, 185, 129, 0.07);
}

.sim-run-context.running div:last-child {
  border-color: rgba(59, 130, 246, 0.28);
  background: rgba(var(--accent-rgb, 59, 130, 246), 0.08);
}

.sim-run-context span,
.sim-run-context strong {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sim-run-context span {
  margin-bottom: 4px;
  color: var(--text-secondary);
  font-size: 10px;
  text-transform: uppercase;
}

.sim-run-context strong {
  font-size: 12px;
}

.case-chip {
  border-radius: 7px;
  background: var(--bg-secondary);
  color: var(--text-secondary);
}

.case-chip.active {
  background: rgba(var(--accent-rgb, 59, 130, 246), 0.13);
  color: var(--accent-color);
  border-color: rgba(var(--accent-rgb, 59, 130, 246), 0.28);
}

.case-picker {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  max-height: min(260px, 42vh);
  overflow: auto;
  padding: 8px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-secondary);
}

.case-picker.dropdown {
  position: absolute;
  z-index: 20;
  top: calc(100% + 6px);
  left: 0;
  width: min(520px, calc(100vw - 96px));
  box-shadow: 0 18px 38px rgba(15, 23, 42, 0.2);
}

.case-chip {
  padding: 5px 8px;
  border: 1px solid var(--border-color);
  font-family: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
  font-size: 10px;
}

.case-picker-empty {
  color: var(--text-secondary);
  font-size: 11px;
}

.coremark-compile-panel {
  display: grid;
  gap: 8px;
  margin-top: 10px;
  padding: 9px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-secondary);
}

.coremark-compile-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(92px, 1fr));
  gap: 8px;
}

.coremark-extra-flags {
  display: grid;
  gap: 4px;
}

.coremark-extra-flags span,
.coremark-float-toggle,
.coremark-compile-summary {
  color: var(--text-secondary);
  font-size: 11px;
}

.coremark-extra-flags > span {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
}

.coremark-extra-flags input {
  min-height: 32px;
  padding: 0 9px;
  border: 1px solid var(--border-color);
  border-radius: 7px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-family: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
  font-size: 11px;
}

.coremark-float-toggle {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}

.coremark-compile-summary {
  overflow: hidden;
  font-family: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.frontend-step-tabs {
  align-items: center;
  gap: 5px;
  border-bottom: 1px solid var(--border-color);
}

.frontend-step-tab {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 8px 10px;
  border-radius: 7px 7px 0 0;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
}

.frontend-step-tab.active {
  color: var(--accent-color);
  background: rgba(var(--accent-rgb, 59, 130, 246), 0.09);
  box-shadow: inset 0 -2px 0 var(--accent-color);
}

.tab-content {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.sim-cases-splitter {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
  border: 0;
  background: transparent;
}

.sim-cases-pane,
.sim-terminal-pane {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.sim-cases-pane {
  gap: 8px;
}

.summary-panel,
.review-panel,
.elab-panel,
.lint-panel,
.cases-panel,
.source-layout {
  height: 100%;
  min-height: 0;
}

.summary-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow: hidden;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  min-height: 0;
}

.summary-card {
  min-width: 0;
  padding: 12px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-primary);
}

.summary-card.grow {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}

.summary-card header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
}

.summary-card header span {
  color: var(--text-secondary);
  font-size: 10px;
  text-transform: uppercase;
}

.summary-card header strong {
  min-width: 0;
  overflow: hidden;
  color: var(--text-primary);
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.summary-card p {
  margin: 0 0 10px;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.45;
}

.summary-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
}

.summary-metrics span {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  padding: 7px;
  border: 1px solid var(--border-color);
  border-radius: 7px;
  background: var(--bg-secondary);
  color: var(--text-secondary);
  font-size: 10px;
}

.summary-metrics strong {
  color: var(--text-primary);
  font-family: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
  font-size: 12px;
}

.prepare-grid {
  flex: 1;
  overflow: auto;
}

.prepare-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
}

.prepare-kv-list,
.prepare-contract-list,
.prepare-source-list {
  display: flex;
  flex-direction: column;
  gap: 7px;
  min-height: 0;
}

.prepare-kv,
.prepare-source-row,
.prepare-contract-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
  padding: 8px 9px;
  border: 1px solid var(--border-color);
  border-radius: 7px;
  background: var(--bg-secondary);
}

.prepare-kv span,
.prepare-source-row small,
.prepare-contract-row small {
  color: var(--text-secondary);
  font-size: 11px;
}

.prepare-kv strong,
.prepare-source-row strong,
.prepare-contract-row strong {
  min-width: 0;
  overflow: hidden;
  color: var(--text-primary);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.prepare-kv.mono strong {
  font-family: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
  font-size: 11px;
}

.prepare-source-row span,
.prepare-contract-row span {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.prepare-source-row em,
.prepare-contract-row em {
  flex: 0 0 auto;
  color: var(--text-secondary);
  font-size: 11px;
  font-style: normal;
}

.prepare-contract-row i {
  flex: 0 0 auto;
  font-size: 16px;
}

.prepare-contract-row.ok i {
  color: var(--success-color);
}

.prepare-contract-row.warning i {
  color: var(--warning-color);
}

.prepare-contract-row.error i {
  color: var(--danger-color);
}

.prepare-metrics {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.ownership-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.ownership-strip span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 7px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-secondary);
  color: var(--text-secondary);
  font-size: 10px;
}

.ownership-strip strong {
  color: var(--text-primary);
  font-family: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
}

.summary-issue-list {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  overflow: auto;
}

.elab-summary-grid {
  flex-shrink: 0;
}

.elab-readiness-metrics span:first-child {
  grid-column: span 2;
}

.elab-chip-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-height: 0;
}

.elab-chip {
  max-width: 100%;
  overflow: hidden;
  padding: 5px 8px;
  border: 1px solid var(--border-color);
  border-radius: 999px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-family: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.elab-chip.muted {
  color: var(--text-secondary);
}

.elab-largest-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  min-height: 0;
  overflow: auto;
}

.log-select {
  min-width: 220px;
  max-width: 100%;
  height: 30px;
  border: 1px solid var(--border-color);
  border-radius: 7px;
  background: var(--bg-primary);
  color: var(--text-primary);
}

.source-row:hover,
.source-row.active {
  background: rgba(var(--accent-rgb, 59, 130, 246), 0.08);
}

.source-row small {
  color: var(--text-secondary);
  font-family: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
  font-size: 9px;
}

.review-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  gap: 10px;
  overflow: hidden;
}

.review-overview {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 8px;
  flex-shrink: 0;
}

.review-tile {
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-primary);
}

.review-tile span,
.review-tile strong {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.review-tile span {
  margin-bottom: 4px;
  color: var(--text-secondary);
  font-size: 10px;
  text-transform: uppercase;
}

.review-tile strong {
  font-size: 17px;
}

.review-tile.error strong {
  color: #ef4444;
}

.review-tile.warning strong {
  color: #f59e0b;
}

.review-tile.ok strong {
  color: #10b981;
}

.review-main {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  gap: 10px;
  min-height: 0;
  height: 100%;
  flex: 1;
}

.review-sidebar,
.review-layer {
  min-height: 0;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-primary);
}

.review-sidebar {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px;
  overflow: auto;
}

.review-stage {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.review-mode-list {
  display: grid;
  gap: 6px;
}

.review-mode-button {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 42px;
  padding: 8px;
  border: 1px solid var(--border-color);
  border-radius: 7px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  cursor: pointer;
  text-align: left;
}

.review-mode-button.active {
  border-color: rgba(var(--accent-rgb, 59, 130, 246), 0.5);
  background: rgba(var(--accent-rgb, 59, 130, 246), 0.1);
}

.review-mode-button i {
  flex-shrink: 0;
  color: var(--accent-color);
  font-size: 16px;
}

.review-mode-button span {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
  flex: 1;
}

.review-mode-button strong {
  min-width: 0;
  overflow: hidden;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.review-mode-button em {
  flex-shrink: 0;
  min-width: 24px;
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--bg-primary);
  color: var(--text-secondary);
  font-size: 10px;
  font-style: normal;
  text-align: center;
}

.review-layer {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.review-layer-head,
.review-column-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 9px 10px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-secondary);
}

.review-layer-head div {
  min-width: 0;
}

.review-layer-head span,
.review-column-head span {
  display: block;
  color: var(--text-secondary);
  font-size: 10px;
  text-transform: uppercase;
}

.review-layer-head strong,
.review-column-head strong {
  display: block;
  min-width: 0;
  margin-top: 2px;
  overflow: hidden;
  color: var(--text-primary);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.review-layer-head em {
  min-width: 28px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--bg-primary);
  color: var(--text-secondary);
  font-size: 10px;
  font-style: normal;
  text-align: center;
}

.review-issues {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  overflow: auto;
  padding: 10px;
}

.review-yosys-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
  gap: 10px;
  flex: 1;
  min-height: 0;
  padding: 10px;
}

.review-yosys-column {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-secondary);
}

.review-yosys-list {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 0;
  min-height: 0;
  overflow: auto;
  padding: 0 0 8px;
}

.review-yosys-column .review-issue,
.review-module-card,
.review-hotspot-card {
  margin: 8px 8px 0;
}

.review-yosys-column .empty-panel {
  margin: 8px;
}

.review-structural {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--border-color);
  border-left: 3px solid var(--text-secondary);
  border-radius: 8px;
  background: var(--bg-secondary);
}

.review-structural.ok {
  border-left-color: #10b981;
}

.review-structural.warning {
  border-left-color: #f59e0b;
}

.review-structural.muted {
  border-left-color: var(--text-secondary);
}

.review-structural > div:first-child {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.review-structural span {
  color: var(--text-secondary);
  font-size: 10px;
  text-transform: uppercase;
}

.review-structural strong {
  color: var(--text-primary);
  font-size: 12px;
}

.review-structural p {
  margin: 0;
  color: var(--text-secondary);
  font-size: 11px;
  line-height: 1.45;
}

.review-structural-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}

.review-structural-grid span {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  padding: 6px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-primary);
  text-transform: none;
}

.review-structural-grid strong {
  font-family: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
  font-size: 11px;
}

.review-metrics {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.review-metrics div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 9px;
  border: 1px solid var(--border-color);
  border-radius: 7px;
  background: var(--bg-secondary);
}

.review-metrics span {
  color: var(--text-secondary);
  font-size: 11px;
}

.review-metrics strong {
  font-family: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
  font-size: 12px;
}

.review-issue {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  width: 100%;
  padding: 10px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  cursor: pointer;
  text-align: left;
}

.review-issue:hover {
  background: rgba(var(--accent-rgb, 59, 130, 246), 0.07);
}

.review-issue.error {
  border-left: 3px solid #ef4444;
}

.review-issue.warning {
  border-left: 3px solid #f59e0b;
}

.review-issue.info {
  border-left: 3px solid var(--accent-color);
}

.review-issue.waived {
  opacity: 0.62;
  border-left-color: var(--text-secondary);
}

.review-issue-icon {
  flex-shrink: 0;
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 7px;
  background: var(--bg-primary);
}

.review-issue.error .review-issue-icon {
  color: #ef4444;
}

.review-issue.warning .review-issue-icon {
  color: #f59e0b;
}

.review-issue.info .review-issue-icon {
  color: var(--accent-color);
}

.review-module-card {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 10px;
  border: 1px solid var(--border-color);
  border-left: 3px solid var(--text-secondary);
  border-radius: 8px;
  background: var(--bg-primary);
  color: var(--text-primary);
  text-align: left;
}

.review-module-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  min-height: 0;
  overflow: auto;
  padding: 10px;
}

.review-module-grid .review-module-card {
  margin: 0;
}

.review-module-card.high {
  border-left-color: #ef4444;
}

.review-module-card.medium {
  border-left-color: #f59e0b;
}

.review-module-card.low {
  border-left-color: #10b981;
}

.review-module-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.review-module-title strong {
  min-width: 0;
  overflow: hidden;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.review-module-title em {
  flex-shrink: 0;
  color: var(--text-secondary);
  font-size: 10px;
  font-style: normal;
  text-transform: uppercase;
}

.review-module-card p {
  margin: 0;
  color: var(--text-secondary);
  font-size: 11px;
  line-height: 1.4;
}

.review-hotspot-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
  border: 1px solid var(--border-color);
  border-left: 3px solid var(--accent-color);
  border-radius: 8px;
  background: var(--bg-primary);
}

.review-hotspot-card.warning {
  border-left-color: #f59e0b;
}

.review-hotspot-card.error {
  border-left-color: #ef4444;
}

.review-hotspot-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.review-hotspot-title strong {
  min-width: 0;
  overflow: hidden;
  color: var(--text-primary);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.review-hotspot-title em {
  flex-shrink: 0;
  color: var(--text-secondary);
  font-family: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
  font-size: 11px;
  font-style: normal;
}

.review-hotspot-card p {
  margin: 0;
  color: var(--text-secondary);
  font-size: 11px;
  line-height: 1.4;
}

.review-module-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 5px;
}

.review-module-metrics span {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  padding: 5px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-secondary);
  color: var(--text-secondary);
  font-size: 10px;
}

.review-module-metrics strong {
  color: var(--text-primary);
  font-family: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
  font-size: 11px;
}

.review-issue-body {
  min-width: 0;
  flex: 1;
}

.review-issue-title {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
}

.review-issue-title strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}

.review-issue-title span {
  flex-shrink: 0;
  color: var(--text-secondary);
  font-size: 10px;
  text-transform: uppercase;
}

.review-issue p,
.review-issue small,
.review-issue em {
  display: block;
  margin: 4px 0 0;
}

.review-issue p {
  color: var(--text-secondary);
  font-size: 11px;
  line-height: 1.45;
}

.review-issue small {
  color: var(--text-primary);
  font-size: 11px;
  line-height: 1.45;
}

.review-issue em {
  color: var(--text-secondary);
  font-family: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
  font-size: 10px;
  font-style: normal;
}

.elab-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  overflow: hidden;
}

.lint-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  overflow: hidden;
}

.lint-ownership-strip {
  flex-shrink: 0;
}

.lint-scope-control {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  padding: 2px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-secondary);
}

.lint-scope-control button {
  min-width: 64px;
  padding: 4px 7px;
  border-radius: 4px;
  color: var(--text-secondary);
  font-size: 10px;
}

.lint-scope-control button.active {
  background: var(--bg-primary);
  color: var(--accent-color);
  box-shadow: 0 0 0 1px rgba(var(--accent-rgb, 59, 130, 246), 0.2);
}

.lint-main {
  display: grid;
  grid-template-columns: minmax(420px, 1.25fr) minmax(320px, 0.85fr);
  gap: 10px;
  flex: 1;
  min-height: 0;
}

.lint-column {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-primary);
}

.lint-list,
.lint-side-list {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  overflow: auto;
  padding: 10px;
}

.lint-side-list.compact {
  flex: 0 1 45%;
}

.review-layer-head.secondary {
  border-top: 1px solid var(--border-color);
}

.lint-rule-row,
.lint-file-row {
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--border-color);
  border-left: 3px solid #f59e0b;
  border-radius: 8px;
  background: var(--bg-secondary);
}

.lint-rule-row.error,
.lint-file-row.error {
  border-left-color: #ef4444;
}

.lint-rule-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 6px 10px;
}

.lint-rule-row div,
.lint-file-row span {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.lint-rule-row strong,
.lint-file-row strong {
  min-width: 0;
  overflow: hidden;
  color: var(--text-primary);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lint-rule-row span,
.lint-rule-row small,
.lint-file-row small {
  min-width: 0;
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lint-rule-row small {
  grid-column: 1 / -1;
  font-size: 11px;
  line-height: 1.4;
  white-space: normal;
}

.lint-rule-row em,
.lint-file-row em {
  align-self: start;
  flex-shrink: 0;
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--bg-primary);
  color: var(--text-secondary);
  font-family: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
  font-size: 10px;
  font-style: normal;
}

.lint-file-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  color: var(--text-primary);
  cursor: pointer;
  text-align: left;
}

.lint-file-row:hover {
  background: rgba(var(--accent-rgb, 59, 130, 246), 0.07);
}

.elab-main {
  display: grid;
  grid-template-columns: minmax(280px, 0.9fr) minmax(420px, 1.45fr);
  gap: 10px;
  flex: 1;
  min-height: 0;
}

.elab-column {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-primary);
}

.elab-list,
.elab-module-list {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  overflow: auto;
  padding: 10px;
}

.elab-unresolved,
.elab-module-row {
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-secondary);
}

.elab-unresolved {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  padding: 10px;
  border-left: 3px solid #f59e0b;
}

.elab-unresolved i {
  flex-shrink: 0;
  color: #f59e0b;
}

.elab-unresolved.informational {
  border-left-color: var(--accent-color);
}

.elab-unresolved.informational i {
  color: var(--accent-color);
}

.elab-unresolved span,
.elab-module-row span {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.elab-unresolved strong,
.elab-module-row strong {
  min-width: 0;
  overflow: hidden;
  color: var(--text-primary);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.elab-unresolved small,
.elab-module-row small {
  min-width: 0;
  overflow: hidden;
  color: var(--text-secondary);
  font-family: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.elab-module-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px 10px;
  width: 100%;
  padding: 10px;
  color: var(--text-primary);
  cursor: pointer;
  text-align: left;
}

.elab-module-row:hover {
  background: rgba(var(--accent-rgb, 59, 130, 246), 0.07);
}

.elab-module-row.top {
  border-left: 3px solid #10b981;
}

.elab-module-row em {
  align-self: start;
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--bg-primary);
  color: var(--text-secondary);
  font-size: 10px;
  font-style: normal;
  text-transform: uppercase;
}

.elab-module-meta {
  display: grid;
  grid-column: 1 / -1;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 5px;
}

.elab-module-meta span {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  padding: 5px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-primary);
  color: var(--text-secondary);
  font-size: 10px;
}

.elab-module-meta strong {
  color: var(--text-primary);
  font-family: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
  font-size: 11px;
}

.source-layout {
  display: grid;
  grid-template-columns: minmax(220px, 300px) minmax(0, 1fr);
  gap: 10px;
}

.src-workspace-clean {
  gap: 0;
  padding: 0;
}

.wave-workspace-clean {
  gap: 0;
  padding: 0;
}

.source-layout-clean {
  grid-template-columns: minmax(220px, 300px) minmax(0, 1fr);
  gap: 0;
  width: 100%;
  height: 100%;
  min-height: 0;
}

.source-layout-clean .source-list {
  border-top: 0;
  border-bottom: 0;
  border-left: 0;
  border-radius: 0;
}

.wave-workspace-layout {
  display: grid;
  grid-template-columns: minmax(220px, 300px) minmax(0, 1fr);
  width: 100%;
  height: 100%;
  min-height: 0;
}

.wave-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding: 10px;
  border-right: 1px solid var(--border-color);
  background: var(--bg-secondary);
}

.wave-row {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  min-width: 0;
  padding: 9px;
  border: 1px solid transparent;
  border-radius: 8px;
  color: var(--text-primary);
  cursor: pointer;
  text-align: left;
}

.wave-row:hover,
.wave-row.active {
  border-color: rgba(var(--accent-rgb, 59, 130, 246), 0.3);
  background: rgba(var(--accent-rgb, 59, 130, 246), 0.08);
}

.wave-row i {
  flex-shrink: 0;
  color: var(--accent-color);
  font-size: 16px;
}

.wave-row span {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.wave-row strong,
.wave-row small {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wave-row strong {
  font-size: 12px;
}

.wave-row small {
  color: var(--text-secondary);
  font-family: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
  font-size: 10px;
}

.wave-viewer-panel {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--bg-primary);
}

.wave-surfer-shell {
  min-height: 0;
}

.wave-empty {
  height: 100%;
  border: 0;
  border-radius: 0;
}

.source-list {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-primary);
}

.source-list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-shrink: 0;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border-color);
  background: rgba(var(--accent-rgb, 59, 130, 246), 0.04);
}

.source-list-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: auto;
}

.source-row {
  align-items: center;
  gap: 8px;
  padding: 7px 9px;
  border-left: 2px solid transparent;
  border-radius: 0;
  background: transparent;
  color: var(--text-primary);
  text-align: left;
}

.source-row.diagnostic {
  border-left-color: rgba(245, 158, 11, 0.75);
}

.source-row.diagnostic.error {
  border-left-color: rgba(239, 68, 68, 0.85);
}

.source-row span {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}

.source-row > i {
  flex-shrink: 0;
  color: var(--text-secondary);
}

.source-row.active > i,
.source-row:hover > i {
  color: var(--accent-color);
}

.source-row strong {
  font-size: 11px;
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

.cases-table-wrap {
  flex: 1;
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-primary);
}

.cases-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sim-cases-workspace {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  gap: 8px;
  overflow: hidden;
}

.sim-cases-main {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  gap: 8px;
}

.sim-disassembly-pane {
  display: flex;
  width: clamp(380px, 44%, 720px);
  min-width: 340px;
  min-height: 0;
  flex: 0 1 auto;
  overflow: hidden;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-primary);
}

.sim-insight-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(280px, 0.75fr);
  gap: 8px;
  flex: 0 0 auto;
  max-height: 156px;
}

.sim-insight-card {
  min-width: 0;
  overflow: auto;
  padding: 9px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-primary);
}

.sim-insight-card > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 7px;
}

.sim-insight-card > header span,
.sim-insight-card > header strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sim-insight-card > header span {
  color: var(--text-secondary);
  font-size: 10px;
  text-transform: uppercase;
}

.sim-insight-card > header strong {
  font-family: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
  font-size: 10px;
}

.sim-regression-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 5px;
}

.sim-regression-grid > div {
  min-width: 0;
  padding: 6px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-secondary);
}

.sim-regression-grid span,
.sim-regression-grid strong {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sim-regression-grid span {
  margin-bottom: 2px;
  color: var(--text-secondary);
  font-size: 9px;
  text-transform: uppercase;
}

.sim-regression-grid strong {
  font-size: 12px;
}

.sim-regression-grid .error strong,
.sim-cycle-changes em.slower {
  color: #ef4444;
}

.sim-regression-grid .warning strong {
  color: #f59e0b;
}

.sim-regression-grid .ok strong,
.sim-cycle-changes em.faster,
.sim-history-list i.ok {
  color: #10b981;
}

.sim-cycle-changes {
  display: flex;
  gap: 8px;
  margin-top: 6px;
  overflow: auto;
}

.sim-cycle-changes span {
  display: flex;
  gap: 5px;
  flex-shrink: 0;
  font-size: 10px;
}

.sim-cycle-changes em {
  font-style: normal;
}

.sim-history-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.sim-history-list > div:not(.empty-panel) {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 7px;
}

.sim-history-list i.failed {
  color: #ef4444;
}

.sim-history-list span {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.sim-history-list strong,
.sim-history-list small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sim-history-list strong {
  font-family: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
  font-size: 10px;
}

.sim-history-list small,
.sim-history-list em {
  color: var(--text-secondary);
  font-size: 9px;
  font-style: normal;
}

.sim-stale-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  padding: 8px 10px;
  border: 1px solid rgba(245, 158, 11, 0.32);
  border-radius: 8px;
  background: rgba(245, 158, 11, 0.08);
  color: #f59e0b;
  font-size: 11px;
}

.sim-stale-banner span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.step-stale-banner {
  margin: 8px 10px 0;
}

.sim-terminal-card {
  display: flex;
  min-height: 180px;
  max-height: 300px;
  flex: 0 0 220px;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: #0f172a;
}

.sim-terminal-pane .sim-terminal-card {
  flex: 1 1 auto;
  min-height: 0;
  max-height: none;
}

.sim-terminal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-shrink: 0;
  padding: 8px 10px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.24);
  background: rgba(15, 23, 42, 0.92);
  color: #e5e7eb;
}

.sim-terminal-head div:first-child {
  min-width: 0;
}

.sim-terminal-head span,
.sim-terminal-head strong {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sim-terminal-head span {
  margin-bottom: 2px;
  color: #94a3b8;
  font-size: 10px;
  font-weight: 800;
  text-transform: uppercase;
}

.sim-terminal-head strong {
  font-size: 12px;
}

.sim-terminal-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.sim-terminal-actions .log-select {
  max-width: 240px;
  border-color: rgba(148, 163, 184, 0.34);
  background: #111827;
  color: #e5e7eb;
}

.sim-terminal-actions .icon-action {
  border-color: rgba(148, 163, 184, 0.34);
  background: #111827;
  color: #e5e7eb;
}

.sim-terminal-output {
  flex: 1;
  min-height: 0;
  margin: 0;
  overflow: auto;
  padding: 10px 12px;
  background: #020617;
  color: #d1d5db;
  font-family: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
  font-size: 11px;
  line-height: 1.5;
  white-space: pre-wrap;
}

.sim-failure-summary {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 8px 10px;
  border-bottom: 1px solid rgba(239, 68, 68, 0.28);
  background: rgba(127, 29, 29, 0.28);
  color: #fecaca;
}

.sim-failure-summary strong {
  font-size: 11px;
}

.sim-failure-summary span {
  overflow: hidden;
  font-family: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cases-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.cases-table th,
.cases-table td {
  padding: 9px 10px;
  border-bottom: 1px solid var(--border-color);
  text-align: left;
}

.cases-table th {
  position: sticky;
  top: 0;
  background: var(--bg-secondary);
  color: var(--text-secondary);
  font-size: 10px;
  text-transform: uppercase;
}

.cases-table tr {
  cursor: pointer;
}

.cases-table tr.selected {
  background: rgba(var(--accent-rgb, 59, 130, 246), 0.08);
}

.case-name {
  align-items: center;
  gap: 7px;
}

.case-name span {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}

.case-name strong,
.case-name small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.case-name small {
  max-width: 420px;
  color: #ef4444;
  font-size: 10px;
}

.case-status {
  display: inline-flex;
  padding: 2px 7px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 800;
}

.case-status.ok {
  color: #10b981;
  background: rgba(16, 185, 129, 0.1);
}

.case-status.failed {
  color: #ef4444;
  background: rgba(239, 68, 68, 0.1);
}

.path-pill {
  display: inline-flex;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-secondary);
  font-family: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
  font-size: 10px;
}

.path-button {
  align-items: center;
  gap: 5px;
  padding: 4px 7px;
  border: 1px solid var(--border-color);
  border-radius: 999px;
  background: var(--bg-secondary);
  color: var(--accent-color);
}

.difftest-jump {
  display: inline-grid;
  grid-template-columns: auto auto;
  max-width: 190px;
}

.difftest-jump i {
  grid-row: 1 / span 2;
  align-self: center;
}

.difftest-jump small {
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 8px;
  text-overflow: ellipsis;
}

.case-icon-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  background: var(--bg-secondary);
  color: var(--accent-color);
  cursor: pointer;
}

.case-icon-action:hover,
.case-icon-action.active {
  border-color: var(--accent-color);
  background: rgba(var(--accent-rgb, 59, 130, 246), 0.1);
}

.case-icon-action.active {
  box-shadow: inset 0 0 0 1px var(--accent-color);
}

.wave-header {
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  min-width: 0;
  padding: 9px 10px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-secondary);
  flex-shrink: 0;
}

.wave-title {
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.wave-title > i {
  font-size: 18px;
  color: var(--accent-color);
}

.wave-title div {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}

.wave-title strong,
.wave-title span {
  display: block;
}

.wave-title span {
  color: var(--text-secondary);
  font-family: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
  font-size: 10px;
}

.surfer-shell {
  position: relative;
  flex: 1;
  width: 100%;
  min-height: 0;
  background: #111827;
}

.surfer-frame {
  width: 100%;
  height: 100%;
  border: 0;
  background: #111827;
}

.wave-status {
  position: absolute;
  inset: 12px auto auto 12px;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  max-width: min(520px, calc(100% - 24px));
  padding: 8px 10px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-secondary);
  color: var(--text-secondary);
  font-size: 11px;
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.16);
}

.wave-status.error {
  color: #ef4444;
  border-color: rgba(239, 68, 68, 0.35);
}

.frontend-console {
  position: relative;
  flex-shrink: 0;
  overflow: hidden;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-primary);
}

.frontend-console.resizing,
.frontend-console.resizing * {
  cursor: ns-resize;
  user-select: none;
}

.frontend-console.collapsed .console-head {
  border-bottom: 0;
}

.console-resizer {
  position: absolute;
  z-index: 2;
  top: 0;
  left: 0;
  right: 0;
  height: 9px;
  cursor: ns-resize;
  background: transparent;
}

.console-resizer::after {
  position: absolute;
  top: 3px;
  left: 50%;
  width: 54px;
  height: 3px;
  border-radius: 999px;
  background: var(--border-color);
  content: '';
  transform: translateX(-50%);
  opacity: 0;
  transition:
    opacity 0.12s ease,
    background 0.12s ease;
}

.console-resizer:hover::after,
.frontend-console.resizing .console-resizer::after {
  background: var(--accent-color);
  opacity: 0.85;
}

.console-head {
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 7px 9px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-secondary);
}

.console-tabs {
  align-items: center;
  gap: 5px;
}

.console-tab {
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 9px;
  border-radius: 7px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 700;
}

.console-tab.active {
  background: rgba(var(--accent-rgb, 59, 130, 246), 0.1);
  color: var(--accent-color);
}

.console-tab em {
  min-width: 18px;
  padding: 1px 5px;
  border-radius: 999px;
  background: rgba(239, 68, 68, 0.14);
  color: #ef4444;
  font-size: 10px;
  font-style: normal;
  text-align: center;
}

.console-actions {
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.console-actions > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-secondary);
  font-size: 11px;
}

.console-body {
  height: var(--console-height, 178px);
  min-height: 0;
}

.problem-panel,
.console-log-panel {
  height: 100%;
  min-height: 0;
}

.problem-panel {
  display: flex;
  flex-direction: column;
  gap: 7px;
  overflow: auto;
  padding: 8px;
}

.problem-row {
  align-items: flex-start;
  gap: 9px;
  width: 100%;
  padding: 8px 9px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-secondary);
  text-align: left;
}

.problem-row.error {
  border-color: rgba(239, 68, 68, 0.3);
}

.problem-row.warning {
  border-color: rgba(245, 158, 11, 0.3);
}

.problem-row > i {
  margin-top: 2px;
}

.problem-row.error > i {
  color: #ef4444;
}

.problem-row.warning > i {
  color: #f59e0b;
}

.problem-row span {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 3px;
}

.problem-row strong,
.problem-row small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.problem-row strong {
  font-size: 12px;
}

.problem-row small {
  color: var(--text-secondary);
  font-family: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
  font-size: 10px;
}

.problem-target {
  flex-shrink: 0;
  min-width: 32px;
  margin-top: 1px;
  padding: 2px 6px;
  border: 1px solid var(--border-color);
  border-radius: 999px;
  color: var(--text-secondary);
  background: var(--bg-primary);
  font-size: 9px;
  font-style: normal;
  font-weight: 800;
  text-align: center;
  text-transform: uppercase;
}

.problem-row.error .problem-target {
  border-color: rgba(239, 68, 68, 0.28);
}

.problem-row.warning .problem-target {
  border-color: rgba(245, 158, 11, 0.28);
}

.console-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 100%;
  color: var(--text-secondary);
  font-size: 12px;
}

.console-log-panel {
  display: flex;
  flex-direction: column;
}

.console-log-tools {
  align-items: center;
  gap: 8px;
  padding: 8px;
  border-bottom: 1px solid var(--border-color);
}

.log-select.compact {
  height: 28px;
  min-width: 180px;
  font-size: 11px;
}

.console-log {
  flex: 1;
  min-height: 0;
  margin: 0;
  overflow: auto;
  padding: 10px 12px;
  color: var(--text-primary);
  background: var(--bg-primary);
  font-size: 10px;
  line-height: 1.45;
}

.text-action {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 10px;
  border-radius: 7px;
  background: rgba(var(--accent-rgb, 59, 130, 246), 0.1);
  color: var(--accent-color);
}

.empty-panel,
.state-panel {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 120px;
  padding: 20px;
}

.empty-panel.compact {
  min-height: 80px;
  font-size: 11px;
}

.state-panel.error {
  color: #ef4444;
}

@media (max-width: 1180px) {
  .frontend-grid,
  .source-layout,
  .review-main,
  .review-yosys-grid,
  .review-module-grid,
  .elab-main,
  .lint-main,
  .sim-insight-grid {
    grid-template-columns: 1fr;
  }

  .sim-insight-grid {
    max-height: 280px;
  }

  .frontend-config-grid,
  .review-overview {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .workspace-home-card__head,
  .workspace-home-card__body,
  .sim-run-context,
  .coremark-compile-grid {
    grid-template-columns: 1fr;
  }

  .home-lower-grid {
    grid-template-columns: 1fr;
  }

  .workspace-home-card__head {
    align-items: flex-start;
    flex-direction: column;
  }

  .sim-run-head {
    align-items: stretch;
    flex-direction: column;
  }

  .sim-run-action {
    width: 100%;
  }
}

@media (max-width: 720px) {
  .frontend-config-card__head {
    align-items: flex-start;
    flex-direction: column;
  }

  .frontend-config-grid {
    grid-template-columns: 1fr;
  }

  .review-overview {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .review-module-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .sim-regression-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .coremark-compile-summary {
    white-space: normal;
  }

  .review-issue-title {
    align-items: flex-start;
    flex-direction: column;
    gap: 4px;
  }

  .frontend-config-item.wide {
    grid-column: auto;
  }

  .home-detail-content {
    padding: 8px;
  }

  .home-summary-grid {
    gap: 8px;
  }
}
</style>
