<template>
  <div
    class="new-project-wizard-overlay fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4 sm:p-6"
  >
    <div
      class="new-project-wizard-panel relative flex h-[85vh] max-h-[850px] w-full max-w-5xl flex-col overflow-hidden rounded-[24px] border border-white/10 bg-(--bg-primary) shadow-[0_32px_64px_-16px_rgba(0,0,0,0.5)] ring-1 ring-black/5 dark:border-white/5 dark:ring-white/5"
    >
      <!-- Top Decorative Gradient -->
      <div
        class="absolute top-0 right-0 left-0 h-1 bg-gradient-to-r from-blue-500/80 via-(--accent-color)/80 to-purple-500/80"
      ></div>

      <!-- Close Button -->
      <button
        @click="$emit('close')"
        class="absolute top-6 right-6 z-20 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-(--bg-secondary)/80 text-(--text-secondary) transition-colors duration-200 hover:bg-(--border-color) hover:text-(--text-primary)"
      >
        <i class="ri-close-line text-lg"></i>
      </button>

      <div class="flex h-full flex-col md:flex-row">
        <!-- Sidebar Stepper -->
        <div
          class="relative flex w-full shrink-0 flex-col border-r border-(--border-color)/40 bg-(--bg-secondary)/40 p-8 md:w-80 md:p-10"
        >
          <!-- Subtle lighting reflection effect -->
          <div
            class="pointer-events-none absolute top-0 left-0 h-full w-full bg-gradient-to-b from-white/5 to-transparent"
          ></div>

          <div class="relative z-10 mb-12">
            <h1 class="text-3xl font-bold tracking-tight text-(--text-primary)">
              New Project
            </h1>
            <p class="mt-2 text-sm text-(--text-secondary)">
              Configure your chip design environment
            </p>
          </div>

          <div class="relative z-10 flex flex-col gap-8">
            <template v-for="(step, index) in steps" :key="step.id">
              <div
                class="group relative flex items-start gap-4"
                :class="[
                  step.id <= highestStep && step.id !== currentStep
                    ? 'cursor-pointer transition-opacity hover:opacity-80'
                    : 'cursor-default',
                ]"
                @click="handleStepClick(step.id)"
              >
                <!-- Connector Line -->
                <div
                  v-if="index < steps.length - 1"
                  class="absolute top-12 bottom-[-32px] left-5 w-[2px] -translate-x-1/2 rounded-full transition-colors duration-200"
                  :class="
                    currentStep > step.id
                      ? 'bg-(--accent-color)'
                      : 'bg-(--border-color)/60'
                  "
                ></div>

                <!-- Step Indicator -->
                <div class="relative z-10 flex shrink-0 flex-col items-center">
                  <div
                    :class="[
                      'flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold shadow-sm transition-colors duration-200',
                      currentStep > step.id
                        ? 'border border-transparent bg-(--accent-color) text-white ring-4 ring-(--accent-color)/20'
                        : currentStep === step.id
                          ? 'border border-transparent bg-(--accent-color) text-white ring-4 ring-(--accent-color)/30'
                          : 'border border-(--border-color) bg-(--bg-primary)/80 text-(--text-secondary)',
                    ]"
                  >
                    <i v-if="currentStep > step.id" class="ri-check-line text-lg"></i>
                    <span v-else>{{ step.id }}</span>
                  </div>
                </div>

                <!-- Step Text -->
                <div
                  class="flex flex-col pt-2 transition-transform duration-200"
                  :class="currentStep === step.id ? 'translate-x-1' : ''"
                >
                  <span
                    :class="[
                      'text-base font-semibold transition-colors duration-200',
                      currentStep >= step.id
                        ? 'text-(--text-primary)'
                        : 'text-(--text-secondary)',
                    ]"
                    >{{ step.title }}</span
                  >
                  <span
                    v-if="currentStep === step.id"
                    class="mt-1 text-xs font-medium tracking-wide text-(--accent-color) uppercase"
                    >In Progress</span
                  >
                </div>
              </div>
            </template>
          </div>
        </div>

        <!-- Main Content Area -->
        <div class="relative flex min-w-0 flex-1 flex-col bg-transparent">
          <!-- Step Content Scrollable Area -->
          <div class="custom-scrollbar flex-1 overflow-y-auto p-8 md:p-12">
            <Transition name="fade-slide" mode="out-in">
              <!-- Step 1: Basic Info -->
              <div v-if="currentStep === 1" key="step1" class="mx-auto w-full max-w-2xl">
                <div class="mb-10">
                  <h2 class="text-2xl font-bold text-(--text-primary)">Project Basics</h2>
                  <p class="mt-2 text-(--text-secondary)">
                    Set up the fundamental details for your new workspace.
                  </p>
                </div>

                <div class="space-y-8">
                  <!-- Project Name -->
                  <div class="group">
                    <label
                      class="mb-2 block text-sm font-semibold text-(--text-primary) transition-colors duration-200 group-focus-within:text-(--accent-color)"
                    >
                      Project Name <span class="text-red-500">*</span>
                    </label>
                    <input
                      v-model="config.parameters.design"
                      type="text"
                      placeholder="e.g. my_chip_design"
                      :class="[
                        'w-full rounded-xl border bg-(--bg-secondary)/40 px-4 py-3.5 text-(--text-primary) shadow-sm transition-colors duration-200 placeholder:text-(--text-secondary)/50 focus:bg-(--bg-primary)/80 focus:outline-none',
                        designNameError
                          ? 'border-red-500 focus:border-red-500'
                          : 'border-(--border-color) focus:border-(--accent-color)',
                      ]"
                    />
                    <p
                      v-if="designNameError"
                      class="mt-2 flex items-center gap-1 text-xs text-red-500"
                    >
                      <i class="ri-error-warning-fill"></i> {{ designNameError }}
                    </p>
                    <p
                      v-else
                      class="mt-2 flex items-center gap-1 text-xs text-(--text-secondary)"
                    >
                      <i class="ri-error-warning-line"></i> Only letters, numbers, and
                      underscores are allowed; spaces and Chinese characters are not
                      permitted.
                    </p>
                  </div>

                  <!-- Project Description -->
                  <div class="group">
                    <label
                      class="mb-2 block text-sm font-semibold text-(--text-primary) transition-colors duration-200 group-focus-within:text-(--accent-color)"
                    >
                      Project Description
                    </label>
                    <textarea
                      v-model="config.parameters.description"
                      rows="3"
                      placeholder="Briefly describe your chip design project..."
                      class="w-full resize-none rounded-xl border border-(--border-color) bg-(--bg-secondary)/40 px-4 py-3.5 text-(--text-primary) shadow-sm transition-colors duration-200 placeholder:text-(--text-secondary)/50 focus:border-(--accent-color) focus:bg-(--bg-primary)/80 focus:outline-none"
                    ></textarea>
                  </div>

                  <!-- Project Location -->
                  <div class="group">
                    <label
                      class="mb-2 block text-sm font-semibold text-(--text-primary) transition-colors duration-200 group-focus-within:text-(--accent-color)"
                    >
                      Save Location <span class="text-red-500">*</span>
                    </label>
                    <div class="flex gap-3">
                      <div class="relative flex-1">
                        <div
                          class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4"
                        >
                          <i class="ri-folder-line text-(--text-secondary)"></i>
                        </div>
                        <input
                          v-model="config.directory"
                          type="text"
                          readonly
                          placeholder="Choose a folder..."
                          @click="selectLocation()"
                          :class="[
                            'w-full cursor-pointer truncate rounded-xl border bg-(--bg-secondary)/40 py-3.5 pr-4 pl-10 text-(--text-primary) shadow-sm transition-colors duration-200 placeholder:text-(--text-secondary)/50 focus:bg-(--bg-primary)/80',
                            directoryError
                              ? 'border-red-500 focus:border-red-500'
                              : 'border-(--border-color) focus:border-(--accent-color)',
                          ]"
                        />
                      </div>
                      <button
                        @click="selectLocation"
                        class="flex shrink-0 cursor-pointer items-center gap-2 rounded-xl border border-(--border-color) bg-(--bg-primary)/50 px-6 py-3.5 font-medium text-(--text-primary) shadow-sm transition-colors duration-200 hover:border-(--text-secondary) hover:bg-(--bg-secondary)"
                      >
                        Browse
                      </button>
                    </div>
                    <p
                      v-if="directoryError"
                      class="mt-2 flex items-center gap-1 text-xs text-red-500"
                    >
                      <i class="ri-error-warning-fill"></i> {{ directoryError }}
                    </p>
                    <p
                      v-else-if="!config.directory"
                      class="mt-2 flex items-center gap-1 text-xs text-(--text-secondary)"
                    >
                      <i class="ri-information-line"></i> The path cannot contain spaces
                      or Chinese characters.
                    </p>
                  </div>
                </div>
              </div>

              <!-- Step 2: Design Files -->
              <div
                v-else-if="currentStep === 2"
                key="step2"
                :class="rtlSourceDirectory ? 'w-full' : 'mx-auto w-full max-w-2xl'"
              >
                <div class="mb-10">
                  <h2 class="text-2xl font-bold text-(--text-primary)">Design Files</h2>
                  <p class="mt-2 text-(--text-secondary)">
                    Upload or select your RTL design files to be synthesized.
                  </p>
                </div>

                <!-- RTL Source: files or directory -->
                <div
                  @dragover.prevent="isDraggingFiles = true"
                  @dragleave.prevent="isDraggingFiles = false"
                  @drop.prevent="handleFileDrop"
                  :class="[
                    'group relative rounded-2xl border-2 border-dashed p-8 text-center transition-colors duration-200 md:p-10',
                    isDraggingFiles
                      ? 'border-(--accent-color) bg-(--accent-color)/5'
                      : 'border-(--border-color) hover:border-(--accent-color)/50 hover:bg-(--bg-secondary)/40',
                  ]"
                >
                  <div class="flex flex-col items-center">
                    <div
                      class="mb-5 flex h-20 w-20 items-center justify-center rounded-2xl border border-(--border-color) bg-(--bg-secondary)/50 shadow-sm transition-colors duration-200"
                      :class="{
                        'border-(--accent-color) text-(--accent-color)': isDraggingFiles,
                      }"
                    >
                      <i
                        class="ri-upload-cloud-2-line text-4xl"
                        :class="
                          isDraggingFiles
                            ? 'text-(--accent-color)'
                            : 'text-(--text-secondary) group-hover:text-(--accent-color)'
                        "
                      ></i>
                    </div>
                    <h3 class="mb-2 text-lg font-bold text-(--text-primary)">
                      Add RTL Design Files
                    </h3>
                    <p class="mb-6 max-w-md text-sm text-(--text-secondary)">
                      Drag HDL files here, or browse to select individual files or a
                      design folder.
                    </p>
                    <div class="relative">
                      <button
                        type="button"
                        class="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-(--accent-color) px-8 py-3 font-medium text-white shadow-sm transition-opacity duration-200 hover:opacity-90"
                        @click="toggleBrowseMenu"
                      >
                        Browse
                        <i
                          class="ri-arrow-down-s-line transition-transform duration-200"
                          :class="{ 'rotate-180': showBrowseMenu }"
                        ></i>
                      </button>
                      <div
                        v-if="showBrowseMenu"
                        class="absolute top-[calc(100%+0.5rem)] left-1/2 z-20 w-56 -translate-x-1/2 overflow-hidden rounded-xl border border-(--border-color) bg-(--bg-primary) shadow-lg"
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
                          <i class="ri-folder-open-line text-yellow-500/80"></i>
                          Select design folder...
                        </button>
                      </div>
                    </div>

                    <div
                      v-if="isScanningDirectory"
                      class="mt-6 flex items-center justify-center gap-2 text-sm text-(--text-secondary)"
                    >
                      <i class="ri-loader-4-line animate-spin"></i>
                      Scanning RTL files in the selected directory...
                    </div>
                    <p
                      v-else-if="manualFilePickError"
                      class="mt-6 flex items-center justify-center gap-1 text-xs text-red-500"
                    >
                      <i class="ri-error-warning-fill"></i> {{ manualFilePickError }}
                    </p>
                    <p
                      v-else-if="directoryScanError"
                      class="mt-6 flex items-center justify-center gap-1 text-xs text-red-500"
                    >
                      <i class="ri-error-warning-fill"></i> {{ directoryScanError }}
                    </p>
                    <p v-else class="mt-6 text-xs text-(--text-secondary)">
                      Supports Verilog (.v), SystemVerilog (.sv), VHDL (.vhd, .vhdl), or a
                      design folder
                    </p>
                  </div>
                </div>

                <DesignFileTransfer
                  v-if="rtlSourceDirectory && scannedRtlFiles.length > 0"
                  class="mt-8"
                  :root-path="rtlSourceDirectory"
                  :all-files="scannedRtlFiles"
                  :selected-files="directorySelectedFiles"
                  @update:selected-files="updateDirectorySelectedFiles"
                />

                <p
                  v-else-if="
                    rtlSourceDirectory &&
                    !isScanningDirectory &&
                    scannedRtlFiles.length === 0
                  "
                  class="mt-6 flex items-center gap-1 text-xs text-(--text-secondary)"
                >
                  <i class="ri-information-line"></i> No RTL files were found in the
                  selected directory.
                </p>

                <!-- Manually Added Files -->
                <div v-if="manuallyAddedFiles.length > 0" class="mt-8 space-y-3">
                  <div class="mb-4 flex items-center justify-between">
                    <h4 class="text-sm font-semibold text-(--text-primary)">
                      Added Files
                      <span
                        class="ml-2 rounded-full bg-(--bg-secondary) px-2 py-0.5 text-xs"
                        >{{ manuallyAddedFiles.length }}</span
                      >
                    </h4>
                  </div>
                  <div class="custom-scrollbar max-h-48 space-y-2 overflow-y-auto pr-2">
                    <TransitionGroup name="list">
                      <div
                        v-for="file in manuallyAddedFiles"
                        :key="file"
                        class="group flex cursor-default items-center justify-between rounded-xl border border-(--border-color) bg-(--bg-secondary)/30 px-4 py-3 shadow-sm transition-colors duration-200 hover:bg-(--bg-secondary)/60"
                      >
                        <div class="flex min-w-0 items-center gap-4">
                          <div
                            class="flex h-10 w-10 items-center justify-center rounded-lg border border-(--border-color)/50 bg-(--bg-primary)/80 shadow-sm"
                          >
                            <i
                              :class="[
                                'text-lg',
                                file.endsWith('.v') || file.endsWith('.sv')
                                  ? 'ri-file-code-line text-blue-500'
                                  : file.endsWith('.vhd') || file.endsWith('.vhdl')
                                    ? 'ri-file-code-line text-purple-500'
                                    : 'ri-file-line text-(--text-secondary)',
                              ]"
                            ></i>
                          </div>
                          <div class="min-w-0">
                            <p
                              class="truncate text-sm font-medium text-(--text-primary)"
                              :title="file"
                            >
                              {{ file.split('/').pop() || file }}
                            </p>
                            <p
                              class="truncate text-xs text-(--text-secondary) opacity-70"
                            >
                              {{ file }}
                            </p>
                          </div>
                        </div>
                        <button
                          @click.stop="removeManualFile(file)"
                          class="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-(--text-secondary) opacity-0 transition-colors duration-200 group-hover:opacity-100 hover:bg-red-500/10 hover:text-red-500"
                        >
                          <i class="ri-delete-bin-line"></i>
                        </button>
                      </div>
                    </TransitionGroup>
                  </div>
                </div>

                <!-- Top Module and Clock Selection -->
                <div
                  class="mt-8 grid grid-cols-2 gap-6 rounded-2xl border border-(--border-color) bg-(--bg-secondary)/20 p-6"
                >
                  <div class="group">
                    <label
                      class="mb-2 block text-sm font-semibold text-(--text-primary) transition-colors duration-200 group-focus-within:text-(--accent-color)"
                    >
                      Top Module Name <span class="text-red-500">*</span>
                    </label>
                    <input
                      v-model="config.parameters.top_module"
                      type="text"
                      placeholder="e.g. top_module"
                      class="w-full rounded-xl border border-(--border-color) bg-(--bg-primary)/60 px-4 py-3 text-(--text-primary) shadow-sm transition-colors duration-200 placeholder:text-(--text-secondary)/50 focus:border-(--accent-color) focus:outline-none"
                    />
                  </div>
                  <div class="group">
                    <label
                      class="mb-2 block text-sm font-semibold text-(--text-primary) transition-colors duration-200 group-focus-within:text-(--accent-color)"
                    >
                      Clock Signal Name <span class="text-red-500">*</span>
                    </label>
                    <input
                      v-model="config.parameters.clock"
                      type="text"
                      placeholder="e.g. clk"
                      class="w-full rounded-xl border border-(--border-color) bg-(--bg-primary)/60 px-4 py-3 text-(--text-primary) shadow-sm transition-colors duration-200 placeholder:text-(--text-secondary)/50 focus:border-(--accent-color) focus:outline-none"
                    />
                    <p class="mt-2 text-[11px] leading-tight text-(--text-secondary)">
                      Used for timing constraints
                    </p>
                  </div>
                </div>
              </div>

              <!-- Step 3: Technology Config -->
              <div
                v-else-if="currentStep === 3"
                key="step3"
                class="mx-auto w-full max-w-2xl"
              >
                <div class="mb-10">
                  <h2 class="text-2xl font-bold text-(--text-primary)">
                    Technology Setup
                  </h2>
                  <p class="mt-2 text-(--text-secondary)">
                    Choose target process libraries and define your design constraints.
                  </p>
                </div>

                <div class="space-y-8">
                  <!-- PDK Selection -->
                  <div>
                    <div class="mb-4 flex items-center justify-between">
                      <label class="block text-sm font-semibold text-(--text-primary)">
                        Process Design Kit (PDK) <span class="text-red-500">*</span>
                      </label>
                      <button
                        v-if="importedPdks.length > 0"
                        @click="handleImportPdk"
                        class="flex cursor-pointer items-center gap-1 text-xs font-medium text-(--accent-color) transition-colors duration-200 hover:text-(--accent-color)/80"
                      >
                        <i class="ri-add-line"></i> Import New
                      </button>
                    </div>

                    <div v-if="importedPdks.length > 0" class="grid grid-cols-1 gap-4">
                      <div
                        v-for="pdk in importedPdks"
                        :key="pdk.id"
                        @click="selectPdk(pdk)"
                        :class="[
                          'group relative flex cursor-pointer flex-col overflow-hidden rounded-2xl border p-5 text-left transition-colors duration-200',
                          selectedPdkId === pdk.id
                            ? 'border-(--accent-color) bg-(--accent-color)/5 shadow-sm'
                            : 'border-(--border-color) bg-(--bg-secondary)/20 hover:bg-(--bg-secondary)/40',
                        ]"
                      >
                        <!-- Select indicator line -->
                        <div
                          v-if="selectedPdkId === pdk.id"
                          class="absolute top-0 bottom-0 left-0 w-1 bg-(--accent-color)"
                        ></div>

                        <div class="flex w-full items-start gap-4">
                          <div
                            :class="[
                              'flex h-12 w-12 shrink-0 items-center justify-center rounded-xl shadow-sm transition-colors duration-200',
                              selectedPdkId === pdk.id
                                ? 'bg-(--accent-color) text-white'
                                : 'border border-(--border-color) bg-(--bg-primary)/80 text-(--text-secondary)',
                            ]"
                          >
                            <i class="ri-cpu-line text-2xl"></i>
                          </div>

                          <div class="min-w-0 flex-1 pr-8">
                            <div class="flex items-center gap-3">
                              <h4 class="text-base font-bold text-(--text-primary)">
                                {{ pdk.name }}
                              </h4>
                              <span
                                v-if="pdk.techNode"
                                class="rounded-full border border-(--accent-color)/20 bg-(--accent-color)/10 px-2 py-0.5 text-xs font-bold text-(--accent-color)"
                              >
                                {{ pdk.techNode }}
                              </span>
                            </div>
                            <p
                              v-if="pdk.description"
                              class="mt-1.5 text-sm text-(--text-secondary)"
                            >
                              {{ pdk.description }}
                            </p>
                            <p
                              class="mt-2 inline-block truncate rounded border border-(--border-color)/50 bg-(--bg-primary)/60 px-2 py-1 font-mono text-xs text-(--text-secondary)"
                            >
                              <i class="ri-folder-line mr-1 opacity-70"></i>{{ pdk.path }}
                            </p>
                          </div>
                        </div>

                        <!-- 目录结构摘要 -->
                        <div
                          v-if="selectedPdkId === pdk.id && pdk.detectedFiles"
                          class="mt-4 w-full border-t border-(--border-color)/50 pt-4"
                        >
                          <p
                            class="mb-2 text-[11px] font-semibold tracking-wider text-(--text-secondary) uppercase"
                          >
                            Contents Detected
                          </p>
                          <div class="flex flex-wrap gap-2">
                            <span
                              v-for="dir in pdk.detectedFiles.directories"
                              :key="dir"
                              class="inline-flex items-center gap-1.5 rounded-lg border border-(--border-color)/50 bg-(--bg-primary)/80 px-2.5 py-1 text-xs text-(--text-secondary) shadow-sm"
                            >
                              <i class="ri-folder-fill text-yellow-500/80"></i>{{ dir }}
                            </span>
                            <span
                              v-for="file in pdk.detectedFiles.files.slice(0, 4)"
                              :key="file"
                              class="inline-flex items-center gap-1.5 rounded-lg border border-(--border-color)/50 bg-(--bg-primary)/80 px-2.5 py-1 text-xs text-(--text-secondary) shadow-sm"
                            >
                              <i class="ri-file-text-line opacity-70"></i>{{ file }}
                            </span>
                            <span
                              v-if="pdk.detectedFiles.files.length > 4"
                              class="px-1 py-1 text-xs text-(--text-secondary)"
                            >
                              +{{ pdk.detectedFiles.files.length - 4 }} more
                            </span>
                          </div>
                        </div>

                        <!-- 选中标记 -->
                        <div
                          v-if="selectedPdkId === pdk.id"
                          class="absolute top-5 right-5 flex h-6 w-6 items-center justify-center rounded-full bg-(--accent-color) shadow-sm"
                        >
                          <i class="ri-check-line text-sm text-white"></i>
                        </div>

                        <!-- 删除按钮 -->
                        <div
                          @click.stop="handleRemovePdk(pdk.id)"
                          class="absolute top-5 right-5 z-10 cursor-pointer rounded-lg p-2 opacity-0 transition-colors duration-200 group-hover:opacity-100 hover:bg-red-500/10"
                          :class="{ hidden: selectedPdkId === pdk.id }"
                          title="Remove PDK"
                        >
                          <i
                            class="ri-delete-bin-line text-(--text-secondary) hover:text-red-500"
                          ></i>
                        </div>
                      </div>
                    </div>

                    <!-- 无 PDK 时的空状态 -->
                    <div
                      v-else
                      class="flex flex-col items-center rounded-2xl border-2 border-dashed border-(--border-color) bg-(--bg-secondary)/20 px-6 py-12 transition-colors duration-200 hover:bg-(--bg-secondary)/40"
                    >
                      <div
                        class="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-(--accent-color)/10"
                      >
                        <i class="ri-database-2-line text-3xl text-(--accent-color)"></i>
                      </div>
                      <h4 class="mb-2 font-bold text-(--text-primary)">
                        No PDK Imported
                      </h4>
                      <p
                        class="mb-6 max-w-sm text-center text-sm text-(--text-secondary)"
                      >
                        Import a Process Design Kit directory to get started. We'll
                        automatically detect process files.
                      </p>
                      <button
                        @click="handleImportPdk"
                        class="flex cursor-pointer items-center gap-2 rounded-xl bg-(--accent-color) px-6 py-3 font-medium text-white shadow-sm transition-opacity duration-200 hover:opacity-90"
                      >
                        <i class="ri-folder-add-line"></i>
                        Select PDK Directory
                      </button>
                    </div>
                  </div>

                  <div class="grid grid-cols-1 gap-8 md:grid-cols-2">
                    <!-- Target Frequency -->
                    <div>
                      <div class="mb-3 flex items-center justify-between">
                        <label class="block text-sm font-semibold text-(--text-primary)">
                          Target Frequency
                        </label>
                        <span
                          class="rounded-md bg-(--accent-color)/10 px-2 py-0.5 font-mono text-sm font-bold text-(--accent-color)"
                          >{{ config.parameters.frequency_max }} MHz</span
                        >
                      </div>
                      <input
                        v-model.number="config.parameters.frequency_max"
                        type="number"
                        min="10"
                        max="1000"
                        step="10"
                        class="w-full rounded-xl border border-(--border-color) bg-(--bg-secondary)/40 px-4 py-2.5 text-(--text-primary) shadow-sm transition-colors duration-200 focus:border-(--accent-color) focus:bg-(--bg-primary)/80 focus:outline-none"
                      />
                    </div>

                    <!-- Max Fanout -->
                    <div>
                      <div class="mb-3 flex items-center justify-between">
                        <label class="block text-sm font-semibold text-(--text-primary)">
                          Max Fanout
                        </label>
                        <span
                          class="rounded-md bg-(--accent-color)/10 px-2 py-0.5 font-mono text-sm font-bold text-(--accent-color)"
                          >{{ config.parameters.max_fanout }}</span
                        >
                      </div>
                      <input
                        v-model.number="config.parameters.max_fanout"
                        type="number"
                        min="1"
                        max="100"
                        class="w-full rounded-xl border border-(--border-color) bg-(--bg-secondary)/40 px-4 py-2.5 text-(--text-primary) shadow-sm transition-colors duration-200 focus:border-(--accent-color) focus:bg-(--bg-primary)/80 focus:outline-none"
                      />
                    </div>
                  </div>

                  <!-- Advanced Settings -->
                  <div
                    class="rounded-2xl border border-(--border-color) bg-(--bg-secondary)/20 p-6"
                  >
                    <h3
                      class="mb-5 flex items-center gap-2 text-sm font-bold text-(--text-primary)"
                    >
                      <i class="ri-settings-3-line text-(--accent-color)"></i>
                      Physical Constraints
                    </h3>
                    <div class="grid grid-cols-2 gap-8">
                      <!-- Core Utilization -->
                      <div>
                        <div class="mb-3 flex items-center justify-between">
                          <label
                            class="block text-sm font-semibold text-(--text-primary)"
                          >
                            Core Utilization
                          </label>
                          <span
                            class="rounded-md bg-(--accent-color)/10 px-2 py-0.5 font-mono text-sm font-bold text-(--accent-color)"
                            >{{
                              (
                                ((config.parameters.core_utilization as number) || 0.5) *
                                100
                              ).toFixed(0)
                            }}%</span
                          >
                        </div>
                        <input
                          v-model.number="config.parameters.core_utilization"
                          type="number"
                          min="0.1"
                          max="0.9"
                          step="0.05"
                          class="w-full rounded-xl border border-(--border-color) bg-(--bg-secondary)/40 px-4 py-2.5 text-(--text-primary) shadow-sm transition-colors duration-200 focus:border-(--accent-color) focus:bg-(--bg-primary)/80 focus:outline-none"
                        />
                      </div>

                      <!-- Target Density -->
                      <div>
                        <div class="mb-3 flex items-center justify-between">
                          <label
                            class="block text-sm font-semibold text-(--text-primary)"
                          >
                            Target Density
                          </label>
                          <span
                            class="rounded-md bg-(--accent-color)/10 px-2 py-0.5 font-mono text-sm font-bold text-(--accent-color)"
                            >{{
                              (
                                ((config.parameters.target_density as number) || 0.6) *
                                100
                              ).toFixed(0)
                            }}%</span
                          >
                        </div>
                        <input
                          v-model.number="config.parameters.target_density"
                          type="number"
                          min="0.1"
                          max="0.9"
                          step="0.05"
                          class="w-full rounded-xl border border-(--border-color) bg-(--bg-secondary)/40 px-4 py-2.5 text-(--text-primary) shadow-sm transition-colors duration-200 focus:border-(--accent-color) focus:bg-(--bg-primary)/80 focus:outline-none"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Step 4: Review -->
              <div
                v-else-if="currentStep === 4"
                key="step4"
                class="mx-auto w-full max-w-2xl"
              >
                <div class="mb-10 text-center">
                  <div
                    class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-green-500/20 bg-green-500/10 shadow-sm"
                  >
                    <i class="ri-check-double-line text-3xl text-green-500"></i>
                  </div>
                  <h2 class="text-2xl font-bold text-(--text-primary)">
                    Review & Create
                  </h2>
                  <p class="mt-2 text-(--text-secondary)">
                    Almost there! Review your configuration before finalizing.
                  </p>
                </div>

                <!-- Review Cards -->
                <div class="space-y-5">
                  <!-- Section 1 & 2 combined -->
                  <div
                    class="overflow-hidden rounded-2xl border border-(--border-color) bg-(--bg-secondary)/20"
                  >
                    <div
                      class="flex items-center justify-between border-b border-(--border-color)/60 bg-(--bg-secondary)/40 px-6 py-4"
                    >
                      <h3 class="flex items-center gap-2 font-bold text-(--text-primary)">
                        <i class="ri-folder-info-line text-(--accent-color)"></i>
                        Project details
                      </h3>
                      <button
                        @click="jumpToStep(1)"
                        class="cursor-pointer rounded-md px-3 py-1 text-sm font-medium text-(--accent-color) transition-colors duration-200 hover:bg-(--accent-color)/10 hover:text-(--accent-color)/80"
                      >
                        Edit
                      </button>
                    </div>
                    <div class="grid grid-cols-2 gap-x-8 gap-y-6 p-6">
                      <div>
                        <span
                          class="text-[11px] font-semibold tracking-wider text-(--text-secondary) uppercase"
                          >Project Name</span
                        >
                        <p class="mt-1.5 font-medium text-(--text-primary)">
                          {{ config.parameters.design || '-' }}
                        </p>
                      </div>
                      <div>
                        <span
                          class="text-[11px] font-semibold tracking-wider text-(--text-secondary) uppercase"
                          >Top Module</span
                        >
                        <p class="mt-1.5 font-mono font-medium text-(--text-primary)">
                          {{ config.parameters.top_module || '-' }}
                        </p>
                      </div>
                      <div class="col-span-2">
                        <span
                          class="text-[11px] font-semibold tracking-wider text-(--text-secondary) uppercase"
                          >Save Location</span
                        >
                        <p
                          class="mt-1.5 truncate rounded-lg border border-(--border-color)/50 bg-(--bg-primary)/60 p-2.5 font-mono text-sm font-medium text-(--text-primary)"
                        >
                          {{ config.directory || '-' }}
                        </p>
                      </div>
                      <div class="col-span-2">
                        <span
                          class="text-[11px] font-semibold tracking-wider text-(--text-secondary) uppercase"
                          >Design Files ({{ config.rtl_list.length }})</span
                        >
                        <div
                          class="custom-scrollbar mt-2 max-h-24 overflow-y-auto rounded-lg border border-(--border-color)/50 bg-(--bg-primary)/40 p-2 pr-2"
                        >
                          <p
                            v-for="file in config.rtl_list"
                            :key="file"
                            class="flex items-center gap-2 truncate rounded px-2 py-1.5 text-sm text-(--text-primary) transition-colors duration-200 hover:bg-(--bg-secondary)/50"
                          >
                            <i class="ri-file-code-line text-(--text-secondary)"></i
                            >{{ file.split('/').pop() }}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <!-- Technology Card -->
                  <div
                    class="overflow-hidden rounded-2xl border border-(--border-color) bg-(--bg-secondary)/20"
                  >
                    <div
                      class="flex items-center justify-between border-b border-(--border-color)/60 bg-(--bg-secondary)/40 px-6 py-4"
                    >
                      <h3 class="flex items-center gap-2 font-bold text-(--text-primary)">
                        <i class="ri-cpu-line text-(--accent-color)"></i>
                        Technology & Constraints
                      </h3>
                      <button
                        @click="jumpToStep(3)"
                        class="cursor-pointer rounded-md px-3 py-1 text-sm font-medium text-(--accent-color) transition-colors duration-200 hover:bg-(--accent-color)/10 hover:text-(--accent-color)/80"
                      >
                        Edit
                      </button>
                    </div>
                    <div class="grid grid-cols-2 gap-6 p-6 md:grid-cols-4">
                      <div class="col-span-2">
                        <span
                          class="text-[11px] font-semibold tracking-wider text-(--text-secondary) uppercase"
                          >PDK</span
                        >
                        <p
                          class="mt-1.5 flex w-fit items-center gap-2 rounded-lg border border-(--border-color)/50 bg-(--bg-primary)/60 px-3 py-1.5 font-bold text-(--text-primary)"
                        >
                          {{ getPdkName(config.pdk) }}
                          <i class="ri-checkbox-circle-fill text-green-500"></i>
                        </p>
                      </div>
                      <div class="col-span-2">
                        <span
                          class="text-[11px] font-semibold tracking-wider text-(--text-secondary) uppercase"
                          >Clock Signal</span
                        >
                        <p
                          class="mt-1.5 w-fit rounded-lg border border-(--border-color)/50 bg-(--bg-primary)/60 px-3 py-1.5 font-mono font-medium text-(--text-primary)"
                        >
                          {{ config.parameters.clock || '-' }}
                        </p>
                      </div>
                      <div>
                        <span
                          class="text-[11px] font-semibold tracking-wider text-(--text-secondary) uppercase"
                          >Target Freq</span
                        >
                        <p class="mt-1.5 font-mono font-medium text-(--text-primary)">
                          {{ config.parameters.frequency_max }} MHz
                        </p>
                      </div>
                      <div>
                        <span
                          class="text-[11px] font-semibold tracking-wider text-(--text-secondary) uppercase"
                          >Max Fanout</span
                        >
                        <p class="mt-1.5 font-mono font-medium text-(--text-primary)">
                          {{ config.parameters.max_fanout }}
                        </p>
                      </div>
                      <div>
                        <span
                          class="text-[11px] font-semibold tracking-wider text-(--text-secondary) uppercase"
                          >Utilization</span
                        >
                        <p class="mt-1.5 font-mono font-medium text-(--text-primary)">
                          {{
                            (
                              ((config.parameters.core_utilization as number) || 0.5) *
                              100
                            ).toFixed(0)
                          }}%
                        </p>
                      </div>
                      <div>
                        <span
                          class="text-[11px] font-semibold tracking-wider text-(--text-secondary) uppercase"
                          >Density</span
                        >
                        <p class="mt-1.5 font-mono font-medium text-(--text-primary)">
                          {{
                            (
                              ((config.parameters.target_density as number) || 0.6) * 100
                            ).toFixed(0)
                          }}%
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </Transition>
          </div>

          <!-- Footer Actions -->
          <div
            class="z-10 flex shrink-0 items-center justify-between border-t border-(--border-color)/60 bg-(--bg-primary) px-8 py-6 shadow-[0_-10px_30px_-15px_rgba(0,0,0,0.1)] md:px-12"
          >
            <button
              v-if="currentStep > 1"
              @click="prevStep"
              class="flex cursor-pointer items-center gap-2 rounded-xl border border-(--border-color) bg-(--bg-secondary)/40 px-6 py-3 font-semibold text-(--text-primary) shadow-sm transition-colors duration-200 hover:bg-(--bg-secondary)/80"
            >
              <i class="ri-arrow-left-line"></i>
              Back
            </button>
            <div v-else></div>

            <div class="flex items-center gap-4">
              <button
                @click="$emit('close')"
                class="cursor-pointer rounded-xl px-6 py-3 font-semibold text-(--text-secondary) transition-colors duration-200 hover:bg-(--bg-secondary)/50 hover:text-(--text-primary)"
              >
                Cancel
              </button>

              <button
                v-if="highestStep === 4 && currentStep < 4"
                @click="returnToReview"
                :disabled="!canProceed"
                class="flex cursor-pointer items-center gap-2 rounded-xl border border-(--border-color) bg-(--bg-secondary)/50 px-6 py-3 font-semibold text-(--text-primary) shadow-sm transition-all duration-200 hover:border-(--text-secondary) hover:bg-(--bg-secondary) hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50"
              >
                <i class="ri-check-double-line"></i>
                Save & Return
              </button>

              <button
                v-if="currentStep < 4"
                @click="nextStep"
                :disabled="!canProceed"
                class="flex cursor-pointer items-center gap-2 rounded-xl bg-(--accent-color) px-8 py-3 font-semibold text-white shadow-sm transition-all duration-200 hover:bg-(--accent-color)/90 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:shadow-sm"
              >
                Continue
                <i class="ri-arrow-right-line"></i>
              </button>

              <button
                v-else
                @click="createProject"
                :disabled="isCreating"
                class="flex cursor-pointer items-center gap-2 rounded-xl bg-(--accent-color) px-8 py-3 font-bold text-white shadow-md transition-all duration-200 hover:opacity-90 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-50"
              >
                <i v-if="isCreating" class="ri-loader-4-line animate-spin"></i>
                <i v-else class="ri-rocket-line"></i>
                {{ isCreating ? 'Creating Project...' : 'Create Project' }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { WorkspaceConfig } from '../types'
import { usePdkManager } from '../composables/usePdkManager'
import { useWorkspace } from '../composables/useWorkspace'
import { getDesktopApi } from '@/platform/desktop'
import { isHdlFilePath, type PickedRtlSources } from '@ecos-studio/shared'
import DesignFileTransfer from './DesignFileTransfer.vue'

interface Emits {
  (e: 'close'): void
  (e: 'create', config: WorkspaceConfig): void
}

const emit = defineEmits<Emits>()

const currentStep = ref(1)
const highestStep = ref(1)
const isDraggingFiles = ref(false)
const isCreating = ref(false)
const isScanningDirectory = ref(false)
const directoryScanError = ref('')
const rtlSourceDirectory = ref<string | null>(null)
const scannedRtlFiles = ref<string[]>([])
const directorySelectedFiles = ref<string[]>([])
const manuallyAddedFiles = ref<string[]>([])
const showBrowseMenu = ref(false)

const steps = [
  { id: 1, title: 'Basic Info' },
  { id: 2, title: 'Design Files' },
  { id: 3, title: 'Technology Setup' },
  { id: 4, title: 'Review & Create' },
]

// PDK 管理
const { importedPdks, loadPdks, importPdk: doImportPdk, removePdk } = usePdkManager()
const { showToast } = useWorkspace()
const selectedPdkId = ref<string>('')
const hasLoadedPdks = ref(false)

const ensurePdksLoaded = async () => {
  if (hasLoadedPdks.value) return
  hasLoadedPdks.value = true
  await loadPdks()
  // 如果只有一个 PDK，自动选中
  if (importedPdks.value.length === 1) {
    selectPdk(importedPdks.value[0])
  }
}

const config = ref<WorkspaceConfig>({
  directory: '',
  pdk: 'ics55',
  pdk_root: '',
  parameters: {
    // 基本信息
    design: '', // 项目/设计名称 -> "Design"
    description: '', // 项目描述
    // 设计参数
    top_module: '', // 顶层模块名 -> "Top module"
    clock: '', // 时钟信号名 -> "Clock"
    // 工艺参数
    frequency_max: 50, // 目标频率 -> "Frequency max [MHz]"
    core_utilization: 0.2, // 核心利用率 -> "Core.Utilitization"
    target_density: 0.3, // 目标密度 -> "Target density"
    max_fanout: 32, // 最大扇出 -> "Max fanout"
  },
  origin_def: '',
  origin_verilog: '',
  rtl_list: [],
})

const CHINESE_CHAR_RE = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/
const HAS_SPACE_RE = /\s/

const designNameError = computed(() => {
  const name = (config.value.parameters.design as string) || ''
  if (!name) return ''
  if (HAS_SPACE_RE.test(name)) return 'Project name cannot contain spaces'
  if (CHINESE_CHAR_RE.test(name)) return 'Project name cannot contain Chinese characters'
  return ''
})

const directoryError = computed(() => {
  const dir = config.value.directory
  if (!dir) return ''
  if (HAS_SPACE_RE.test(dir)) return 'Save path cannot contain spaces'
  if (CHINESE_CHAR_RE.test(dir)) return 'Save path cannot contain Chinese characters'
  return ''
})

const canProceed = computed(() => {
  switch (currentStep.value) {
    case 1:
      return (
        config.value.directory.trim() !== '' &&
        (config.value.parameters.design as string)?.trim() !== '' &&
        !designNameError.value &&
        !directoryError.value
      )
    case 2:
      // RTL 文件、顶层模块和时钟信号都是必需的
      return (
        config.value.rtl_list.length > 0 &&
        (config.value.parameters.top_module as string)?.trim() !== '' &&
        (config.value.parameters.clock as string)?.trim() !== ''
      )
    case 3:
      return selectedPdkId.value !== ''
    default:
      return true
  }
})

const selectLocation = async () => {
  const result = await getDesktopApi().dialog.pickDirectory({
    title: 'Select Project Save Location',
  })
  if (result) {
    config.value.directory = result
  }
}

const manualFilePickError = ref('')
const DIRECTORY_UPLOAD_FAILURE_MESSAGE =
  'Folders cannot be uploaded from Select RTL files. Use Select design folder to scan a folder.'

const closeBrowseMenu = () => {
  showBrowseMenu.value = false
}

const toggleBrowseMenu = () => {
  showBrowseMenu.value = !showBrowseMenu.value
}

const showDirectoryUploadFailurePrompt = () => {
  manualFilePickError.value = DIRECTORY_UPLOAD_FAILURE_MESSAGE
  showToast({
    severity: 'warn',
    summary: 'Folder Upload Failed',
    detail: DIRECTORY_UPLOAD_FAILURE_MESSAGE,
    life: 5000,
  })
}

const browseRtlFiles = async () => {
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

  if (!result || result.files.length === 0) {
    return
  }

  if (result.directories.length > 0) {
    showDirectoryUploadFailurePrompt()
    return
  }

  const hdlFiles = result.files.filter((path) => isHdlFilePath(path))
  if (hdlFiles.length === 0) {
    manualFilePickError.value =
      'Please select RTL design files only (.v, .sv, .vhd, .vhdl).'
    return
  }

  addManualFiles(hdlFiles)
}

const browseRtlFolder = async () => {
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

  if (!directoryPath) {
    return
  }

  await loadRtlDirectory(directoryPath)
}

const loadRtlDirectory = async (directoryPath: string) => {
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

const updateDirectorySelectedFiles = (files: string[]) => {
  directorySelectedFiles.value = files
  syncRtlList()
}

const syncRtlList = () => {
  const merged = new Set([...directorySelectedFiles.value, ...manuallyAddedFiles.value])
  config.value.rtl_list = [...merged]
}

const handleFileDrop = (event: DragEvent) => {
  isDraggingFiles.value = false
  manualFilePickError.value = ''
  const files = event.dataTransfer?.files
  if (!files) {
    return
  }

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

const addManualFiles = (paths: string[]) => {
  const existing = new Set([...manuallyAddedFiles.value, ...directorySelectedFiles.value])
  for (const path of paths) {
    if (!existing.has(path)) {
      manuallyAddedFiles.value.push(path)
      existing.add(path)
    }
  }
  syncRtlList()
}

const removeManualFile = (path: string) => {
  manuallyAddedFiles.value = manuallyAddedFiles.value.filter((file) => file !== path)
  syncRtlList()
}

/** 选中一个已导入的 PDK */
const selectPdk = (pdk: import('../types').ImportedPdk) => {
  selectedPdkId.value = pdk.id
  config.value.pdk = pdk.pdkId
  config.value.pdk_root = pdk.path
}

/** 在 Wizard 中导入新 PDK */
const handleImportPdk = async () => {
  const pdk = await doImportPdk()
  if (pdk) {
    selectPdk(pdk)
  }
}

/** 删除已导入的 PDK */
const handleRemovePdk = async (id: string) => {
  await removePdk(id)
  // 如果删除的是当前选中的，清除选中
  if (selectedPdkId.value === id) {
    selectedPdkId.value = ''
    config.value.pdk = ''
    config.value.pdk_root = ''
  }
}

/** 获取 PDK 显示名称 */
const getPdkName = (pdkIdentifier: string) => {
  // 先从 importedPdks 中按 pdkId 查找
  const found = importedPdks.value.find(
    (p) => p.pdkId === pdkIdentifier || p.id === selectedPdkId.value,
  )
  return found?.name || pdkIdentifier
}

const nextStep = () => {
  if (currentStep.value < 4 && canProceed.value) {
    currentStep.value++
    highestStep.value = Math.max(highestStep.value, currentStep.value)
    if (currentStep.value === 3) {
      void ensurePdksLoaded()
    }
  }
}

const jumpToStep = (step: number) => {
  highestStep.value = Math.max(highestStep.value, currentStep.value)
  currentStep.value = step
  if (step === 3) {
    void ensurePdksLoaded()
  }
}

const handleStepClick = (targetStep: number) => {
  if (targetStep === currentStep.value) return

  if (targetStep < currentStep.value) {
    jumpToStep(targetStep)
  } else if (targetStep <= highestStep.value && canProceed.value) {
    jumpToStep(targetStep)
  }
}

const returnToReview = () => {
  if (canProceed.value) {
    jumpToStep(4)
  }
}

const prevStep = () => {
  if (currentStep.value > 1) {
    currentStep.value--
  }
}

const createProject = async () => {
  isCreating.value = true
  try {
    emit('create', config.value)
  } finally {
    isCreating.value = false
  }
}
</script>

<style scoped>
.new-project-wizard-overlay {
  isolation: isolate;
  contain: layout style paint;
}

.new-project-wizard-panel {
  contain: layout style paint;
}

/* Transition Effects */
.fade-slide-enter-active,
.fade-slide-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.fade-slide-enter-from {
  opacity: 0;
  transform: translateY(10px);
}

.fade-slide-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}

.list-enter-active,
.list-leave-active {
  transition: all 0.3s ease;
}

.list-enter-from,
.list-leave-to {
  opacity: 0;
  transform: translateX(-20px);
}

/* Custom Scrollbar */
.custom-scrollbar::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: var(--border-color);
  border-radius: 10px;
}
.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: var(--text-secondary);
}

/* Range Slider */
input[type='range'] {
  -webkit-appearance: none;
  appearance: none;
  background: transparent;
}

input[type='range']::-webkit-slider-runnable-track {
  width: 100%;
  height: 6px;
  background: transparent;
  border-radius: 9999px;
  border: 1px solid var(--border-color);
}

input[type='range']::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  background: var(--accent-color);
  border-radius: 50%;
  cursor: pointer;
  border: 2px solid var(--bg-primary);
  box-shadow:
    0 0 0 1px var(--border-color),
    0 2px 4px rgba(0, 0, 0, 0.2);
  margin-top: -6px;
  transition: box-shadow 0.2s;
}

input[type='range']::-webkit-slider-thumb:hover {
  box-shadow:
    0 0 0 1px var(--accent-color),
    0 2px 6px rgba(0, 0, 0, 0.3);
}

/* Hide scrollbar utility */
.hide-scrollbar::-webkit-scrollbar {
  display: none;
}
.hide-scrollbar {
  -ms-overflow-style: none;
  scrollbar-width: none;
}
</style>
