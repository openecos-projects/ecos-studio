<template>
  <div
    class="new-workspace-wizard-overlay fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4 sm:p-6"
    @click.self="closeWizard"
  >
    <div
      class="new-workspace-wizard-panel relative flex h-[88vh] max-h-[900px] w-full max-w-6xl flex-col overflow-hidden rounded-[20px] border border-(--border-color) bg-(--bg-primary) shadow-[0_28px_70px_-24px_rgba(0,0,0,0.55)]"
    >
      <button
        @click="closeWizard"
        class="absolute top-5 right-5 z-20 flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-(--border-color) bg-(--bg-secondary)/60 text-(--text-secondary) transition-colors duration-200 hover:bg-(--bg-secondary) hover:text-(--text-primary)"
        title="Close"
      >
        <i class="ri-close-line text-lg"></i>
      </button>

      <div class="flex min-h-0 flex-1 flex-col md:flex-row">
        <aside
          class="flex w-full shrink-0 flex-col border-b border-(--border-color) bg-(--bg-secondary)/35 p-6 md:w-72 md:border-r md:border-b-0"
        >
          <div class="mb-7">
            <h1 class="text-2xl font-bold text-(--text-primary)">{{ wizardTitle }}</h1>
            <p class="mt-1 text-sm text-(--text-secondary)">
              Build a project-scoped RTL2GDS workspace.
            </p>
            <div
              v-if="sourceContext"
              class="mt-4 rounded-lg border border-(--accent-color)/35 bg-(--accent-color)/10 p-3 text-xs"
            >
              <p class="font-bold text-(--text-primary)">Created from</p>
              <p class="mt-1 truncate text-(--text-secondary)">
                {{ sourceContext.projectName || projectContext.project_name }} /
                {{ sourceContext.workspaceName || sourceContext.workspaceId }} /
                {{ sourceContext.step }} output
              </p>
            </div>
          </div>

          <div class="grid gap-3">
            <button
              v-for="step in steps"
              :key="step.id"
              type="button"
              class="group flex w-full cursor-default items-center gap-3 rounded-lg border px-3 py-3 text-left transition-colors duration-200"
              :class="[
                currentStep === step.id
                  ? 'border-(--accent-color) bg-(--accent-color)/10 text-(--text-primary)'
                  : step.id <= highestStep
                    ? 'border-(--border-color) bg-(--bg-primary)/65 text-(--text-primary) hover:border-(--accent-color)/50'
                    : 'border-(--border-color)/70 bg-transparent text-(--text-secondary)',
              ]"
              @click="handleStepClick(step.id)"
            >
              <span
                class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border text-sm font-bold"
                :class="[
                  currentStep > step.id
                    ? 'border-(--accent-color) bg-(--accent-color) text-white'
                    : currentStep === step.id
                      ? 'border-(--accent-color) bg-(--accent-color) text-white'
                      : 'border-(--border-color) bg-(--bg-secondary)/55',
                ]"
              >
                <i v-if="currentStep > step.id" class="ri-check-line text-base"></i>
                <span v-else>{{ step.id }}</span>
              </span>
              <span class="min-w-0">
                <span class="block truncate text-sm font-semibold">{{ step.title }}</span>
                <span
                  v-if="currentStep === step.id"
                  class="mt-0.5 block text-[11px] font-semibold tracking-wide text-(--accent-color) uppercase"
                  >Active</span
                >
              </span>
            </button>
          </div>
        </aside>

        <main class="flex min-w-0 flex-1 flex-col">
          <section
            class="custom-scrollbar min-h-0 flex-1"
            :class="
              currentStep === 5
                ? 'overflow-hidden p-4 md:p-5'
                : 'overflow-y-auto p-6 md:p-8'
            "
          >
            <Transition name="fade-slide" mode="out-in">
              <div
                v-if="currentStep === 1"
                key="project-setup"
                class="mx-auto w-full max-w-3xl"
              >
                <header class="mb-7">
                  <h2 class="text-2xl font-bold text-(--text-primary)">Project Setup</h2>
                  <p class="mt-2 text-sm text-(--text-secondary)">
                    Choose the project that will own this workspace, or define a project
                    root for a new project.
                  </p>
                </header>

                <div
                  v-if="projectManifestError"
                  role="alert"
                  class="mb-5 rounded-lg border border-red-500/35 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300"
                >
                  {{ projectManifestError }}
                </div>

                <div
                  class="rounded-xl border border-(--border-color) bg-(--bg-secondary)/20 p-5"
                >
                  <div
                    class="mb-5 inline-flex rounded-lg border border-(--border-color) bg-(--bg-primary)/80 p-1"
                  >
                    <button
                      type="button"
                      class="rounded-md px-4 py-2 text-sm font-semibold transition-colors duration-200"
                      :class="
                        projectContext.mode === 'select'
                          ? 'bg-(--accent-color) text-white'
                          : 'text-(--text-secondary) hover:text-(--text-primary)'
                      "
                      @click="setProjectMode('select')"
                    >
                      Select Project
                    </button>
                    <button
                      type="button"
                      class="rounded-md px-4 py-2 text-sm font-semibold transition-colors duration-200"
                      :class="
                        projectContext.mode === 'create'
                          ? 'bg-(--accent-color) text-white'
                          : 'text-(--text-secondary) hover:text-(--text-primary)'
                      "
                      @click="setProjectMode('create')"
                    >
                      Create Project
                    </button>
                  </div>

                  <div v-if="projectContext.mode === 'select'" class="space-y-5">
                    <div>
                      <label
                        class="mb-2 block text-sm font-semibold text-(--text-primary)"
                        >Project Root <span class="text-red-500">*</span></label
                      >
                      <div class="flex gap-3">
                        <input
                          :value="projectContext.project_root"
                          readonly
                          type="text"
                          placeholder="/projects/gcd_backend"
                          class="min-w-0 flex-1 rounded-lg border border-(--border-color) bg-(--bg-primary)/75 px-3 py-2.5 text-sm text-(--text-primary) outline-none"
                          @click="selectProjectRoot"
                        />
                        <button
                          type="button"
                          class="inline-flex shrink-0 items-center gap-2 rounded-lg border border-(--border-color) bg-(--bg-primary)/75 px-4 py-2.5 text-sm font-semibold text-(--text-primary) transition-colors duration-200 hover:bg-(--bg-secondary)"
                          @click="selectProjectRoot"
                        >
                          <i class="ri-folder-open-line"></i>
                          Browse
                        </button>
                      </div>
                    </div>

                    <div
                      v-if="projectHistory.length > 0"
                      class="rounded-lg border border-(--border-color) bg-(--bg-primary)/55 p-3"
                    >
                      <div class="mb-3 flex items-center justify-between gap-3">
                        <span
                          class="text-xs font-semibold tracking-wide text-(--text-secondary) uppercase"
                          >Recent Projects</span
                        >
                        <span class="text-[11px] text-(--text-secondary)"
                          >{{ projectHistory.length }} projects</span
                        >
                      </div>
                      <div
                        class="custom-scrollbar max-h-40 space-y-2 overflow-y-auto pr-1"
                      >
                        <button
                          v-for="project in projectHistory"
                          :key="project.path"
                          type="button"
                          class="flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition-colors duration-200"
                          :class="
                            normalizePath(projectContext.project_root) ===
                            normalizePath(project.path)
                              ? 'border-(--accent-color) bg-(--accent-color)/10'
                              : 'border-(--border-color) bg-(--bg-secondary)/35 hover:border-(--accent-color)/45'
                          "
                          @click="selectProjectFromHistory(project)"
                        >
                          <span class="min-w-0">
                            <span
                              class="block truncate text-sm font-semibold text-(--text-primary)"
                              >{{ project.name }}</span
                            >
                            <span
                              class="mt-0.5 block truncate font-mono text-[11px] text-(--text-secondary)"
                              :title="project.path"
                              >{{ project.path }}</span
                            >
                          </span>
                          <i
                            class="ri-arrow-right-s-line shrink-0 text-(--text-secondary)"
                          ></i>
                        </button>
                      </div>
                    </div>
                    <p
                      v-else-if="isLoadingProjectHistory"
                      class="text-xs text-(--text-secondary)"
                    >
                      Loading recent projects...
                    </p>
                    <p
                      v-else-if="projectHistoryError"
                      class="text-xs text-(--text-secondary)"
                    >
                      {{ projectHistoryError }}
                    </p>

                    <div>
                      <label
                        class="mb-2 block text-sm font-semibold text-(--text-primary)"
                        >Project Name</label
                      >
                      <input
                        v-model="projectContext.project_name"
                        type="text"
                        placeholder="gcd_backend"
                        class="w-full rounded-lg border border-(--border-color) bg-(--bg-primary)/75 px-3 py-2.5 text-sm text-(--text-primary) outline-none focus:border-(--accent-color)"
                      />
                    </div>
                  </div>

                  <div v-else class="space-y-5">
                    <div>
                      <label
                        class="mb-2 block text-sm font-semibold text-(--text-primary)"
                        >Project Name <span class="text-red-500">*</span></label
                      >
                      <input
                        v-model="projectContext.project_name"
                        type="text"
                        placeholder="gcd_backend"
                        class="w-full rounded-lg border border-(--border-color) bg-(--bg-primary)/75 px-3 py-2.5 text-sm text-(--text-primary) outline-none focus:border-(--accent-color)"
                      />
                      <p v-if="projectNameError" class="mt-2 text-xs text-red-500">
                        {{ projectNameError }}
                      </p>
                    </div>

                    <div>
                      <label
                        class="mb-2 block text-sm font-semibold text-(--text-primary)"
                        >Project Parent Path <span class="text-red-500">*</span></label
                      >
                      <div class="flex gap-3">
                        <input
                          v-model="projectParentPath"
                          readonly
                          type="text"
                          placeholder="/projects"
                          class="min-w-0 flex-1 rounded-lg border border-(--border-color) bg-(--bg-primary)/75 px-3 py-2.5 text-sm text-(--text-primary) outline-none"
                          @click="selectProjectParentPath"
                        />
                        <button
                          type="button"
                          class="inline-flex shrink-0 items-center gap-2 rounded-lg border border-(--border-color) bg-(--bg-primary)/75 px-4 py-2.5 text-sm font-semibold text-(--text-primary) transition-colors duration-200 hover:bg-(--bg-secondary)"
                          @click="selectProjectParentPath"
                        >
                          <i class="ri-folder-open-line"></i>
                          Browse
                        </button>
                      </div>
                    </div>
                  </div>

                  <div
                    class="mt-6 rounded-lg border border-(--border-color) bg-(--bg-primary)/70 p-4"
                  >
                    <div class="grid gap-3 text-sm md:grid-cols-2">
                      <div>
                        <span
                          class="block text-xs font-semibold tracking-wide text-(--text-secondary) uppercase"
                          >Project Path</span
                        >
                        <p
                          class="mt-1 truncate font-mono text-(--text-primary)"
                          :title="projectContext.project_root"
                        >
                          {{ projectContext.project_root || '-' }}
                        </p>
                      </div>
                      <div>
                        <span
                          class="block text-xs font-semibold tracking-wide text-(--text-secondary) uppercase"
                          >Project Metadata</span
                        >
                        <p
                          class="mt-1 truncate font-mono text-(--text-primary)"
                          :title="projectContext.project_json_path"
                        >
                          {{ projectContext.project_json_path || '-' }}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div
                v-else-if="currentStep === 2"
                key="basic-info"
                class="mx-auto w-full max-w-3xl"
              >
                <header class="mb-7">
                  <h2 class="text-2xl font-bold text-(--text-primary)">Basic Info</h2>
                  <p class="mt-2 text-sm text-(--text-secondary)">
                    Name the workspace and confirm where it will be created.
                  </p>
                </header>

                <div
                  class="space-y-6 rounded-xl border border-(--border-color) bg-(--bg-secondary)/20 p-5"
                >
                  <div>
                    <label class="mb-2 block text-sm font-semibold text-(--text-primary)"
                      >Workspace Name <span class="text-red-500">*</span></label
                    >
                    <input
                      v-model="workspaceName"
                      type="text"
                      placeholder="density_065_from_floorplan"
                      :disabled="lockWorkspaceDirectory"
                      class="w-full rounded-lg border px-3 py-2.5 text-sm text-(--text-primary) transition-colors duration-200 outline-none"
                      :class="
                        workspaceNameError
                          ? 'border-red-500 bg-red-500/5'
                          : lockWorkspaceDirectory
                            ? 'border-(--border-color) bg-(--bg-secondary)/45 text-(--text-secondary)'
                            : 'border-(--border-color) bg-(--bg-primary)/75 focus:border-(--accent-color)'
                      "
                      @input="workspaceNameTouched = true"
                    />
                    <p v-if="workspaceNameError" class="mt-2 text-xs text-red-500">
                      {{ workspaceNameError }}
                    </p>
                  </div>

                  <div>
                    <label class="mb-2 block text-sm font-semibold text-(--text-primary)"
                      >Description</label
                    >
                    <textarea
                      v-model="config.parameters.description"
                      rows="3"
                      placeholder="Optional workspace notes"
                      class="w-full resize-none rounded-lg border border-(--border-color) bg-(--bg-primary)/75 px-3 py-2.5 text-sm text-(--text-primary) outline-none focus:border-(--accent-color)"
                    ></textarea>
                  </div>

                  <div>
                    <label class="mb-2 block text-sm font-semibold text-(--text-primary)"
                      >Workspace Location</label
                    >
                    <div
                      class="rounded-lg border border-(--border-color) bg-(--bg-primary)/75 px-3 py-3"
                    >
                      <p
                        class="truncate font-mono text-sm text-(--text-primary)"
                        :title="workspaceLocation"
                      >
                        {{ workspaceLocation || '-' }}
                      </p>
                      <p class="mt-2 text-xs text-(--text-secondary)">
                        project root + Workspace Name
                      </p>
                    </div>
                    <p v-if="workspaceLocationError" class="mt-2 text-xs text-red-500">
                      {{ workspaceLocationError }}
                    </p>
                    <p
                      v-else-if="managedWorkspacePreview"
                      class="mt-2 text-xs text-(--text-secondary)"
                    >
                      Workspace will be created at {{ managedWorkspacePreview }}.
                    </p>
                  </div>
                </div>
              </div>

              <div
                v-else-if="currentStep === 3"
                key="flow-setup"
                class="mx-auto w-full max-w-5xl"
              >
                <header class="mb-7">
                  <h2 class="text-2xl font-bold text-(--text-primary)">Flow Setup</h2>
                  <p class="mt-2 text-sm text-(--text-secondary)">
                    Select a continuous harden flow range. Step order remains fixed.
                  </p>
                </header>

                <div
                  class="rounded-xl border border-(--border-color) bg-(--bg-secondary)/20 p-5"
                >
                  <div
                    class="mb-5 grid gap-3 rounded-lg border border-(--border-color) bg-(--bg-primary)/70 p-4 text-sm md:grid-cols-3"
                  >
                    <div>
                      <span
                        class="block text-xs font-semibold tracking-wide text-(--text-secondary) uppercase"
                        >Start Step</span
                      >
                      <p class="mt-1 font-semibold text-(--text-primary)">
                        {{ flowStartStep }}
                      </p>
                    </div>
                    <div>
                      <span
                        class="block text-xs font-semibold tracking-wide text-(--text-secondary) uppercase"
                        >End Step</span
                      >
                      <p class="mt-1 font-semibold text-(--text-primary)">
                        {{ flowEndStep }}
                      </p>
                    </div>
                    <div>
                      <span
                        class="block text-xs font-semibold tracking-wide text-(--text-secondary) uppercase"
                        >Selected Steps</span
                      >
                      <p class="mt-1 font-semibold text-(--text-primary)">
                        {{ selectedFlowSteps.length }}
                      </p>
                    </div>
                  </div>

                  <p
                    v-if="sourceContext"
                    class="mb-5 rounded-lg border border-(--border-color) bg-(--bg-primary)/60 px-4 py-3 text-xs text-(--text-secondary)"
                  >
                    Cannot select steps before the source output. This workspace starts at
                    {{ sourceContext.startStep || flowStartStep }} and reuses previous
                    results from
                    {{ sourceContext.workspaceName || sourceContext.workspaceId }}.
                  </p>

                  <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    <div
                      v-for="(step, index) in hardenFlowSteps"
                      :key="step.name"
                      class="relative"
                    >
                      <button
                        type="button"
                        class="flex min-h-[104px] w-full cursor-pointer flex-col rounded-xl border p-4 text-left transition-colors duration-200"
                        :class="[
                          isFlowStepLocked(step.name)
                            ? 'cursor-not-allowed border-(--border-color)/60 bg-(--bg-secondary)/25 opacity-45'
                            : isFlowStepSelected(step.name)
                              ? 'border-(--accent-color) bg-(--accent-color)/10'
                              : 'border-(--border-color) bg-(--bg-primary)/65 hover:border-(--accent-color)/45',
                        ]"
                        :disabled="isFlowStepLocked(step.name)"
                        @click="setFlowBoundary(step.name)"
                      >
                        <span class="mb-3 flex items-center justify-between gap-3">
                          <span class="flex items-center gap-2">
                            <span
                              class="flex h-6 w-6 items-center justify-center rounded-md border text-xs font-bold"
                              :class="
                                isFlowStepSelected(step.name)
                                  ? 'border-(--accent-color) bg-(--accent-color) text-white'
                                  : 'border-(--border-color) text-(--text-secondary)'
                              "
                            >
                              <span>{{ index + 1 }}</span>
                            </span>
                            <span class="font-semibold text-(--text-primary)">{{
                              step.name
                            }}</span>
                          </span>
                          <input
                            type="checkbox"
                            class="h-4 w-4 accent-(--accent-color)"
                            :checked="isFlowStepSelected(step.name)"
                            readonly
                          />
                        </span>
                        <span class="text-xs leading-5 text-(--text-secondary)">{{
                          step.description
                        }}</span>
                        <span
                          v-if="isFlowStepLocked(step.name)"
                          class="mt-2 text-[11px] font-semibold text-(--text-secondary)"
                        >
                          Reused from source
                        </span>
                      </button>
                      <span
                        v-if="index < hardenFlowSteps.length - 1 && (index + 1) % 4 !== 0"
                        class="flow-step-connector"
                        aria-hidden="true"
                      >
                        <span class="flow-step-connector-line"></span>
                        <span class="flow-step-connector-dot"></span>
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div
                v-else-if="currentStep === 4"
                key="design-files"
                class="mx-auto w-full max-w-5xl"
              >
                <header class="mb-7">
                  <h2 class="text-2xl font-bold text-(--text-primary)">Design Files</h2>
                  <p class="mt-2 text-sm text-(--text-secondary)">
                    Inputs adapt to the first selected flow step. Constraints are imported
                    here.
                  </p>
                </header>

                <div
                  class="grid min-h-[520px] overflow-hidden rounded-xl border border-(--border-color) bg-(--bg-secondary)/20 lg:grid-cols-[240px_1fr]"
                >
                  <nav
                    class="border-b border-(--border-color) bg-(--bg-primary)/60 p-3 lg:border-r lg:border-b-0"
                  >
                    <button
                      v-for="item in designInputTypes"
                      :key="item.key"
                      type="button"
                      class="mb-2 flex w-full cursor-pointer items-center justify-between rounded-lg border px-3 py-3 text-left transition-colors duration-200"
                      :class="
                        activeDesignInputType === item.key
                          ? 'border-(--accent-color) bg-(--accent-color)/10'
                          : 'border-transparent hover:border-(--border-color) hover:bg-(--bg-secondary)/60'
                      "
                      @click="activeDesignInputType = item.key"
                    >
                      <span>
                        <span class="block text-sm font-semibold text-(--text-primary)">{{
                          item.label
                        }}</span>
                        <span class="mt-1 block text-xs text-(--text-secondary)">{{
                          item.required ? 'Required' : 'Optional'
                        }}</span>
                      </span>
                      <i
                        :class="[
                          getDesignInputStatus(item.key)
                            ? 'ri-checkbox-circle-fill text-green-500'
                            : 'ri-circle-line text-(--text-secondary)',
                        ]"
                      ></i>
                    </button>
                  </nav>

                  <div class="min-w-0 p-5">
                    <div v-if="activeDesignInputType === 'rtl'" class="space-y-5">
                      <div
                        @dragover.prevent="isDraggingFiles = true"
                        @dragleave.prevent="isDraggingFiles = false"
                        @drop.prevent="handleFileDrop"
                        class="rounded-xl border-2 border-dashed p-8 text-center transition-colors duration-200"
                        :class="
                          isDraggingFiles
                            ? 'border-(--accent-color) bg-(--accent-color)/5'
                            : 'border-(--border-color) bg-(--bg-primary)/65 hover:border-(--accent-color)/45'
                        "
                      >
                        <div
                          class="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl border border-(--border-color) bg-(--bg-secondary)/50 text-(--text-secondary)"
                        >
                          <i class="ri-upload-cloud-2-line text-3xl"></i>
                        </div>
                        <h3 class="text-base font-bold text-(--text-primary)">
                          Add RTL Design Files
                        </h3>
                        <p class="mt-2 text-sm text-(--text-secondary)">
                          Supports .v, .sv, .vhd, .vhdl, and .gz-compressed RTL files or a
                          design folder.
                        </p>
                        <div class="relative mt-5 inline-block">
                          <button
                            type="button"
                            class="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-(--accent-color) px-5 py-2.5 text-sm font-semibold text-white transition-opacity duration-200 hover:opacity-90"
                            @click="toggleBrowseMenu"
                          >
                            Browse
                            <i
                              class="ri-arrow-down-s-line"
                              :class="{ 'rotate-180': showBrowseMenu }"
                            ></i>
                          </button>
                          <div
                            v-if="showBrowseMenu"
                            class="absolute top-[calc(100%+0.5rem)] left-1/2 z-20 w-60 -translate-x-1/2 overflow-hidden rounded-lg border border-(--border-color) bg-(--bg-primary) shadow-lg"
                          >
                            <button
                              type="button"
                              class="flex w-full cursor-pointer items-center gap-2 px-4 py-3 text-left text-sm text-(--text-primary) transition-colors duration-200 hover:bg-(--bg-secondary)/60"
                              @click="browseRtlFiles"
                            >
                              <i class="ri-file-code-line text-blue-500"></i>
                              Select RTL files...
                            </button>
                            <button
                              type="button"
                              class="flex w-full cursor-pointer items-center gap-2 border-t border-(--border-color)/60 px-4 py-3 text-left text-sm text-(--text-primary) transition-colors duration-200 hover:bg-(--bg-secondary)/60"
                              @click="browseRtlFolder"
                            >
                              <i class="ri-folder-open-line text-yellow-500"></i>
                              Select design folder...
                            </button>
                          </div>
                        </div>
                        <p v-if="manualFilePickError" class="mt-5 text-xs text-red-500">
                          {{ manualFilePickError }}
                        </p>
                        <p
                          v-else-if="directoryScanError"
                          class="mt-5 text-xs text-red-500"
                        >
                          {{ directoryScanError }}
                        </p>
                        <p
                          v-else-if="isScanningDirectory"
                          class="mt-5 text-xs text-(--text-secondary)"
                        >
                          <i class="ri-loader-4-line animate-spin"></i>
                          Scanning RTL files in the selected directory...
                        </p>
                      </div>

                      <DesignFileTransfer
                        v-if="rtlSourceDirectory && scannedRtlFiles.length > 0"
                        :root-path="rtlSourceDirectory"
                        :all-files="scannedRtlFiles"
                        :selected-files="directorySelectedFiles"
                        @update:selected-files="updateDirectorySelectedFiles"
                      />

                      <div
                        v-if="manuallyAddedFiles.length > 0"
                        class="rounded-xl border border-(--border-color) bg-(--bg-primary)/65 p-4"
                      >
                        <div class="mb-3 flex items-center justify-between">
                          <h4 class="text-sm font-semibold text-(--text-primary)">
                            Added RTL Files
                          </h4>
                          <span
                            class="rounded-md bg-(--bg-secondary) px-2 py-0.5 text-xs text-(--text-secondary)"
                            >{{ manuallyAddedFiles.length }}</span
                          >
                        </div>
                        <div
                          class="custom-scrollbar max-h-44 space-y-2 overflow-y-auto pr-1"
                        >
                          <div
                            v-for="file in manuallyAddedFiles"
                            :key="file"
                            class="flex items-center justify-between gap-3 rounded-lg border border-(--border-color) bg-(--bg-secondary)/25 px-3 py-2"
                          >
                            <div class="min-w-0">
                              <p
                                class="truncate text-sm font-medium text-(--text-primary)"
                              >
                                {{ getFileName(file) }}
                              </p>
                              <p class="truncate text-xs text-(--text-secondary)">
                                {{ file }}
                              </p>
                            </div>
                            <button
                              type="button"
                              class="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-(--text-secondary) transition-colors duration-200 hover:bg-red-500/10 hover:text-red-500"
                              @click="removeManualFile(file)"
                            >
                              <i class="ri-delete-bin-line"></i>
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div
                      v-else
                      class="rounded-xl border border-(--border-color) bg-(--bg-primary)/65 p-5"
                    >
                      <div class="mb-5 flex items-start justify-between gap-4">
                        <div>
                          <h3 class="text-lg font-bold text-(--text-primary)">
                            {{ activeDesignInput?.label }}
                          </h3>
                          <p class="mt-1 text-sm text-(--text-secondary)">
                            {{ activeDesignInput?.description }}
                          </p>
                        </div>
                        <span
                          class="rounded-md border border-(--border-color) bg-(--bg-secondary)/55 px-2 py-1 text-xs font-semibold text-(--text-secondary)"
                        >
                          {{ activeDesignInput?.required ? 'Required' : 'Optional' }}
                        </span>
                      </div>

                      <div class="flex flex-col gap-3 md:flex-row">
                        <input
                          :value="getDesignInputPath(activeDesignInputType)"
                          readonly
                          type="text"
                          placeholder="No file imported"
                          class="min-w-0 flex-1 rounded-lg border border-(--border-color) bg-(--bg-secondary)/35 px-3 py-2.5 text-sm text-(--text-primary) outline-none"
                        />
                        <button
                          type="button"
                          class="inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-lg bg-(--accent-color) px-5 py-2.5 text-sm font-semibold text-white transition-opacity duration-200 hover:opacity-90"
                          @click="importDesignInput(activeDesignInputType)"
                        >
                          <i class="ri-upload-2-line"></i>
                          {{
                            activeDesignInputType === 'sdc'
                              ? 'Import SDC'
                              : `Import ${activeDesignInput?.label || 'File'}`
                          }}
                        </button>
                      </div>
                      <p
                        v-if="activeDesignInputType === 'sdc'"
                        class="mt-3 text-xs text-(--text-secondary)"
                      >
                        SDC is optional and stored with the design inputs.
                      </p>
                      <p v-if="designFileError" class="mt-3 text-xs text-red-500">
                        {{ designFileError }}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div
                v-else-if="currentStep === 5"
                key="pdk-config"
                class="mx-auto flex h-full w-full max-w-5xl flex-col"
              >
                <header class="mb-4 shrink-0">
                  <h2 class="text-xl font-bold text-(--text-primary)">PDK Config</h2>
                  <p class="mt-1 text-xs text-(--text-secondary)">
                    Select an imported PDK, then use ECC defaults or customize PDK
                    resource files.
                  </p>
                </header>

                <div
                  class="grid min-h-0 flex-1 grid-rows-[auto_auto_minmax(0,1fr)] gap-3"
                >
                  <section
                    class="rounded-xl border border-(--border-color) bg-(--bg-secondary)/20 p-3"
                  >
                    <div class="mb-3 flex items-center justify-between gap-3">
                      <h3 class="text-sm font-bold text-(--text-primary)">
                        Process Design Kit
                      </h3>
                      <button
                        type="button"
                        class="inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-(--accent-color) transition-colors duration-200 hover:bg-(--accent-color)/10"
                        @click="handleImportPdk"
                      >
                        <i class="ri-add-line"></i>
                        Import PDK
                      </button>
                    </div>

                    <div
                      v-if="importedPdks.length > 0"
                      class="custom-scrollbar grid max-h-[132px] gap-2 overflow-y-auto pr-1 md:grid-cols-2"
                    >
                      <button
                        v-for="pdk in importedPdks"
                        :key="pdk.id"
                        type="button"
                        class="relative cursor-pointer rounded-lg border p-3 text-left transition-colors duration-200"
                        :class="
                          selectedPdkId === pdk.id
                            ? 'border-(--accent-color) bg-(--accent-color)/10'
                            : 'border-(--border-color) bg-(--bg-primary)/65 hover:border-(--accent-color)/45'
                        "
                        @click="selectPdk(pdk)"
                      >
                        <span class="mb-1 flex items-start justify-between gap-3">
                          <span>
                            <span class="block font-semibold text-(--text-primary)">{{
                              pdk.name
                            }}</span>
                            <span
                              v-if="pdk.techNode"
                              class="mt-1 inline-block rounded-md bg-(--bg-secondary) px-2 py-0.5 text-xs text-(--text-secondary)"
                              >{{ pdk.techNode }}</span
                            >
                          </span>
                          <i
                            v-if="selectedPdkId === pdk.id"
                            class="ri-checkbox-circle-fill text-xl text-green-500"
                          ></i>
                        </span>
                        <span
                          class="block truncate font-mono text-xs text-(--text-secondary)"
                          :title="pdk.path"
                          >{{ pdk.path }}</span
                        >
                        <button
                          v-if="selectedPdkId !== pdk.id"
                          type="button"
                          class="absolute top-3 right-3 flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-(--text-secondary) opacity-0 transition-colors duration-200 group-hover:opacity-100 hover:bg-red-500/10 hover:text-red-500"
                          title="Remove PDK"
                          @click.stop="handleRemovePdk(pdk.id)"
                        >
                          <i class="ri-delete-bin-line"></i>
                        </button>
                      </button>
                    </div>

                    <div
                      v-else
                      class="rounded-lg border border-dashed border-(--border-color) bg-(--bg-primary)/55 p-8 text-center"
                    >
                      <div
                        class="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-(--accent-color)/10 text-(--accent-color)"
                      >
                        <i class="ri-database-2-line text-2xl"></i>
                      </div>
                      <h4 class="font-semibold text-(--text-primary)">No PDK Imported</h4>
                      <button
                        type="button"
                        class="mt-4 inline-flex cursor-pointer items-center gap-2 rounded-lg bg-(--accent-color) px-5 py-2.5 text-sm font-semibold text-white transition-opacity duration-200 hover:opacity-90"
                        @click="handleImportPdk"
                      >
                        <i class="ri-folder-add-line"></i>
                        Select PDK Directory
                      </button>
                    </div>
                  </section>

                  <section
                    class="rounded-xl border border-(--border-color) bg-(--bg-secondary)/20 p-3"
                  >
                    <div class="mb-3">
                      <h3 class="text-sm font-bold text-(--text-primary)">Config Mode</h3>
                      <p class="mt-1 text-xs text-(--text-secondary)">
                        Default Config uses ECC default PDK config. Manual Config lets you
                        choose Tech LEF, Cell LEF, and Liberty.
                      </p>
                    </div>
                    <div class="grid gap-2 md:grid-cols-2">
                      <button
                        type="button"
                        class="flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-left transition-colors duration-200"
                        :class="
                          pdkConfigMode === 'default'
                            ? 'border-(--accent-color) bg-(--accent-color)/10'
                            : 'border-(--border-color) bg-(--bg-primary)/65 hover:border-(--accent-color)/45'
                        "
                        @click="pdkConfigMode = 'default'"
                      >
                        <span
                          class="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border"
                          :class="
                            pdkConfigMode === 'default'
                              ? 'border-(--accent-color) bg-(--accent-color) text-white'
                              : 'border-(--border-color) text-(--text-secondary)'
                          "
                        >
                          <i v-if="pdkConfigMode === 'default'" class="ri-check-line"></i>
                          <i v-else class="ri-circle-line"></i>
                        </span>
                        <span>
                          <span class="block text-sm font-bold text-(--text-primary)"
                            >Default Config</span
                          >
                          <span
                            class="mt-1 block text-xs leading-5 text-(--text-secondary)"
                            >Use ECC default PDK config for the selected PDK.</span
                          >
                        </span>
                      </button>

                      <button
                        type="button"
                        class="flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-left transition-colors duration-200"
                        :class="
                          pdkConfigMode === 'manual'
                            ? 'border-(--accent-color) bg-(--accent-color)/10'
                            : 'border-(--border-color) bg-(--bg-primary)/65 hover:border-(--accent-color)/45'
                        "
                        @click="pdkConfigMode = 'manual'"
                      >
                        <span
                          class="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border"
                          :class="
                            pdkConfigMode === 'manual'
                              ? 'border-(--accent-color) bg-(--accent-color) text-white'
                              : 'border-(--border-color) text-(--text-secondary)'
                          "
                        >
                          <i v-if="pdkConfigMode === 'manual'" class="ri-check-line"></i>
                          <i v-else class="ri-circle-line"></i>
                        </span>
                        <span>
                          <span class="block text-sm font-bold text-(--text-primary)"
                            >Manual Config</span
                          >
                          <span
                            class="mt-1 block text-xs leading-5 text-(--text-secondary)"
                            >Customize Tech LEF, Cell LEF, and Liberty.</span
                          >
                        </span>
                      </button>
                    </div>
                  </section>

                  <section
                    v-if="pdkConfigMode === 'default'"
                    class="rounded-xl border border-(--border-color) bg-(--bg-secondary)/20 p-3"
                  >
                    <div
                      class="rounded-lg border border-(--accent-color)/35 bg-(--accent-color)/10 p-4"
                    >
                      <div class="mb-3 flex items-center gap-3">
                        <div
                          class="flex h-10 w-10 items-center justify-center rounded-lg bg-(--accent-color) text-white"
                        >
                          <i class="ri-check-double-line text-xl"></i>
                        </div>
                        <div>
                          <h3 class="text-base font-bold text-(--text-primary)">
                            Use ECC default PDK config
                          </h3>
                          <p class="mt-1 text-sm text-(--text-secondary)">
                            Tech LEF, Cell LEF, and Liberty will be resolved by ECC
                            defaults for the selected PDK.
                          </p>
                        </div>
                      </div>
                      <p class="text-xs text-(--text-secondary)">
                        Switch to Manual Config only when this workspace needs a custom
                        PDK resource set.
                      </p>
                    </div>
                  </section>

                  <section
                    v-else
                    class="flex min-h-0 flex-col overflow-hidden rounded-xl border border-(--border-color) bg-(--bg-secondary)/20 p-3"
                  >
                    <div class="mb-3 flex items-start justify-between gap-4">
                      <div>
                        <h3 class="text-sm font-bold text-(--text-primary)">
                          Manual PDK Resources
                        </h3>
                        <p class="mt-1 text-xs text-(--text-secondary)">
                          Review each resource type on the left, then update the selection
                          from the current PDK folder when needed.
                        </p>
                      </div>
                      <span
                        class="rounded-md bg-(--bg-primary)/70 px-2 py-1 text-xs text-(--text-secondary)"
                      >
                        {{ activeManualPdkSelections.length }} selected
                      </span>
                    </div>

                    <div
                      class="pdk-manual-resource-shell grid min-h-0 flex-1 gap-3 overflow-hidden xl:grid-cols-[200px_minmax(0,1fr)]"
                    >
                      <aside class="pdk-resource-category-list grid content-start gap-2">
                        <button
                          v-for="item in pdkWizardSteps"
                          :key="item.key"
                          type="button"
                          class="flex cursor-pointer items-start justify-between gap-3 rounded-xl border px-3 py-3 text-left transition-colors duration-200"
                          :class="
                            activePdkWizardStep === item.key
                              ? 'border-(--accent-color) bg-(--accent-color)/10'
                              : 'border-(--border-color) bg-(--bg-primary)/65 hover:border-(--accent-color)/40'
                          "
                          @click="activePdkWizardStep = item.key"
                        >
                          <span class="min-w-0">
                            <span class="block text-sm font-bold text-(--text-primary)">{{
                              item.title
                            }}</span>
                            <span
                              class="mt-1 block text-xs leading-5 text-(--text-secondary)"
                              >{{ item.description }}</span
                            >
                          </span>
                          <span
                            class="shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold"
                            :class="
                              activePdkWizardStep === item.key
                                ? 'bg-(--accent-color) text-white'
                                : 'bg-(--bg-secondary)/60 text-(--text-secondary)'
                            "
                          >
                            {{ pdkSelections[item.key].length }}
                          </span>
                        </button>
                      </aside>

                      <section
                        class="pdk-resource-detail-panel flex min-h-0 flex-col rounded-xl border border-(--border-color) bg-(--bg-primary)/65 p-3"
                      >
                        <header class="mb-3 flex items-start justify-between gap-4">
                          <div class="min-w-0">
                            <h4 class="text-sm font-bold text-(--text-primary)">
                              {{ activePdkStep?.title }}
                            </h4>
                            <p class="mt-1 text-xs leading-5 text-(--text-secondary)">
                              {{ activePdkStep?.description }}
                            </p>
                          </div>
                          <button
                            type="button"
                            class="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-(--border-color) bg-(--bg-secondary)/45 text-(--text-secondary) transition-colors duration-200 hover:border-(--accent-color)/45 hover:bg-(--accent-color)/10 hover:text-(--text-primary)"
                            title="Update selection"
                            @click="
                              activePdkStep && openPdkResourcePicker(activePdkStep.key)
                            "
                          >
                            <i class="ri-refresh-line text-base"></i>
                          </button>
                        </header>

                        <div
                          class="flex min-h-0 flex-1 flex-col rounded-xl border border-(--border-color) bg-(--bg-secondary)/20 p-3"
                        >
                          <div class="mb-3 flex items-center justify-between gap-3">
                            <div>
                              <h5
                                class="text-xs font-bold tracking-wide text-(--text-secondary) uppercase"
                              >
                                Selected Files
                              </h5>
                            </div>
                            <span
                              class="rounded-md bg-(--bg-primary)/75 px-2 py-1 text-[11px] font-semibold text-(--text-secondary)"
                            >
                              {{ activeManualPdkSelections.length }}
                            </span>
                          </div>

                          <div
                            class="pdk-resource-selected-list custom-scrollbar min-h-0 flex-1 space-y-2 pr-1"
                          >
                            <p
                              v-if="activeManualPdkSelections.length === 0"
                              class="rounded-lg border border-dashed border-(--border-color) px-4 py-6 text-center text-xs text-(--text-secondary)"
                            >
                              No file selected.
                            </p>
                            <button
                              v-for="file in activeManualPdkSelections"
                              :key="file"
                              type="button"
                              class="flex w-full cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors duration-200"
                              :title="file"
                            >
                              <i
                                class="ri-file-list-3-line mt-0.5 shrink-0 text-(--accent-color)"
                              ></i>
                              <span class="min-w-0">
                                <span
                                  class="block truncate text-sm font-semibold text-(--text-primary)"
                                >
                                  {{ displayPdkResourceName(file) }}
                                </span>
                                <span
                                  class="mt-1 block font-mono text-[11px] leading-5 break-all text-(--text-secondary)"
                                >
                                  {{ file }}
                                </span>
                              </span>
                            </button>
                          </div>
                        </div>
                      </section>
                    </div>
                  </section>
                </div>
              </div>

              <div
                v-else-if="currentStep === 6"
                key="spec-setting"
                class="mx-auto w-full max-w-4xl"
              >
                <header class="mb-7">
                  <h2 class="text-2xl font-bold text-(--text-primary)">Spec Setting</h2>
                  <p class="mt-2 text-sm text-(--text-secondary)">
                    These values are saved into the workspace home parameters.json.
                  </p>
                </header>

                <p
                  v-if="isLoadingProjectManifest"
                  class="mb-5 text-sm text-(--text-secondary)"
                >
                  Loading project constraints...
                </p>

                <div
                  class="space-y-5 rounded-xl border border-(--border-color) bg-(--bg-secondary)/20 p-5"
                >
                  <div class="grid gap-5 md:grid-cols-2">
                    <div>
                      <label
                        class="mb-2 block text-sm font-semibold text-(--text-primary)"
                        >Design Name <span class="text-red-500">*</span></label
                      >
                      <input
                        v-model="config.parameters.design"
                        type="text"
                        placeholder="gcd"
                        class="w-full rounded-lg border border-(--border-color) bg-(--bg-primary)/75 px-3 py-2.5 text-sm text-(--text-primary) outline-none focus:border-(--accent-color)"
                        @input="designNameTouched = true"
                      />
                    </div>
                    <div>
                      <label
                        class="mb-2 block text-sm font-semibold text-(--text-primary)"
                        >Top Module Name <span class="text-red-500">*</span></label
                      >
                      <input
                        v-model="config.parameters.top_module"
                        type="text"
                        placeholder="top"
                        class="w-full rounded-lg border border-(--border-color) bg-(--bg-primary)/75 px-3 py-2.5 text-sm text-(--text-primary) outline-none focus:border-(--accent-color)"
                      />
                    </div>
                    <div>
                      <label
                        class="mb-2 block text-sm font-semibold text-(--text-primary)"
                        >Clock Signal Name <span class="text-red-500">*</span></label
                      >
                      <input
                        v-model="config.parameters.clock"
                        type="text"
                        placeholder="clk"
                        class="w-full rounded-lg border border-(--border-color) bg-(--bg-primary)/75 px-3 py-2.5 text-sm text-(--text-primary) outline-none focus:border-(--accent-color)"
                      />
                    </div>
                    <div>
                      <label
                        class="mb-2 block text-sm font-semibold text-(--text-primary)"
                        >Frequency max [MHz] <span class="text-red-500">*</span></label
                      >
                      <input
                        v-model.number="config.parameters.frequency_max"
                        type="number"
                        min="1"
                        step="1"
                        class="w-full rounded-lg border border-(--border-color) bg-(--bg-primary)/75 px-3 py-2.5 text-sm text-(--text-primary) outline-none focus:border-(--accent-color)"
                      />
                    </div>
                    <div>
                      <label
                        class="mb-2 block text-sm font-semibold text-(--text-primary)"
                        >Max Fanout <span class="text-red-500">*</span></label
                      >
                      <input
                        v-model.number="config.parameters.max_fanout"
                        type="number"
                        min="1"
                        step="1"
                        class="w-full rounded-lg border border-(--border-color) bg-(--bg-primary)/75 px-3 py-2.5 text-sm text-(--text-primary) outline-none focus:border-(--accent-color)"
                      />
                    </div>
                  </div>

                  <div
                    class="rounded-xl border border-(--border-color) bg-(--bg-primary)/65 p-4"
                  >
                    <div
                      v-if="projectMpc"
                      class="mb-4 rounded-lg border border-(--accent-color)/30 bg-(--accent-color)/8 px-3 py-2.5"
                    >
                      <p class="text-xs font-semibold text-(--text-primary)">
                        MPC core template: {{ projectMpc.display_name }} /
                        {{ projectMpc.design.design_name }}
                      </p>
                    </div>
                    <div class="mb-4 flex items-center justify-between gap-3">
                      <h3 class="text-sm font-bold text-(--text-primary)">Die Area</h3>
                      <div
                        class="inline-flex rounded-lg border border-(--border-color) bg-(--bg-secondary)/40 p-1"
                      >
                        <button
                          type="button"
                          class="rounded-md px-3 py-1.5 text-xs font-semibold transition-colors duration-200"
                          :class="
                            dieAreaMode === 'width_height'
                              ? 'bg-(--accent-color) text-white'
                              : 'text-(--text-secondary) hover:text-(--text-primary)'
                          "
                          @click="dieAreaMode = 'width_height'"
                        >
                          Width / Height
                        </button>
                        <button
                          type="button"
                          class="rounded-md px-3 py-1.5 text-xs font-semibold transition-colors duration-200"
                          :class="
                            dieAreaMode === 'utilitization_margin'
                              ? 'bg-(--accent-color) text-white'
                              : 'text-(--text-secondary) hover:text-(--text-primary)'
                          "
                          @click="dieAreaMode = 'utilitization_margin'"
                        >
                          Utilitization / Margin
                        </button>
                      </div>
                    </div>

                    <template v-if="dieAreaMode === 'width_height'">
                      <div class="grid gap-5 md:grid-cols-2">
                        <div>
                          <label
                            class="mb-2 block text-sm font-semibold text-(--text-primary)"
                            >Width</label
                          >
                          <input
                            v-model.number="config.parameters.die_width"
                            type="number"
                            min="1"
                            step="1"
                            class="w-full rounded-lg border border-(--border-color) bg-(--bg-secondary)/35 px-3 py-2.5 text-sm text-(--text-primary) outline-none focus:border-(--accent-color)"
                          />
                        </div>
                        <div>
                          <label
                            class="mb-2 block text-sm font-semibold text-(--text-primary)"
                            >Height</label
                          >
                          <input
                            v-model.number="config.parameters.die_height"
                            type="number"
                            min="1"
                            step="1"
                            class="w-full rounded-lg border border-(--border-color) bg-(--bg-secondary)/35 px-3 py-2.5 text-sm text-(--text-primary) outline-none focus:border-(--accent-color)"
                          />
                        </div>
                      </div>

                      <div
                        v-if="dieAreaMode === 'width_height' && projectMpc"
                        class="mt-4 space-y-1 text-xs text-(--text-secondary)"
                      >
                        <p>
                          MPC die-area bounds: min
                          {{
                            mpcDieAreaValidation.constraint.minimumArea ??
                            'not specified'
                          }}, max
                          {{
                            mpcDieAreaValidation.constraint.maximumArea ??
                            'not specified'
                          }}.
                        </p>
                        <p v-if="mpcDieAreaValidation.area !== null">
                          Current die area: {{ mpcDieAreaValidation.area }}.
                        </p>
                        <p
                          v-if="mpcDieAreaValidation.error"
                          role="alert"
                          class="font-medium text-red-600 dark:text-red-300"
                        >
                          {{ mpcDieAreaValidation.error }}
                        </p>
                      </div>
                    </template>

                    <div v-else class="grid gap-5 md:grid-cols-2">
                      <div>
                        <label
                          class="mb-2 block text-sm font-semibold text-(--text-primary)"
                          >Utilitization</label
                        >
                        <input
                          v-model.number="config.parameters.utilitization"
                          type="number"
                          min="0.01"
                          max="1"
                          step="0.01"
                          class="w-full rounded-lg border border-(--border-color) bg-(--bg-secondary)/35 px-3 py-2.5 text-sm text-(--text-primary) outline-none focus:border-(--accent-color)"
                        />
                      </div>
                      <div>
                        <label
                          class="mb-2 block text-sm font-semibold text-(--text-primary)"
                          >Margin</label
                        >
                        <input
                          v-model.number="config.parameters.margin"
                          type="number"
                          min="0"
                          step="1"
                          class="w-full rounded-lg border border-(--border-color) bg-(--bg-secondary)/35 px-3 py-2.5 text-sm text-(--text-primary) outline-none focus:border-(--accent-color)"
                        />
                      </div>
                    </div>
                    <p
                      v-if="dieAreaMode === 'utilitization_margin' && projectMpc"
                      class="mt-4 text-xs text-(--text-secondary)"
                    >
                      MPC die-area bounds are checked after the flow runs for this mode.
                    </p>
                  </div>

                  <div
                    class="rounded-xl border border-(--border-color) bg-(--bg-primary)/65 p-4"
                  >
                    <h3 class="text-sm font-bold text-(--text-primary)">
                      Placement Defaults
                    </h3>
                    <p class="mt-1 text-xs text-(--text-secondary)">
                      Passed to the initial placement configuration when the workspace is
                      created.
                    </p>
                    <div class="mt-4 grid gap-5 md:grid-cols-2">
                      <div>
                        <label
                          class="mb-2 block text-sm font-semibold text-(--text-primary)"
                          >Target Density</label
                        >
                        <input
                          v-model.number="config.parameters.target_density"
                          type="number"
                          min="0.1"
                          max="1"
                          step="0.01"
                          class="w-full rounded-lg border border-(--border-color) bg-(--bg-secondary)/35 px-3 py-2.5 text-sm text-(--text-primary) outline-none focus:border-(--accent-color)"
                        />
                      </div>
                      <div>
                        <label
                          class="mb-2 block text-sm font-semibold text-(--text-primary)"
                          >Target Overflow</label
                        >
                        <input
                          v-model.number="config.parameters.target_overflow"
                          type="number"
                          min="0.01"
                          max="1"
                          step="0.01"
                          class="w-full rounded-lg border border-(--border-color) bg-(--bg-secondary)/35 px-3 py-2.5 text-sm text-(--text-primary) outline-none focus:border-(--accent-color)"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </Transition>
          </section>

          <footer
            class="flex shrink-0 items-center justify-between border-t border-(--border-color) bg-(--bg-primary) px-6 py-4 md:px-8"
          >
            <button
              v-if="currentStep > 1"
              type="button"
              class="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-(--border-color) bg-(--bg-secondary)/45 px-4 py-2.5 text-sm font-semibold text-(--text-primary) transition-colors duration-200 hover:bg-(--bg-secondary)"
              @click="prevStep"
            >
              <i class="ri-arrow-left-line"></i>
              Back
            </button>
            <div v-else></div>

            <div class="flex items-center gap-3">
              <button
                type="button"
                class="cursor-pointer rounded-lg px-4 py-2.5 text-sm font-semibold text-(--text-secondary) transition-colors duration-200 hover:bg-(--bg-secondary)/55 hover:text-(--text-primary)"
                @click="closeWizard"
              >
                Cancel
              </button>
              <button
                v-if="currentStep < steps.length"
                type="button"
                class="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-(--accent-color) px-5 py-2.5 text-sm font-semibold text-white transition-opacity duration-200 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
                :disabled="!canProceed"
                @click="nextStep"
              >
                Continue
                <i class="ri-arrow-right-line"></i>
              </button>
              <button
                v-else
                type="button"
                class="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-(--accent-color) px-5 py-2.5 text-sm font-bold text-white transition-opacity duration-200 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
                :disabled="!canProceed || isCreating"
                @click="createWorkspace"
              >
                <i v-if="isCreating" class="ri-loader-4-line animate-spin"></i>
                <i v-else class="ri-rocket-line"></i>
                {{ isCreating ? 'Creating Workspace...' : 'Create Workspace' }}
              </button>
            </div>
          </footer>
        </main>
      </div>
    </div>
    <PdkResourcePickerDialog
      v-if="pdkResourcePickerOpen && activePdkStep"
      :resource-title="activePdkStep.title"
      :root-path="selectedPdk?.path || config.pdk_root || projectContext.project_root"
      :directories="detectedPdkDirectories"
      :available-files="detectedPdkFiles[activePdkWizardStep]"
      :selected-files="pdkSelections[activePdkWizardStep]"
      @update:selected-files="updatePdkResourceSelection"
      @close="closePdkResourcePicker"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Project, WorkspaceConfig } from '../types'
import { usePdkManager } from '../composables/usePdkManager'
import { useWorkspace } from '../composables/useWorkspace'
import { getDesktopApi } from '@/platform/desktop'
import { loadProjectHistory } from '@/utils/projectHistory'
import { readOptionalProjectTextFile } from '@/utils/projectFiles'
import {
  parseProjectManifest,
  type ProjectManifest,
  type ProjectManifestMpc,
} from '@/utils/projectManagement'
import { validateMpcDieArea } from '@/utils/mpcWorkspace'
import {
  isHdlFilePath,
  type DesktopFileDialogOptions,
  type PdkDetectedFiles,
  type PickedRtlSources,
} from '@ecos-studio/shared'
import DesignFileTransfer from './DesignFileTransfer.vue'
import PdkResourcePickerDialog from './PdkResourcePickerDialog.vue'

interface Emits {
  (e: 'close'): void
  (e: 'create', config: WorkspaceConfig): void
}

type WorkspaceWizardInitialConfig = Partial<WorkspaceConfig> & {
  managedWorkspaceRoot?: string
  deriveDirectoryFromDesign?: boolean
  lockWorkspaceDirectory?: boolean
  suggestedWorkspaceName?: string
}

interface Props {
  initialConfig?: WorkspaceWizardInitialConfig
  title?: string
}
type ProjectMode = 'select' | 'create'
type FlowStepName =
  | 'Synthesis'
  | 'Floorplan'
  | 'fixFanout'
  | 'place'
  | 'CTS'
  | 'legalization'
  | 'route'
  | 'drc'
  | 'filler'
  | 'RCX'
  | 'sta'
  | 'Harden'
type DesignInputKey = 'rtl' | 'filelist' | 'def' | 'verilog' | 'sdc'
type PdkResourceKey = 'tech_lef' | 'cell_lef' | 'liberty'
type DieAreaMode = 'width_height' | 'utilitization_margin'

interface ProjectContext {
  mode: ProjectMode
  project_name: string
  project_root: string
  project_json_path: string
}

interface DesignInputType {
  key: DesignInputKey
  label: string
  required: boolean
  description: string
}

interface PdkWizardStep {
  key: PdkResourceKey
  title: string
  description: string
}

interface SourceContext {
  projectName?: string
  workspaceId?: string
  workspaceName?: string
  workspacePath?: string
  step?: string
  outputPath?: string
  outputType?: string
  startStep?: string
}

const emit = defineEmits<Emits>()
const props = defineProps<Props>()
const wizardTitle = computed(() => props.title || 'New Workspace')

onMounted(() => {
  document.addEventListener('keydown', handleWizardKeydown)
  void loadProjectHistoryEntries()
  void applyProjectDefaultsForProject(projectContext.value.project_root)
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleWizardKeydown)
})

const currentStep = ref(1)
const highestStep = ref(1)
const isCreating = ref(false)
const isDraggingFiles = ref(false)
const isScanningDirectory = ref(false)
const directoryScanError = ref('')
const manualFilePickError = ref('')
const designFileError = ref('')
const rtlSourceDirectory = ref<string | null>(null)
const scannedRtlFiles = ref<string[]>([])
const directorySelectedFiles = ref<string[]>([])
const initialRtlFiles = uniquePaths([
  ...(props.initialConfig?.rtl_list ?? []),
  ...(props.initialConfig?.source_config?.rtl_list ?? []),
])
const initialFilelistPath =
  props.initialConfig?.filelist ?? props.initialConfig?.source_config?.filelist ?? ''
const manuallyAddedFiles = ref<string[]>([...initialRtlFiles])
const showBrowseMenu = ref(false)
const initialWorkspaceNameValue = initialWorkspaceName(props.initialConfig)
const workspaceName = ref(initialWorkspaceNameValue || defaultWorkspaceName())
const workspaceNameTouched = ref(initialWorkspaceNameValue !== '')
const projectHistory = ref<Project[]>([])
const isLoadingProjectHistory = ref(false)
const projectHistoryError = ref('')
const projectParentPath = ref(parentPath(initialProjectRoot(props.initialConfig)))
const designNameTouched = ref(
  String(props.initialConfig?.parameters?.design ?? '').trim() !== '',
)
const flowStartStep = ref<FlowStepName>(
  normalizeFlowStepName(
    props.initialConfig?.flow_config?.start_step ??
      props.initialConfig?.parameters?.start_step,
    'Synthesis',
  ),
)
const flowEndStep = ref<FlowStepName>(
  normalizeFlowStepName(
    props.initialConfig?.flow_config?.end_step ??
      props.initialConfig?.parameters?.end_step,
    'Harden',
  ),
)
const activeDesignInputType = ref<DesignInputKey>(
  initialDesignInputType(flowStartStep.value),
)
const pdkConfigMode = ref<'default' | 'manual'>(
  normalizePdkConfigMode(
    props.initialConfig?.pdk_config_mode ??
      props.initialConfig?.source_config?.pdk_config_mode,
  ),
)
const activePdkWizardStep = ref<PdkResourceKey>('tech_lef')
const pdkResourcePickerOpen = ref(false)
const filelistPath = ref(initialFilelistPath)
const sdcPath = ref(
  props.initialConfig?.sdc ?? props.initialConfig?.source_config?.sdc ?? '',
)
const dieAreaMode = ref<DieAreaMode>(
  normalizeDieAreaMode(props.initialConfig?.parameters?.die_area_mode),
)

const steps = [
  { id: 1, title: 'Project Setup' },
  { id: 2, title: 'Basic Info' },
  { id: 3, title: 'Flow Setup' },
  { id: 4, title: 'Design Files' },
  { id: 5, title: 'PDK Config' },
  { id: 6, title: 'Spec Setting' },
]

const hardenFlowSteps: Array<{ name: FlowStepName; description: string }> = [
  { name: 'Synthesis', description: 'RTL synthesis entry.' },
  { name: 'Floorplan', description: 'Initial floorplan and die setup.' },
  { name: 'fixFanout', description: 'Fanout repair before placement.' },
  { name: 'place', description: 'Standard cell placement.' },
  { name: 'CTS', description: 'Clock tree synthesis.' },
  { name: 'legalization', description: 'Placement legalization.' },
  { name: 'route', description: 'Detailed routing.' },
  { name: 'drc', description: 'Design rule checking.' },
  { name: 'filler', description: 'Filler insertion.' },
  { name: 'RCX', description: 'Parasitic extraction.' },
  { name: 'sta', description: 'Static timing analysis.' },
  { name: 'Harden', description: 'Final harden output.' },
]

const pdkWizardSteps: PdkWizardStep[] = [
  {
    key: 'tech_lef',
    title: 'Tech LEF',
    description: 'Technology LEF files used by the flow.',
  },
  {
    key: 'cell_lef',
    title: 'Cell LEF',
    description: 'Cell LEF files selected from the PDK.',
  },
  {
    key: 'liberty',
    title: 'Liberty',
    description: 'Timing library files selected from the PDK.',
  },
]

const projectContext = ref<ProjectContext>(
  createInitialProjectContext(props.initialConfig),
)

const config = ref<WorkspaceConfig>(createInitialConfig(props.initialConfig))
const projectMpc = ref<ProjectManifestMpc | null>(null)
const projectManifestError = ref('')
const isLoadingProjectManifest = ref(false)
let projectManifestLoadGeneration = 0
const mpcDieAreaValidation = computed(() =>
  validateMpcDieArea(
    projectMpc.value,
    dieAreaMode.value,
    config.value.parameters.die_width,
    config.value.parameters.die_height,
  ),
)
const sourceContext = computed<SourceContext | null>(() => {
  const context = props.initialConfig?.source_context
  if (!context?.workspaceId && !context?.workspacePath && !context?.step) return null
  return context
})
const managedWorkspaceRoot = computed(() =>
  normalizePath(props.initialConfig?.managedWorkspaceRoot ?? ''),
)
const lockWorkspaceDirectory = computed(() =>
  Boolean(props.initialConfig?.lockWorkspaceDirectory && props.initialConfig?.directory),
)
const shouldDeriveManagedDirectory = computed(() =>
  Boolean(props.initialConfig?.deriveDirectoryFromDesign && managedWorkspaceRoot.value),
)
const managedWorkspacePreview = computed(() => {
  if (!shouldDeriveManagedDirectory.value) return ''
  return deriveManagedWorkspacePath(workspaceName.value.trim() || '<workspace_name>')
})

const { importedPdks, loadPdks, importPdk: doImportPdk, removePdk } = usePdkManager()
const { showToast } = useWorkspace()
const selectedPdkId = ref<string>(
  props.initialConfig?.pdk ?? props.initialConfig?.source_config?.pdk ?? '',
)
const hasLoadedPdks = ref(false)

const pdkSelections = ref<Record<PdkResourceKey, string[]>>({
  tech_lef: [
    ...(props.initialConfig?.pdk_config?.tech_lef ??
      props.initialConfig?.source_config?.pdk_config?.tech_lef ??
      []),
  ],
  cell_lef: [
    ...(props.initialConfig?.pdk_config?.cell_lef ??
      props.initialConfig?.source_config?.pdk_config?.cell_lef ??
      []),
  ],
  liberty: [
    ...(props.initialConfig?.pdk_config?.liberty ??
      props.initialConfig?.source_config?.pdk_config?.liberty ??
      []),
  ],
})

function createInitialConfig(
  initialConfig?: WorkspaceWizardInitialConfig,
): WorkspaceConfig {
  const source_config = initialConfig?.source_config
  const startStep = flowStartStep.value
  const endStep = flowEndStep.value
  const defaultPdkConfig = {
    mode: pdkConfigMode.value,
    tech_lef: [],
    cell_lef: [],
    liberty: [],
  }
  const defaultPdkConfigMode = {
    pdk_config_mode: 'default' as const,
  }

  return {
    directory: normalizePath(
      initialConfig?.directory ??
        joinPath(projectContext.value.project_root, workspaceName.value),
    ),
    pdk: initialConfig?.pdk ?? source_config?.pdk ?? 'ics55',
    pdk_root: initialConfig?.pdk_root ?? source_config?.pdk_root ?? '',
    parameters: {
      design: '',
      description: '',
      top_module: '',
      clock: '',
      frequency_max: 50,
      max_fanout: 32,
      die_area_mode: dieAreaMode.value,
      die_width: 100,
      die_height: 100,
      utilitization: 0.6,
      margin: 0,
      target_density: 0.2,
      target_overflow: 0.1,
      ...source_config?.parameters,
      ...initialConfig?.parameters,
    },
    origin_def:
      startStep === 'Synthesis' || startStep === 'Floorplan'
        ? ''
        : (initialConfig?.origin_def ?? source_config?.origin_def ?? ''),
    origin_verilog: initialConfig?.origin_verilog ?? source_config?.origin_verilog ?? '',
    rtl_list: initialConfig?.rtl_list
      ? [...initialConfig.rtl_list]
      : source_config?.rtl_list
        ? [...source_config.rtl_list]
        : [],
    filelist: initialConfig?.filelist ?? source_config?.filelist ?? filelistPath.value,
    design_input_mode: startStep === 'Synthesis' ? 'rtl' : 'post_synthesis',
    sdc: initialConfig?.sdc ?? source_config?.sdc ?? sdcPath.value,
    pdk_config_mode:
      initialConfig?.pdk_config_mode ??
      source_config?.pdk_config_mode ??
      defaultPdkConfigMode.pdk_config_mode,
    flow_config: initialConfig?.flow_config ?? {
      start_step: startStep,
      end_step: endStep,
      steps: flowStepsBetween(startStep, endStep),
    },
    pdk_config:
      initialConfig?.pdk_config ?? source_config?.pdk_config ?? defaultPdkConfig,
    pdk_json: initialConfig?.pdk_json ?? source_config?.pdk_json ?? '',
    mpc: initialConfig?.mpc ?? source_config?.mpc ?? null,
    project_context: initialConfig?.project_context ?? projectContext.value,
    source_context: initialConfig?.source_context,
    source_config,
  }
}

function createInitialProjectContext(
  initialConfig?: WorkspaceWizardInitialConfig,
): ProjectContext {
  const projectRoot = initialProjectRoot(initialConfig)
  return {
    mode: 'select',
    project_name: projectRoot ? getFileName(projectRoot) : '',
    project_root: projectRoot,
    project_json_path: projectRoot ? joinPath(projectRoot, 'project.json') : '',
  }
}

function initialProjectRoot(initialConfig?: WorkspaceWizardInitialConfig) {
  if (initialConfig?.managedWorkspaceRoot) {
    return normalizePath(initialConfig.managedWorkspaceRoot)
  }
  if (initialConfig?.directory) {
    return parentPath(initialConfig.directory)
  }
  return ''
}

function initialWorkspaceName(initialConfig?: WorkspaceWizardInitialConfig) {
  if (initialConfig?.directory) {
    return getFileName(initialConfig.directory)
  }
  return (
    initialConfig?.suggestedWorkspaceName ??
    String(initialConfig?.parameters?.design ?? '').trim()
  )
}

function defaultWorkspaceName() {
  return nextWorkspaceName([])
}

function nextWorkspaceNameForProject(manifest: ProjectManifest | null) {
  return manifest
    ? nextWorkspaceName(workspaceNamesFromManifest(manifest))
    : defaultWorkspaceName()
}

function workspaceNamesFromManifest(manifest: ProjectManifest) {
  return manifest.workspaces.flatMap((workspace) => [
    workspace.workspace_id,
    getFileName(workspace.workspace_path),
  ])
}

function nextWorkspaceName(workspaceNames: string[]) {
  const numbers = workspaceNames
    .map((name) => /^ws_(\d+)$/.exec(name)?.[1])
    .filter((value): value is string => Boolean(value))
    .map(Number)
    .filter(Number.isFinite)
  const next = Math.max(0, ...numbers) + 1
  return `ws_${String(next).padStart(4, '0')}`
}

async function readProjectManifestForProject(
  projectRoot: string,
): Promise<ProjectManifest | null> {
  const root = normalizePath(projectRoot)
  if (!root) return null
  const manifestText = await readOptionalProjectTextFile('project.json', {
    projectPath: root,
  })
  if (!manifestText) return null
  return parseProjectManifest(manifestText)
}

const SYSTEM_PARAMETER_DEFAULTS: Record<string, number> = {
  frequency_max: 50,
  max_fanout: 32,
  die_width: 100,
  die_height: 100,
  utilitization: 0.6,
  margin: 0,
}

function initialDesignInputType(startStep: FlowStepName): DesignInputKey {
  if (startStep === 'Floorplan') return 'verilog'
  if (startStep !== 'Synthesis') return 'def'
  return initialRtlFiles.length > 0 || !initialFilelistPath ? 'rtl' : 'filelist'
}

function parentPath(path: string) {
  const normalized = normalizePath(path)
  const parts = normalized.split('/').filter(Boolean)
  if (parts.length <= 1) return normalized.startsWith('/') ? '/' : ''
  const parent = parts.slice(0, -1).join('/')
  return normalized.startsWith('/') ? `/${parent}` : parent
}

function normalizePath(path: string) {
  return path.replace(/\\/g, '/').replace(/\/+$/g, '')
}

function normalizeFlowStepName(value: unknown, fallback: FlowStepName): FlowStepName {
  const candidate = String(value ?? '')
  const aliases: Record<string, FlowStepName> = {
    synth: 'Synthesis',
    synthesis: 'Synthesis',
    floor: 'Floorplan',
    floorplan: 'Floorplan',
    fanout: 'fixFanout',
    fixfanout: 'fixFanout',
    place: 'place',
    placement: 'place',
    cts: 'CTS',
    legal: 'legalization',
    legalization: 'legalization',
    route: 'route',
    drc: 'drc',
    filler: 'filler',
    rcx: 'RCX',
    sta: 'sta',
    harden: 'Harden',
  }
  const alias = aliases[candidate.toLowerCase()]
  if (alias) return alias
  const validSteps: FlowStepName[] = [
    'Synthesis',
    'Floorplan',
    'fixFanout',
    'place',
    'CTS',
    'legalization',
    'route',
    'drc',
    'filler',
    'RCX',
    'sta',
    'Harden',
  ]
  return validSteps.includes(candidate as FlowStepName)
    ? (candidate as FlowStepName)
    : fallback
}

function normalizeDieAreaMode(value: unknown): DieAreaMode {
  return value === 'width_height' ? 'width_height' : 'utilitization_margin'
}

function normalizePdkConfigMode(value: unknown): 'default' | 'manual' {
  return value === 'manual' ? 'manual' : 'default'
}

function flowStepsBetween(startStep: FlowStepName, endStep: FlowStepName) {
  const startIndex = hardenFlowSteps.findIndex((step) => step.name === startStep)
  const endIndex = hardenFlowSteps.findIndex((step) => step.name === endStep)
  const start = Math.min(startIndex, endIndex)
  const end = Math.max(startIndex, endIndex)
  return hardenFlowSteps.slice(start, end + 1).map((step) => step.name)
}

function deriveManagedWorkspacePath(workspaceName: string) {
  return joinPath(managedWorkspaceRoot.value, workspaceName)
}

function syncManagedWorkspaceDirectory() {
  if (!shouldDeriveManagedDirectory.value) return
  projectContext.value.project_root = managedWorkspaceRoot.value
  projectContext.value.project_name =
    projectContext.value.project_name || getFileName(managedWorkspaceRoot.value)
  projectContext.value.project_json_path = joinPath(
    managedWorkspaceRoot.value,
    'project.json',
  )
  syncWorkspaceConfig()
}
const CHINESE_CHAR_RE = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/
const HAS_SPACE_RE = /\s/
const DIRECTORY_UPLOAD_FAILURE_MESSAGE =
  'Folders cannot be uploaded from Select RTL files. Use Select design folder to scan a folder.'

const projectNameError = computed(() =>
  validateName(projectContext.value.project_name, 'Project name'),
)
const workspaceNameError = computed(() =>
  validateName(workspaceName.value, 'Workspace name'),
)
const workspaceLocation = computed(() =>
  lockWorkspaceDirectory.value && props.initialConfig?.directory
    ? normalizePath(props.initialConfig.directory)
    : joinPath(projectContext.value.project_root, workspaceName.value),
)
const workspaceLocationError = computed(() => {
  if (!workspaceLocation.value) return ''
  if (HAS_SPACE_RE.test(workspaceLocation.value))
    return 'Workspace location cannot contain spaces'
  if (CHINESE_CHAR_RE.test(workspaceLocation.value))
    return 'Workspace location cannot contain Chinese characters'
  return ''
})

const flowStartIndex = computed(() =>
  hardenFlowSteps.findIndex((step) => step.name === flowStartStep.value),
)
const flowEndIndex = computed(() =>
  hardenFlowSteps.findIndex((step) => step.name === flowEndStep.value),
)
const lockedFlowStepNames = computed(() => {
  if (!sourceContext.value?.startStep) return []
  const startStep = normalizeFlowStepName(
    sourceContext.value.startStep,
    flowStartStep.value,
  )
  const startIndex = hardenFlowSteps.findIndex((step) => step.name === startStep)
  if (startIndex <= 0) return []
  return hardenFlowSteps.slice(0, startIndex).map((step) => step.name)
})
const selectedFlowSteps = computed(() => {
  const start = Math.min(flowStartIndex.value, flowEndIndex.value)
  const end = Math.max(flowStartIndex.value, flowEndIndex.value)
  return hardenFlowSteps.slice(start, end + 1).map((step) => step.name)
})
const startsFromSynthesis = computed(() => flowStartStep.value === 'Synthesis')
const startsFromFloorplan = computed(() => flowStartStep.value === 'Floorplan')
const hasSelectedPdkConfig = computed(
  () =>
    selectedPdkId.value.trim() !== '' ||
    config.value.pdk.trim() !== '' ||
    config.value.pdk_root.trim() !== '',
)

const designInputTypes = computed<DesignInputType[]>(() => {
  if (startsFromSynthesis.value) {
    return [
      {
        key: 'rtl',
        label: 'RTL',
        required: true,
        description: 'Import RTL source files or scan an RTL source folder.',
      },
      {
        key: 'filelist',
        label: 'Filelist',
        required: false,
        description:
          'Use an existing filelist instead of manually selecting every RTL file.',
      },
      {
        key: 'sdc',
        label: 'SDC',
        required: false,
        description: 'Import optional timing constraints.',
      },
    ]
  }

  if (startsFromFloorplan.value) {
    return [
      {
        key: 'verilog',
        label: 'Verilog',
        required: true,
        description: 'Import the synthesized Verilog netlist for floorplan.',
      },
      {
        key: 'sdc',
        label: 'SDC',
        required: false,
        description: 'Import optional timing constraints.',
      },
    ]
  }

  return [
    {
      key: 'def',
      label: 'DEF',
      required: true,
      description: 'Import the starting DEF file for post-synthesis flow.',
    },
    {
      key: 'verilog',
      label: 'Verilog',
      required: true,
      description: 'Import the synthesized Verilog netlist.',
    },
    {
      key: 'sdc',
      label: 'SDC',
      required: false,
      description: 'Import optional timing constraints.',
    },
  ]
})

const activeDesignInput = computed(() =>
  designInputTypes.value.find((item) => item.key === activeDesignInputType.value),
)
const activePdkStep = computed(() =>
  pdkWizardSteps.find((item) => item.key === activePdkWizardStep.value),
)
const selectedPdk = computed(() =>
  importedPdks.value.find((pdk) => pdk.id === selectedPdkId.value),
)
const manualPdkDetectedFiles = ref<PdkDetectedFiles | null>(null)
const currentPdkDetectedFiles = computed<PdkDetectedFiles>(
  () =>
    manualPdkDetectedFiles.value ??
    selectedPdk.value?.detectedFiles ?? { directories: [], files: [] },
)
const detectedPdkDirectories = computed(() => currentPdkDetectedFiles.value.directories)
const activeManualPdkSelections = computed(
  () => pdkSelections.value[activePdkWizardStep.value] ?? [],
)

const detectedPdkFiles = computed<Record<PdkResourceKey, string[]>>(() => {
  const files = currentPdkDetectedFiles.value.files
  const resolvedFiles = files.map((file) => resolvePdkFile(file))
  const lefFiles = resolvedFiles.filter((file) => hasExtension(file, ['lef']))
  const techLefFiles = lefFiles.filter((file) => isTechLefFile(file))
  return {
    tech_lef: techLefFiles.length > 0 ? techLefFiles : lefFiles,
    cell_lef: lefFiles.filter((file) => !techLefFiles.includes(file)),
    liberty: resolvedFiles.filter((file) => hasExtension(file, ['lib', 'liberty'])),
  }
})

const canProceed = computed(() => {
  switch (currentStep.value) {
    case 1:
      return (
        projectContext.value.project_root.trim() !== '' &&
        projectContext.value.project_name.trim() !== '' &&
        !projectNameError.value
      )
    case 2:
      return (
        workspaceName.value.trim() !== '' &&
        workspaceLocation.value.trim() !== '' &&
        !workspaceNameError.value &&
        !workspaceLocationError.value
      )
    case 3:
      return selectedFlowSteps.value.length > 0
    case 4:
      return designFilesReady()
    case 5:
      if (!hasSelectedPdkConfig.value) return false
      if (pdkConfigMode.value === 'default') return true
      return (
        pdkSelections.value.tech_lef.length > 0 &&
        pdkSelections.value.cell_lef.length > 0 &&
        pdkSelections.value.liberty.length > 0
      )
    case 6:
      return specReady()
    default:
      return true
  }
})

watch(
  projectContext,
  () => {
    if (projectContext.value.mode === 'create') {
      projectContext.value.project_root = joinPath(
        projectParentPath.value,
        projectContext.value.project_name,
      )
    }
    projectContext.value.project_json_path = projectContext.value.project_root
      ? joinPath(projectContext.value.project_root, 'project.json')
      : ''
    syncWorkspaceConfig()
  },
  { deep: true },
)

watch(managedWorkspaceRoot, syncManagedWorkspaceDirectory, { immediate: true })

watch(projectParentPath, () => {
  if (projectContext.value.mode === 'create') {
    projectContext.value.project_root = joinPath(
      projectParentPath.value,
      projectContext.value.project_name,
    )
  }
})

watch(workspaceName, (nextName) => {
  if (!designNameTouched.value) {
    config.value.parameters.design = nextName
  }
  syncWorkspaceConfig()
})

watch([flowStartStep, flowEndStep], () => {
  if (!designInputTypes.value.some((item) => item.key === activeDesignInputType.value)) {
    activeDesignInputType.value = designInputTypes.value[0]?.key ?? 'rtl'
  }
  if (startsFromSynthesis.value) {
    config.value.origin_def = ''
    config.value.origin_verilog = ''
  } else {
    config.value.rtl_list = []
    filelistPath.value = ''
    if (startsFromFloorplan.value) {
      config.value.origin_def = ''
    }
  }
  syncWorkspaceConfig()
})

watch(dieAreaMode, (mode) => {
  config.value.parameters.die_area_mode = mode
  syncWorkspaceConfig()
})

watch(pdkConfigMode, syncWorkspaceConfig)
watch(pdkSelections, syncWorkspaceConfig, { deep: true })

function validateName(name: string, label: string) {
  if (!name) return ''
  if (HAS_SPACE_RE.test(name)) return `${label} cannot contain spaces`
  if (CHINESE_CHAR_RE.test(name)) return `${label} cannot contain Chinese characters`
  return ''
}

function joinPath(...parts: Array<string | undefined | null>) {
  const cleaned = parts.map((part) => (part || '').trim()).filter(Boolean)
  if (cleaned.length === 0) return ''
  const [first, ...rest] = cleaned
  return [
    first.replace(/\/+$/, ''),
    ...rest.map((part) => part.replace(/^\/+|\/+$/g, '')),
  ]
    .filter(Boolean)
    .join('/')
}

function getFileName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() || path
}

function displayPdkResourceName(path: string): string {
  return getFileName(path)
}

function uniquePaths(paths: string[]) {
  return [...new Set(paths.filter(Boolean))]
}

function hasExtension(path: string, extensions: string[]) {
  const lower = path.toLowerCase()
  return extensions.some((extension) => lower.endsWith(`.${extension.toLowerCase()}`))
}

function isTechLefFile(path: string) {
  const lower = path.replace(/\\/g, '/').toLowerCase()
  return (
    lower.includes('/prtech/') ||
    lower.includes('/techlef/') ||
    lower.includes('/tech_lef/') ||
    lower.includes('/tlef/') ||
    /(^|[/\\])(tech|technology|tlef|.*tech.*)\.lef$/i.test(path) ||
    /tech/i.test(getFileName(path))
  )
}

function resolvePdkFile(file: string) {
  if (file.startsWith('/') || /^[A-Za-z]:[\\/]/.test(file)) return file
  const root = getCurrentPdkRoot()
  return root ? joinPath(root, file) : file
}

function getCurrentPdkRoot() {
  return selectedPdk.value?.path || config.value.pdk_root || ''
}

async function loadProjectHistoryEntries() {
  isLoadingProjectHistory.value = true
  projectHistoryError.value = ''
  try {
    projectHistory.value = await loadProjectHistory()
  } catch (error) {
    console.warn('Failed to load project history for New Workspace wizard.', error)
    projectHistoryError.value = 'Recent projects are unavailable.'
  } finally {
    isLoadingProjectHistory.value = false
  }
}

async function applyProjectDefaultsForProject(projectRoot: string) {
  const loadGeneration = ++projectManifestLoadGeneration
  projectMpc.value = null
  projectManifestError.value = ''
  isLoadingProjectManifest.value = true

  let manifest: ProjectManifest | null = null
  try {
    manifest = await readProjectManifestForProject(projectRoot)
  } catch (error) {
    if (loadGeneration !== projectManifestLoadGeneration) return
    console.warn('Failed to read project manifest for New Workspace defaults.', error)
    projectManifestError.value =
      "The selected project's project.json could not be read. Resolve it before creating a workspace."
    isLoadingProjectManifest.value = false
    syncWorkspaceConfig()
    return
  }
  if (loadGeneration !== projectManifestLoadGeneration) return

  if (!lockWorkspaceDirectory.value && !workspaceNameTouched.value) {
    workspaceName.value = nextWorkspaceNameForProject(manifest)
  }
  if (manifest) {
    applyProjectManifestDefaults(manifest)
  }
  projectMpc.value = manifest?.mpc ?? null
  isLoadingProjectManifest.value = false
  syncWorkspaceConfig()
}

function applyProjectManifestDefaults(manifest: ProjectManifest) {
  const baseDesign = manifest.base_design
  const baseDesignRecord = baseDesign as ProjectManifest['base_design'] &
    Record<string, unknown>
  const parameters = isRecord(baseDesign.parameters) ? baseDesign.parameters : {}

  applyProjectFlowDefaults(baseDesignRecord, parameters)

  if (baseDesign.pdk && !hasInitialConfigValue('pdk')) {
    config.value.pdk = baseDesign.pdk
    selectedPdkId.value = baseDesign.pdk
  }
  if (baseDesign.pdk_root && !hasInitialConfigValue('pdk_root')) {
    config.value.pdk_root = baseDesign.pdk_root
  }

  applyProjectDesignFileDefaults(baseDesignRecord, parameters)
  applyProjectPdkResourceDefaults(baseDesignRecord)
  applyProjectParameterDefaults(manifest, parameters)
}

function applyProjectFlowDefaults(
  baseDesign: Record<string, unknown>,
  parameters: Record<string, unknown>,
) {
  if (props.initialConfig?.flow_config || props.initialConfig?.source_context) return

  const nextStart = firstString(parameters.start_step, baseDesign.start_step)
  const nextEnd = firstString(parameters.end_step, baseDesign.end_step)
  if (nextStart) {
    flowStartStep.value = normalizeFlowStepName(nextStart, flowStartStep.value)
  }
  if (nextEnd) {
    flowEndStep.value = normalizeFlowStepName(nextEnd, flowEndStep.value)
  }
  activeDesignInputType.value = initialDesignInputType(flowStartStep.value)
}

function applyProjectDesignFileDefaults(
  baseDesign: ProjectManifest['base_design'] & Record<string, unknown>,
  parameters: Record<string, unknown>,
) {
  if (
    startsFromSynthesis.value &&
    Array.isArray(baseDesign.rtl_list) &&
    baseDesign.rtl_list.length > 0 &&
    !hasInitialRtlList()
  ) {
    const rtlList = uniquePaths(baseDesign.rtl_list)
    manuallyAddedFiles.value = rtlList
    config.value.rtl_list = rtlList
  }

  const projectFilelist = firstString(baseDesign.filelist, parameters.filelist)
  if (
    startsFromSynthesis.value &&
    projectFilelist &&
    !filelistPath.value &&
    !hasInitialConfigValue('filelist')
  ) {
    filelistPath.value = projectFilelist
  }

  const projectSdc = firstString(baseDesign.sdc, parameters.sdc)
  if (projectSdc && !sdcPath.value && !hasInitialConfigValue('sdc')) {
    sdcPath.value = projectSdc
  }

  if (
    !startsFromSynthesis.value &&
    !config.value.origin_verilog &&
    baseDesign.origin_verilog &&
    !hasInitialConfigValue('origin_verilog')
  ) {
    config.value.origin_verilog = baseDesign.origin_verilog
  }
  if (
    !startsFromSynthesis.value &&
    !startsFromFloorplan.value &&
    !config.value.origin_def &&
    baseDesign.origin_def &&
    !hasInitialConfigValue('origin_def')
  ) {
    config.value.origin_def = baseDesign.origin_def
  }
}

function applyProjectPdkResourceDefaults(baseDesign: Record<string, unknown>) {
  const projectPdkConfig = baseDesign.pdk_config
  if (!isRecord(projectPdkConfig) || hasInitialConfigValue('pdk_config')) return

  const mode = firstString(baseDesign.pdk_config_mode, projectPdkConfig.mode)
  if (mode === 'manual' || mode === 'default') {
    pdkConfigMode.value = mode
  }
  pdkSelections.value = {
    tech_lef: stringArray(projectPdkConfig.tech_lef),
    cell_lef: stringArray(projectPdkConfig.cell_lef),
    liberty: stringArray(projectPdkConfig.liberty),
  }
}

function applyProjectParameterDefaults(
  manifest: ProjectManifest,
  parameters: Record<string, unknown>,
) {
  setStringParameterDefault(
    'top_module',
    firstString(
      parameters.top_module,
      parameters.Top,
      parameters['Top Module'],
      manifest.base_design.top_module,
    ),
  )
  setStringParameterDefault(
    'clock',
    firstString(parameters.clock, parameters.Clock, manifest.base_design.clock),
  )
  setStringParameterDefault(
    'design',
    firstString(parameters.design, parameters.Design, manifest.name),
  )

  setNumberParameterDefault(
    'frequency_max',
    firstNumber(parameters.frequency_max, parameters['Frequency max [MHz]']),
  )
  setNumberParameterDefault(
    'max_fanout',
    firstNumber(parameters.max_fanout, parameters['Max Fanout']),
  )
  setNumberParameterDefault(
    'die_width',
    firstNumber(parameters.die_width, parameters['Die Width']),
  )
  setNumberParameterDefault(
    'die_height',
    firstNumber(parameters.die_height, parameters['Die Height']),
  )
  setNumberParameterDefault(
    'utilitization',
    firstNumber(
      parameters.utilitization,
      parameters.core_utilization,
      parameters['Core Utilization'],
    ),
  )
  setNumberParameterDefault('margin', firstNumber(parameters.margin, parameters.Margin))

  const projectDieAreaMode = firstString(parameters.die_area_mode)
  if (
    (projectDieAreaMode === 'width_height' ||
      projectDieAreaMode === 'utilitization_margin') &&
    !hasInitialParameterValue('die_area_mode')
  ) {
    dieAreaMode.value = projectDieAreaMode
  }
}

function setStringParameterDefault(key: string, value: unknown) {
  const nextValue = firstString(value)
  if (!nextValue || hasInitialParameterValue(key)) return

  if (key === 'design') {
    if (!designNameTouched.value) {
      config.value.parameters.design = nextValue
      designNameTouched.value = true
    }
    return
  }

  const currentValue = String(config.value.parameters[key] ?? '').trim()
  if (!currentValue) {
    config.value.parameters[key] = nextValue
  }
}

function setNumberParameterDefault(key: string, value: unknown) {
  const nextValue = firstNumber(value)
  if (nextValue === null || hasInitialParameterValue(key)) return

  const currentValue = config.value.parameters[key]
  const defaultValue = SYSTEM_PARAMETER_DEFAULTS[key]
  if (
    currentValue === undefined ||
    currentValue === '' ||
    Number(currentValue) === defaultValue
  ) {
    config.value.parameters[key] = nextValue
  }
}

function hasInitialConfigValue(key: keyof WorkspaceConfig) {
  return (
    props.initialConfig?.[key] !== undefined ||
    props.initialConfig?.source_config?.[key] !== undefined
  )
}

function hasInitialParameterValue(key: string) {
  return (
    props.initialConfig?.parameters?.[key] !== undefined ||
    props.initialConfig?.source_config?.parameters?.[key] !== undefined
  )
}

function hasInitialRtlList() {
  return (
    (props.initialConfig?.rtl_list?.length ?? 0) > 0 ||
    (props.initialConfig?.source_config?.rtl_list?.length ?? 0) > 0
  )
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return ''
}

function firstNumber(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) return parsed
    }
  }
  return null
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter(
        (item): item is string => typeof item === 'string' && item.trim() !== '',
      )
    : []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function setProjectMode(mode: ProjectMode) {
  projectContext.value.mode = mode
  if (mode === 'create') {
    projectManifestLoadGeneration += 1
    projectMpc.value = null
    projectManifestError.value = ''
    isLoadingProjectManifest.value = false
    projectContext.value.project_root = joinPath(
      projectParentPath.value,
      projectContext.value.project_name,
    )
    syncWorkspaceConfig()
  }
  if (mode === 'select') {
    void applyProjectDefaultsForProject(projectContext.value.project_root)
  }
}

async function selectProjectFromHistory(project: Project) {
  const projectRoot = normalizePath(project.path)
  projectContext.value.mode = 'select'
  projectContext.value.project_root = projectRoot
  projectContext.value.project_name = project.name || getFileName(projectRoot)
  projectContext.value.project_json_path = joinPath(projectRoot, 'project.json')
  await applyProjectDefaultsForProject(projectRoot)
}

async function selectProjectRoot() {
  const result = await getDesktopApi().dialog.pickDirectory({
    title: 'Select Project Root',
  })
  if (!result) return
  const projectRoot = normalizePath(result)
  projectContext.value.mode = 'select'
  projectContext.value.project_root = projectRoot
  projectContext.value.project_name = getFileName(projectRoot)
  projectContext.value.project_json_path = joinPath(projectRoot, 'project.json')
  await applyProjectDefaultsForProject(projectRoot)
}

async function selectProjectParentPath() {
  const result = await getDesktopApi().dialog.pickDirectory({
    title: 'Select Project Parent Path',
  })
  if (!result) return
  projectParentPath.value = result
}

function isFlowStepSelected(stepName: FlowStepName) {
  return selectedFlowSteps.value.includes(stepName)
}

function setFlowBoundary(stepName: FlowStepName) {
  if (isFlowStepLocked(stepName)) return
  const index = hardenFlowSteps.findIndex((step) => step.name === stepName)
  if (index < 0) return

  const start = flowStartIndex.value
  const end = flowEndIndex.value
  const nextEndIndex = index === end && end > start ? end - 1 : index
  const boundedEndIndex = Math.max(start, nextEndIndex)
  flowEndStep.value = hardenFlowSteps[boundedEndIndex].name
}

async function ensurePdksLoaded() {
  if (hasLoadedPdks.value) return
  hasLoadedPdks.value = true
  await loadPdks()
  if (config.value.pdk || config.value.pdk_root) {
    const matchedPdk = importedPdks.value.find(
      (pdk) =>
        pdk.id === selectedPdkId.value ||
        pdk.pdkId === config.value.pdk ||
        pdk.path === config.value.pdk_root,
    )
    if (matchedPdk) {
      selectPdk(matchedPdk)
      return
    }
  }
  if (importedPdks.value.length === 1) {
    selectPdk(importedPdks.value[0])
  }
}

function isFlowStepLocked(stepName: FlowStepName) {
  return lockedFlowStepNames.value.includes(stepName)
}

function applySourceWorkspaceDefaults(initialConfig?: WorkspaceWizardInitialConfig) {
  const source_config = initialConfig?.source_config
  if (!source_config) return

  if (
    !startsFromSynthesis.value &&
    !startsFromFloorplan.value &&
    !config.value.origin_def &&
    source_config.origin_def
  ) {
    config.value.origin_def = source_config.origin_def
  }
  if (!config.value.origin_verilog && source_config.origin_verilog) {
    config.value.origin_verilog = source_config.origin_verilog
  }
  if (!sdcPath.value && source_config.sdc) {
    sdcPath.value = source_config.sdc
  }
  if (source_config.pdk_config) {
    pdkSelections.value = {
      tech_lef: [...(source_config.pdk_config.tech_lef ?? [])],
      cell_lef: [...(source_config.pdk_config.cell_lef ?? [])],
      liberty: [...(source_config.pdk_config.liberty ?? [])],
    }
  }
  Object.assign(config.value.parameters, source_config.parameters ?? {})
  syncWorkspaceConfig()
}

function closeBrowseMenu() {
  showBrowseMenu.value = false
}

function toggleBrowseMenu() {
  showBrowseMenu.value = !showBrowseMenu.value
}

function showDirectoryUploadFailurePrompt() {
  manualFilePickError.value = DIRECTORY_UPLOAD_FAILURE_MESSAGE
  showToast({
    severity: 'warn',
    summary: 'Folder Upload Failed',
    detail: DIRECTORY_UPLOAD_FAILURE_MESSAGE,
    life: 5000,
  })
}

async function browseRtlFiles() {
  closeBrowseMenu()
  manualFilePickError.value = ''
  directoryScanError.value = ''

  let result: PickedRtlSources | null = null
  try {
    result = await getDesktopApi().dialog.pickRtlSources({
      multiple: false,
      title: 'Select RTL Design Files',
    })
  } catch (error) {
    if (error instanceof Error && error.message.includes('not folders')) {
      showDirectoryUploadFailurePrompt()
      return
    }
    manualFilePickError.value =
      error instanceof Error ? error.message : 'Failed to select RTL design files.'
    return
  }

  if (!result || result.files.length === 0) return
  if (result.directories.length > 0) {
    showDirectoryUploadFailurePrompt()
    return
  }

  const hdlFiles = result.files.filter((path) => isHdlFilePath(path))
  if (hdlFiles.length === 0) {
    manualFilePickError.value =
      'Please select RTL design files only (.v, .sv, .vhd, .vhdl, or .gz-compressed HDL).'
    return
  }

  addManualFiles(hdlFiles)
}

async function browseRtlFolder() {
  closeBrowseMenu()
  manualFilePickError.value = ''
  directoryScanError.value = ''

  let directoryPath: string | null = null
  try {
    directoryPath = await getDesktopApi().dialog.pickDirectory({
      title: 'Select RTL Design Folder',
    })
  } catch (error) {
    directoryScanError.value =
      error instanceof Error ? error.message : 'Please select a folder, not a file.'
    return
  }

  if (!directoryPath) return
  await loadRtlDirectory(directoryPath)
}

async function loadRtlDirectory(directoryPath: string) {
  isScanningDirectory.value = true
  directoryScanError.value = ''
  try {
    const scanned = await getDesktopApi().workspace.scanRtlDirectory(directoryPath)
    rtlSourceDirectory.value = scanned.rootPath
    scannedRtlFiles.value = scanned.files
    directorySelectedFiles.value = [...scanned.files]
    syncRtlList()
  } catch (error) {
    directoryScanError.value =
      error instanceof Error ? error.message : 'Failed to scan the selected directory.'
  } finally {
    isScanningDirectory.value = false
  }
}

function updateDirectorySelectedFiles(files: string[]) {
  directorySelectedFiles.value = files
  syncRtlList()
}

function syncRtlList() {
  config.value.rtl_list = uniquePaths([
    ...directorySelectedFiles.value,
    ...manuallyAddedFiles.value,
  ])
  syncWorkspaceConfig()
}

function handleFileDrop(event: DragEvent) {
  isDraggingFiles.value = false
  manualFilePickError.value = ''
  const files = event.dataTransfer?.files
  if (!files) return

  const paths = Array.from(files)
    .map((file) => (file as File & { path?: string }).path ?? file.name)
    .filter((path): path is string => Boolean(path))
    .filter((path) => isHdlFilePath(path))

  if (paths.length === 0) {
    manualFilePickError.value =
      'Only RTL design files can be dropped here. Use Browse to select a folder.'
    return
  }

  addManualFiles(paths)
}

function addManualFiles(paths: string[]) {
  const existing = new Set([...manuallyAddedFiles.value, ...directorySelectedFiles.value])
  for (const path of paths) {
    if (!existing.has(path)) {
      manuallyAddedFiles.value.push(path)
      existing.add(path)
    }
  }
  syncRtlList()
}

function removeManualFile(path: string) {
  manuallyAddedFiles.value = manuallyAddedFiles.value.filter((file) => file !== path)
  syncRtlList()
}

async function importDesignInput(type: DesignInputKey) {
  designFileError.value = ''
  const fileOptions = getDesignFileOptions(type)
  if (!fileOptions) return

  let picked: string[] | null = null
  try {
    picked = await getDesktopApi().dialog.pickFiles(fileOptions)
  } catch (error) {
    designFileError.value =
      error instanceof Error ? error.message : 'Failed to import file.'
    return
  }

  const file = picked?.[0]
  if (!file) return

  if (!isAllowedDesignInputPath(type, file)) {
    designFileError.value = `Please select a supported ${type.toUpperCase()} file.`
    return
  }

  if (type === 'filelist') filelistPath.value = file
  if (type === 'sdc') sdcPath.value = file
  if (type === 'def') config.value.origin_def = file
  if (type === 'verilog') config.value.origin_verilog = file
  syncWorkspaceConfig()
}

function getDesignFileOptions(type: DesignInputKey): DesktopFileDialogOptions | null {
  const common = { multiple: false }
  switch (type) {
    case 'filelist':
      return {
        ...common,
        title: 'Select Filelist',
        filters: [
          {
            name: 'Filelist',
            extensions: ['f', 'fl', 'flist', 'filelist', 'lst', 'txt', 'gz'],
          },
        ],
      }
    case 'sdc':
      return {
        ...common,
        title: 'Select SDC File',
        filters: [{ name: 'SDC Files', extensions: ['sdc', 'gz'] }],
      }
    case 'def':
      return {
        ...common,
        title: 'Select DEF File',
        filters: [{ name: 'DEF Files', extensions: ['def', 'gz'] }],
      }
    case 'verilog':
      return {
        ...common,
        title: 'Select Verilog Netlist',
        filters: [{ name: 'Verilog Files', extensions: ['v', 'sv', 'vg', 'gz'] }],
      }
    default:
      return null
  }
}

function isAllowedDesignInputPath(type: DesignInputKey, path: string) {
  const lowerPath = path.toLowerCase()
  const matches = (extensions: string[]) =>
    extensions.some(
      (extension) =>
        lowerPath.endsWith(`.${extension}`) || lowerPath.endsWith(`.${extension}.gz`),
    )

  if (type === 'filelist') return matches(['f', 'fl', 'flist', 'filelist', 'lst', 'txt'])
  if (type === 'sdc') return matches(['sdc'])
  if (type === 'def') return matches(['def'])
  if (type === 'verilog') return matches(['v', 'sv', 'vg'])
  return type === 'rtl' ? isHdlFilePath(path) : false
}

function getDesignInputPath(type: DesignInputKey) {
  if (type === 'filelist') return filelistPath.value
  if (type === 'sdc') return sdcPath.value
  if (type === 'def') return config.value.origin_def
  if (type === 'verilog') return config.value.origin_verilog
  return ''
}

function getDesignInputStatus(type: DesignInputKey) {
  if (type === 'rtl') return config.value.rtl_list.length > 0
  return getDesignInputPath(type).trim() !== ''
}

function designFilesReady() {
  if (startsFromSynthesis.value) {
    return config.value.rtl_list.length > 0 || filelistPath.value.trim() !== ''
  }
  if (startsFromFloorplan.value) {
    return config.value.origin_verilog.trim() !== ''
  }
  return (
    config.value.origin_def.trim() !== '' && config.value.origin_verilog.trim() !== ''
  )
}

function selectPdk(pdk: import('../types').ImportedPdk) {
  selectedPdkId.value = pdk.id
  config.value.pdk = pdk.pdkId
  config.value.pdk_root = pdk.path
  manualPdkDetectedFiles.value = pdk.detectedFiles ?? null
  syncWorkspaceConfig()
}

async function handleImportPdk() {
  const pdk = await doImportPdk()
  if (pdk) {
    selectPdk(pdk)
  }
}

async function handleRemovePdk(id: string) {
  await removePdk(id)
  if (selectedPdkId.value === id) {
    selectedPdkId.value = ''
    config.value.pdk = ''
    config.value.pdk_root = ''
    manualPdkDetectedFiles.value = null
    pdkSelections.value = {
      tech_lef: [],
      cell_lef: [],
      liberty: [],
    }
  }
}

async function scanManualPdkResources() {
  const root = getCurrentPdkRoot()
  if (!root) return
  try {
    const scanned = await getDesktopApi().workspace.scanPdkDirectory(root)
    manualPdkDetectedFiles.value = scanned.detectedFiles
  } catch (error) {
    showToast({
      severity: 'error',
      summary: 'PDK Scan Failed',
      detail:
        error instanceof Error ? error.message : 'Failed to scan the current PDK folder.',
      life: 5000,
    })
  }
}

async function openPdkResourcePicker(type: PdkResourceKey) {
  activePdkWizardStep.value = type
  await scanManualPdkResources()
  pdkResourcePickerOpen.value = true
}

function closePdkResourcePicker() {
  pdkResourcePickerOpen.value = false
}

function updatePdkResourceSelection(files: string[]) {
  pdkSelections.value[activePdkWizardStep.value] = uniquePaths(files)
}

function specReady() {
  const params = config.value.parameters
  const hasCoreFields =
    String(params.design || '').trim() !== '' &&
    String(params.top_module || '').trim() !== '' &&
    String(params.clock || '').trim() !== '' &&
    Number(params.frequency_max) > 0 &&
    Number(params.max_fanout) > 0

  if (!hasCoreFields || projectManifestError.value || isLoadingProjectManifest.value) {
    return false
  }
  if (
    Number(params.target_density) < 0.1 ||
    Number(params.target_density) > 1 ||
    Number(params.target_overflow) <= 0 ||
    Number(params.target_overflow) > 1
  ) {
    return false
  }
  if (dieAreaMode.value === 'width_height') {
    return (
      Number(params.die_width) > 0 &&
      Number(params.die_height) > 0 &&
      !mpcDieAreaValidation.value.error
    )
  }
  return Number(params.utilitization) > 0 && Number(params.margin) >= 0
}

function syncWorkspaceConfig() {
  config.value.directory = workspaceLocation.value
  config.value.filelist = filelistPath.value
  config.value.design_input_mode = startsFromSynthesis.value ? 'rtl' : 'post_synthesis'
  config.value.sdc = sdcPath.value
  config.value.pdk_config_mode = pdkConfigMode.value
  config.value.parameters.die_area_mode = dieAreaMode.value
  config.value.flow_config = {
    start_step: flowStartStep.value,
    end_step: flowEndStep.value,
    steps: selectedFlowSteps.value,
  }
  config.value.pdk_config = {
    mode: pdkConfigMode.value,
    tech_lef: pdkSelections.value.tech_lef,
    cell_lef: pdkSelections.value.cell_lef,
    liberty: pdkSelections.value.liberty,
  }
  config.value.mpc = projectMpc.value
  config.value.project_context = {
    ...projectContext.value,
  }
}

applySourceWorkspaceDefaults(props.initialConfig)

function closeWizard() {
  emit('close')
}

function handleWizardKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  if (pdkResourcePickerOpen.value) {
    closePdkResourcePicker()
    return
  }
  closeWizard()
}

function nextStep() {
  if (currentStep.value < steps.length && canProceed.value) {
    currentStep.value += 1
    highestStep.value = Math.max(highestStep.value, currentStep.value)
    if (currentStep.value === 5) {
      void ensurePdksLoaded()
    }
  }
}

function jumpToStep(step: number) {
  currentStep.value = step
  highestStep.value = Math.max(highestStep.value, step)
  if (step === 5) {
    void ensurePdksLoaded()
  }
}

function handleStepClick(targetStep: number) {
  if (targetStep === currentStep.value) return
  if (targetStep < currentStep.value || targetStep <= highestStep.value) {
    jumpToStep(targetStep)
  }
}

function prevStep() {
  if (currentStep.value > 1) {
    currentStep.value -= 1
  }
}

async function createWorkspace() {
  syncWorkspaceConfig()
  isCreating.value = true
  try {
    emit('create', config.value)
  } finally {
    isCreating.value = false
  }
}
</script>

<style scoped>
.new-workspace-wizard-overlay {
  isolation: isolate;
  contain: layout style paint;
}

.new-workspace-wizard-panel {
  contain: layout style paint;
}

.fade-slide-enter-active,
.fade-slide-leave-active {
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}

.fade-slide-enter-from {
  opacity: 0;
  transform: translateY(8px);
}

.fade-slide-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

.pdk-resource-selected-list {
  max-height: min(260px, 32vh);
  min-height: 0;
  overflow-y: auto;
  scrollbar-gutter: stable;
}

.flow-step-connector {
  pointer-events: none;
  position: absolute;
  right: -1rem;
  top: 50%;
  display: none;
  width: 1.25rem;
  height: 10px;
  transform: translateY(-50%);
  align-items: center;
  justify-content: center;
}

.flow-step-connector-line {
  width: 100%;
  height: 2px;
  border-radius: 999px;
  background: var(--accent-color);
  opacity: 0.48;
}

.flow-step-connector-dot {
  position: absolute;
  right: 0;
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--accent-color);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent-color) 18%, transparent);
}

@media (min-width: 1280px) {
  .flow-step-connector {
    display: flex;
  }
}
</style>
