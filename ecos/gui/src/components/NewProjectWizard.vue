<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
    <div
      class="relative w-full max-w-5xl mx-4 bg-(--bg-primary) rounded-2xl shadow-2xl border border-(--border-color) overflow-hidden max-h-[90vh] flex flex-col">
      <!-- Close Button -->
      <button @click="$emit('close')"
        class="absolute top-4 right-4 z-10 p-2 rounded-lg hover:bg-(--bg-secondary) transition-colors cursor-pointer">
        <i class="ri-close-line text-xl text-(--text-secondary) hover:text-(--text-primary)"></i>
      </button>

      <!-- Stepper Header -->
      <div class="px-8 pt-8 pb-6 border-b border-(--border-color) bg-(--bg-secondary)/50">
        <div class="flex items-center justify-between max-w-3xl mx-auto">
          <template v-for="(step, index) in steps" :key="step.id">
            <!-- Step Circle -->
            <div class="flex items-center">
              <div class="flex flex-col items-center">
                <div :class="[
                  'w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold transition-all duration-300',
                  currentStep > step.id
                    ? 'bg-(--accent-color) text-white'
                    : currentStep === step.id
                      ? 'bg-(--accent-color) text-white ring-4 ring-(--accent-color)/20'
                      : 'bg-(--bg-secondary) text-(--text-secondary) border-2 border-(--border-color)'
                ]">
                  <i v-if="currentStep > step.id" class="ri-check-line text-lg"></i>
                  <span v-else>{{ step.id }}</span>
                </div>
                <span :class="[
                  'mt-2 text-xs font-medium whitespace-nowrap transition-colors duration-300',
                  currentStep >= step.id ? 'text-(--text-primary)' : 'text-(--text-secondary)'
                ]">{{ step.title }}</span>
              </div>
            </div>

            <!-- Connector Line -->
            <div v-if="index < steps.length - 1" :class="[
              'flex-1 h-0.5 mx-4 transition-all duration-500',
              currentStep > step.id ? 'bg-(--accent-color)' : 'bg-(--border-color)'
            ]"></div>
          </template>
        </div>
      </div>

      <!-- Step Content -->
      <div class="flex-1 overflow-y-auto p-8">
        <Transition name="slide-fade" mode="out-in">
          <!-- Step 1: Basic Info -->
          <div v-if="currentStep === 1" key="step1" class="max-w-2xl mx-auto">
            <div class="mb-8">
              <span class="text-xs font-medium text-(--accent-color) uppercase tracking-wider">Step 1</span>
              <h2 class="text-2xl font-bold text-(--text-primary) mt-1">Project Basics</h2>
              <p class="text-(--text-secondary) mt-2">Set the project name, description, and save location</p>
            </div>

            <div class="space-y-6">
              <!-- Project Name -->
              <div>
                <label class="block text-sm font-medium text-(--text-primary) mb-2">
                  Project Name <span class="text-red-500">*</span>
                </label>
                <input v-model="config.parameters.design" type="text" placeholder="e.g. my_chip_design"
                  class="w-full px-4 py-3 bg-(--bg-secondary) border border-(--border-color) rounded-lg text-(--text-primary) placeholder:text-(--text-secondary) focus:outline-none focus:border-(--accent-color) focus:ring-2 focus:ring-(--accent-color)/20 transition-all" />
                <p class="mt-1 text-xs text-(--text-secondary)">Project name can only contain letters, numbers, and underscores</p>
              </div>

              <!-- Project Description -->
              <div>
                <label class="block text-sm font-medium text-(--text-primary) mb-2">
                  Project Description
                </label>
                <textarea v-model="config.parameters.description" rows="3" placeholder="Briefly describe your chip design project..."
                  class="w-full px-4 py-3 bg-(--bg-secondary) border border-(--border-color) rounded-lg text-(--text-primary) placeholder:text-(--text-secondary) focus:outline-none focus:border-(--accent-color) focus:ring-2 focus:ring-(--accent-color)/20 transition-all resize-none"></textarea>
              </div>

              <!-- Project Location -->
              <div>
                <label class="block text-sm font-medium text-(--text-primary) mb-2">
                  Save Location <span class="text-red-500">*</span>
                </label>
                <div class="flex gap-3">
                  <input v-model="config.directory" type="text" readonly placeholder="Click to select a folder..."
                    @click="selectLocation()"
                    class="flex-1 px-4 py-3 bg-(--bg-secondary) border border-(--border-color) rounded-lg text-(--text-primary) placeholder:text-(--text-secondary) cursor-pointer" />
                  <button @click="selectLocation"
                    class="px-6 py-3 bg-(--accent-color) text-white rounded-lg hover:opacity-90 transition-opacity font-medium cursor-pointer flex items-center gap-2">
                    <i class="ri-folder-open-line"></i>
                    Browse
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- Step 2: Design Files -->
          <div v-else-if="currentStep === 2" key="step2" class="max-w-2xl mx-auto">
            <div class="mb-8">
              <span class="text-xs font-medium text-(--accent-color) uppercase tracking-wider">Step 2</span>
              <h2 class="text-2xl font-bold text-(--text-primary) mt-1">Design Files</h2>
              <p class="text-(--text-secondary) mt-2">Upload or select your RTL design files</p>
            </div>

            <!-- Drag & Drop Zone -->
            <div @dragover.prevent="isDragging = true" @dragleave.prevent="isDragging = false"
              @drop.prevent="handleFileDrop" :class="[
                'relative border-2 border-dashed rounded-xl p-12 text-center transition-all duration-300 cursor-pointer',
                isDragging
                  ? 'border-(--accent-color) bg-(--accent-color)/5'
                  : 'border-(--border-color) hover:border-(--accent-color)/50 hover:bg-(--bg-secondary)/50'
              ]" @click="selectDesignFiles">
              <div class="flex flex-col items-center">
                <div
                  class="w-16 h-16 rounded-full bg-(--accent-color)/10 flex items-center justify-center mb-4 transition-transform"
                  :class="{ 'scale-110': isDragging }">
                  <i class="ri-upload-cloud-2-line text-3xl text-(--accent-color)"></i>
                </div>
                <h3 class="text-lg font-semibold text-(--text-primary) mb-2">Drag and drop files here</h3>
                <p class="text-sm text-(--text-secondary) mb-4">Supports Verilog (.v), SystemVerilog (.sv), and VHDL (.vhd) files</p>
                <button type="button"
                  class="px-6 py-2.5 bg-(--bg-secondary) border border-(--border-color) rounded-lg text-(--text-primary) hover:border-(--accent-color) transition-colors font-medium">
                  Browse Files
                </button>
              </div>
            </div>

            <!-- File List -->
            <div v-if="config.rtl_list.length > 0" class="mt-6 space-y-2">
              <h4 class="text-sm font-medium text-(--text-primary) mb-3">
                Added Files ({{ config.rtl_list.length }})
              </h4>
              <TransitionGroup name="list">
                <div v-for="file in config.rtl_list" :key="file"
                  class="flex items-center justify-between px-4 py-3 bg-(--bg-secondary) rounded-lg border border-(--border-color) group">
                  <div class="flex items-center gap-3 min-w-0">
                    <i :class="[
                      'text-xl',
                      file.endsWith('.v') || file.endsWith('.sv')
                        ? 'ri-file-code-line text-blue-500'
                        : file.endsWith('.vhd')
                          ? 'ri-file-code-line text-purple-500'
                          : 'ri-file-line text-(--text-secondary)'
                    ]"></i>
                    <div class="min-w-0">
                      <p class="font-medium text-(--text-primary) truncate">{{ file }}</p>
                    </div>
                  </div>
                  <button @click.stop="removeFile(file)"
                    class="p-2 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-(--bg-primary) transition-all cursor-pointer">
                    <i class="ri-delete-bin-line text-(--text-secondary) hover:text-red-500"></i>
                  </button>
                </div>
              </TransitionGroup>
            </div>

            <!-- Top Module and Clock Selection -->
            <div v-if="config.rtl_list.length > 0" class="mt-6 space-y-4">
              <div>
                <label class="block text-sm font-medium text-(--text-primary) mb-2">
                  Top Module Name <span class="text-red-500">*</span>
                </label>
                <input v-model="config.parameters.top_module" type="text" placeholder="e.g. top_module"
                  class="w-full px-4 py-3 bg-(--bg-secondary) border border-(--border-color) rounded-lg text-(--text-primary) placeholder:text-(--text-secondary) focus:outline-none focus:border-(--accent-color) focus:ring-2 focus:ring-(--accent-color)/20 transition-all" />
              </div>
              <div>
                <label class="block text-sm font-medium text-(--text-primary) mb-2">
                  Clock Signal Name <span class="text-red-500">*</span>
                </label>
                <input v-model="config.parameters.clock" type="text" placeholder="e.g. clk"
                  class="w-full px-4 py-3 bg-(--bg-secondary) border border-(--border-color) rounded-lg text-(--text-primary) placeholder:text-(--text-secondary) focus:outline-none focus:border-(--accent-color) focus:ring-2 focus:ring-(--accent-color)/20 transition-all" />
                <p class="mt-1 text-xs text-(--text-secondary)">Main clock signal name used for timing constraints</p>
              </div>
            </div>
          </div>

          <!-- Step 3: Technology Config -->
          <div v-else-if="currentStep === 3" key="step3" class="max-w-2xl mx-auto">
            <div class="mb-8">
              <span class="text-xs font-medium text-(--accent-color) uppercase tracking-wider">Step 3</span>
              <h2 class="text-2xl font-bold text-(--text-primary) mt-1">Technology Setup</h2>
              <p class="text-(--text-secondary) mt-2">Choose target process libraries and design constraints</p>
            </div>

            <div class="space-y-6">
              <!-- PDK Selection -->
              <div>
                <label class="block text-sm font-medium text-(--text-primary) mb-3">
                  Process Design Kit (PDK) <span class="text-red-500">*</span>
                </label>

                <!-- 已导入的 PDK 列表 -->
                <div v-if="importedPdks.length > 0" class="space-y-3">
                  <div class="grid grid-cols-1 gap-3">
                    <button v-for="pdk in importedPdks" :key="pdk.id" @click="selectPdk(pdk)" :class="[
                      'flex items-start gap-4 p-4 rounded-xl border-2 transition-all cursor-pointer text-left group relative',
                      selectedPdkId === pdk.id
                        ? 'border-(--accent-color) bg-(--accent-color)/5'
                        : 'border-(--border-color) hover:border-(--accent-color)/50 bg-(--bg-secondary)'
                    ]">
                      <div :class="[
                        'w-10 h-10 rounded-lg flex items-center justify-center shrink-0',
                        selectedPdkId === pdk.id ? 'bg-(--accent-color) text-white' : 'bg-(--bg-primary) text-(--text-secondary)'
                      ]">
                        <i class="ri-cpu-line text-xl"></i>
                      </div>
                      <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2">
                          <h4 class="font-semibold text-(--text-primary)">{{ pdk.name }}</h4>
                          <span v-if="pdk.techNode"
                            class="text-[10px] px-1.5 py-0.5 rounded bg-(--accent-color)/10 text-(--accent-color) font-medium">
                            {{ pdk.techNode }}
                          </span>
                        </div>
                        <p v-if="pdk.description" class="text-xs text-(--text-secondary) mt-1">{{ pdk.description }}</p>
                        <p class="text-[11px] text-(--text-secondary) mt-1.5 truncate font-mono opacity-60">
                          <i class="ri-folder-line mr-1"></i>{{ pdk.path }}
                        </p>
                        <!-- 目录结构摘要 -->
                        <div v-if="selectedPdkId === pdk.id && pdk.detectedFiles"
                          class="mt-3 pt-3 border-t border-(--border-color)">
                          <p class="text-[11px] font-medium text-(--text-secondary) mb-1.5">Directory Contents:</p>
                          <div class="flex flex-wrap gap-1.5">
                            <span v-for="dir in pdk.detectedFiles.directories" :key="dir"
                              class="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md bg-(--bg-primary) text-(--text-secondary)">
                              <i class="ri-folder-line text-yellow-500"></i>{{ dir }}
                            </span>
                            <span v-for="file in pdk.detectedFiles.files.slice(0, 5)" :key="file"
                              class="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md bg-(--bg-primary) text-(--text-secondary)">
                              <i class="ri-file-line"></i>{{ file }}
                            </span>
                          </div>
                        </div>
                      </div>
                      <!-- 选中标记 -->
                      <div v-if="selectedPdkId === pdk.id"
                        class="absolute top-3 right-3 w-5 h-5 rounded-full bg-(--accent-color) flex items-center justify-center">
                        <i class="ri-check-line text-white text-xs"></i>
                      </div>
                      <!-- 删除按钮 -->
                      <div @click.stop="handleRemovePdk(pdk.id)"
                        class="absolute bottom-3 right-3 p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-red-500/10 transition-all cursor-pointer"
                        title="Remove this PDK">
                        <i class="ri-delete-bin-line text-sm text-(--text-secondary) hover:text-red-500"></i>
                      </div>
                    </button>
                  </div>

                  <!-- 导入更多 PDK -->
                  <button @click="handleImportPdk"
                    class="w-full flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-(--border-color) hover:border-(--accent-color)/50 rounded-xl text-sm text-(--text-secondary) hover:text-(--accent-color) transition-all cursor-pointer">
                    <i class="ri-add-line"></i>
                    Import Another PDK
                  </button>
                </div>

                <!-- 无 PDK 时的空状态 -->
                <div v-else
                  class="flex flex-col items-center py-10 px-6 border-2 border-dashed border-(--border-color) rounded-xl bg-(--bg-secondary)/30">
                  <div class="w-16 h-16 rounded-full bg-(--accent-color)/10 flex items-center justify-center mb-4">
                    <i class="ri-database-2-line text-3xl text-(--accent-color)"></i>
                  </div>
                  <h4 class="font-semibold text-(--text-primary) mb-2">No PDK Imported</h4>
                  <p class="text-sm text-(--text-secondary) text-center mb-5 max-w-sm">
                    Import a Process Design Kit (PDK) directory first. The system will automatically detect the PDK type and included process files.
                  </p>
                  <button @click="handleImportPdk"
                    class="px-6 py-2.5 bg-(--accent-color) text-white rounded-lg hover:opacity-90 transition-opacity font-medium cursor-pointer flex items-center gap-2">
                    <i class="ri-folder-open-line"></i>
                    Select PDK Directory
                  </button>
                </div>
              </div>

              <!-- Target Frequency -->
              <div>
                <label class="block text-sm font-medium text-(--text-primary) mb-2">
                  Target Frequency (MHz)
                </label>
                <div class="flex items-center gap-4">
                  <input v-model.number="config.parameters.frequency_max" type="range" min="10" max="1000" step="10"
                    class="flex-1 h-2 bg-(--bg-secondary) rounded-lg appearance-none cursor-pointer accent-(--accent-color)" />
                  <div
                    class="w-24 px-3 py-2 bg-(--bg-secondary) border border-(--border-color) rounded-lg text-center text-(--text-primary) font-mono">
                    {{ config.parameters.frequency_max }}
                  </div>
                </div>
              </div>

              <!-- Advanced Settings -->
              <div class="pt-4 border-t border-(--border-color)">
                <h3 class="text-sm font-semibold text-(--text-primary) mb-4 flex items-center gap-2">
                  <i class="ri-settings-4-line text-(--accent-color)"></i>
                  Advanced Settings
                </h3>
                <div class="grid grid-cols-2 gap-6">
                  <!-- Core Utilization -->
                  <div>
                    <label class="block text-sm font-medium text-(--text-primary) mb-2">
                      Core Utilization
                    </label>
                    <div class="flex items-center gap-3">
                      <input v-model.number="config.parameters.core_utilization" type="range" min="0.1" max="0.9"
                        step="0.05"
                        class="flex-1 h-2 bg-(--bg-secondary) rounded-lg appearance-none cursor-pointer accent-(--accent-color)" />
                      <div
                        class="w-16 px-2 py-1.5 bg-(--bg-secondary) border border-(--border-color) rounded-lg text-center text-(--text-primary) font-mono text-sm">
                        {{ ((config.parameters.core_utilization as number || 0.5) * 100).toFixed(0) }}%
                      </div>
                    </div>
                    <p class="mt-1 text-xs text-(--text-secondary)">Area utilization ratio of the chip core region</p>
                  </div>

                  <!-- Target Density -->
                  <div>
                    <label class="block text-sm font-medium text-(--text-primary) mb-2">
                      Target Density
                    </label>
                    <div class="flex items-center gap-3">
                      <input v-model.number="config.parameters.target_density" type="range" min="0.1" max="0.9"
                        step="0.05"
                        class="flex-1 h-2 bg-(--bg-secondary) rounded-lg appearance-none cursor-pointer accent-(--accent-color)" />
                      <div
                        class="w-16 px-2 py-1.5 bg-(--bg-secondary) border border-(--border-color) rounded-lg text-center text-(--text-primary) font-mono text-sm">
                        {{ ((config.parameters.target_density as number || 0.6) * 100).toFixed(0) }}%
                      </div>
                    </div>
                    <p class="mt-1 text-xs text-(--text-secondary)">Target density for place and route</p>
                  </div>

                  <!-- Max Fanout -->
                  <div>
                    <label class="block text-sm font-medium text-(--text-primary) mb-2">
                      Max Fanout
                    </label>
                    <input v-model.number="config.parameters.max_fanout" type="number" min="1" max="100"
                      class="w-full px-4 py-2.5 bg-(--bg-secondary) border border-(--border-color) rounded-lg text-(--text-primary) focus:outline-none focus:border-(--accent-color) focus:ring-2 focus:ring-(--accent-color)/20 transition-all" />
                    <p class="mt-1 text-xs text-(--text-secondary)">Maximum load count per driver</p>
                  </div>
                </div>
              </div>
            </div>

            <!-- Tips Card -->
            <div class="mt-8 p-4 bg-(--accent-color)/5 border border-(--accent-color)/20 rounded-xl">
              <div class="flex gap-3">
                <i class="ri-lightbulb-line text-xl text-(--accent-color)"></i>
                <div>
                  <h4 class="font-medium text-(--text-primary)">Tip</h4>
                  <p class="text-sm text-(--text-secondary) mt-1">
                    Choosing the right process library has a major impact on design results. The current ICS55 PDK is suitable for learning and prototyping.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <!-- Step 4: Review -->
          <div v-else-if="currentStep === 4" key="step4" class="max-w-2xl mx-auto">
            <div class="mb-8">
              <span class="text-xs font-medium text-(--accent-color) uppercase tracking-wider">Step 4</span>
              <h2 class="text-2xl font-bold text-(--text-primary) mt-1">Review and Create</h2>
              <p class="text-(--text-secondary) mt-2">Review the configuration, then click Create</p>
            </div>

            <!-- Review Cards -->
            <div class="space-y-4">
              <!-- Basic Info Card -->
              <div class="p-5 bg-(--bg-secondary) rounded-xl border border-(--border-color)">
                <div class="flex items-center justify-between mb-4">
                  <h3 class="font-semibold text-(--text-primary) flex items-center gap-2">
                    <i class="ri-information-line text-(--accent-color)"></i>
                    Basic Info
                  </h3>
                  <button @click="currentStep = 1" class="text-sm text-(--accent-color) hover:underline cursor-pointer">
                    Edit
                  </button>
                </div>
                <div class="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span class="text-(--text-secondary)">Project Name</span>
                    <p class="font-medium text-(--text-primary) mt-1">{{ config.parameters.design || '-' }}</p>
                  </div>
                  <div>
                    <span class="text-(--text-secondary)">Save Location</span>
                    <p class="font-medium text-(--text-primary) mt-1 truncate">{{ config.directory || '-' }}</p>
                  </div>
                  <div class="col-span-2">
                    <span class="text-(--text-secondary)">Project Description</span>
                    <p class="font-medium text-(--text-primary) mt-1">{{ config.parameters.description || 'No description' }}</p>
                  </div>
                </div>
              </div>

              <!-- Design Files Card -->
              <div class="p-5 bg-(--bg-secondary) rounded-xl border border-(--border-color)">
                <div class="flex items-center justify-between mb-4">
                  <h3 class="font-semibold text-(--text-primary) flex items-center gap-2">
                    <i class="ri-file-code-line text-(--accent-color)"></i>
                    Design Files
                  </h3>
                  <button @click="currentStep = 2" class="text-sm text-(--accent-color) hover:underline cursor-pointer">
                    Edit
                  </button>
                </div>
                <div class="text-sm space-y-2">
                  <div class="flex items-center justify-between">
                    <span class="text-(--text-secondary)">File Count</span>
                    <span class="font-medium text-(--text-primary)">{{ config.rtl_list.length }} files</span>
                  </div>
                  <div class="flex items-center justify-between">
                    <span class="text-(--text-secondary)">Top Module</span>
                    <span class="font-medium text-(--text-primary)">{{ config.parameters.top_module || '-' }}</span>
                  </div>
                  <div class="flex items-center justify-between">
                    <span class="text-(--text-secondary)">Clock Signal</span>
                    <span class="font-medium text-(--text-primary)">{{ config.parameters.clock || '-' }}</span>
                  </div>
                </div>
              </div>

              <!-- Technology Card -->
              <div class="p-5 bg-(--bg-secondary) rounded-xl border border-(--border-color)">
                <div class="flex items-center justify-between mb-4">
                  <h3 class="font-semibold text-(--text-primary) flex items-center gap-2">
                    <i class="ri-cpu-line text-(--accent-color)"></i>
                    Technology Setup
                  </h3>
                  <button @click="currentStep = 3" class="text-sm text-(--accent-color) hover:underline cursor-pointer">
                    Edit
                  </button>
                </div>
                <div class="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <span class="text-(--text-secondary)">PDK</span>
                    <p class="font-medium text-(--text-primary) mt-1">{{ getPdkName(config.pdk) }}</p>
                  </div>
                  <div>
                    <span class="text-(--text-secondary)">Target Frequency</span>
                    <p class="font-medium text-(--text-primary) mt-1">{{ config.parameters.frequency_max }} MHz</p>
                  </div>
                  <div>
                    <span class="text-(--text-secondary)">Core Utilization</span>
                    <p class="font-medium text-(--text-primary) mt-1">{{ ((config.parameters.core_utilization as number
                      ||
                      0.5) * 100).toFixed(0) }}%</p>
                  </div>
                  <div>
                    <span class="text-(--text-secondary)">Target Density</span>
                    <p class="font-medium text-(--text-primary) mt-1">{{ ((config.parameters.target_density as number ||
                      0.6)
                      * 100).toFixed(0) }}%</p>
                  </div>
                  <div>
                    <span class="text-(--text-secondary)">Max Fanout</span>
                    <p class="font-medium text-(--text-primary) mt-1">{{ config.parameters.max_fanout }}</p>
                  </div>
                </div>
              </div>
            </div>

            <!-- Ready to Create -->
            <div
              class="mt-6 p-5 bg-linear-to-r from-(--accent-color)/10 to-(--accent-color)/5 border border-(--accent-color)/20 rounded-xl">
              <div class="flex items-center gap-4">
                <div class="w-12 h-12 rounded-full bg-(--accent-color)/20 flex items-center justify-center">
                  <i class="ri-rocket-line text-2xl text-(--accent-color)"></i>
                </div>
                <div>
                  <h4 class="font-semibold text-(--text-primary)">Ready to Create</h4>
                  <p class="text-sm text-(--text-secondary)">All settings are complete. Click the button below to create your chip design project.</p>
                </div>
              </div>
            </div>
          </div>
        </Transition>
      </div>

      <!-- Footer Actions -->
      <div class="px-8 py-5 border-t border-(--border-color) bg-(--bg-secondary)/30 flex items-center justify-between">
        <button v-if="currentStep > 1" @click="prevStep"
          class="px-6 py-2.5 text-(--text-primary) hover:bg-(--bg-secondary) rounded-lg transition-colors font-medium cursor-pointer flex items-center gap-2">
          <i class="ri-arrow-left-line"></i>
          Previous
        </button>
        <div v-else></div>

        <div class="flex items-center gap-3">
          <button @click="$emit('close')"
            class="px-6 py-2.5 text-(--text-secondary) hover:text-(--text-primary) hover:bg-(--bg-secondary) rounded-lg transition-colors font-medium cursor-pointer">
            Cancel
          </button>
          <button v-if="currentStep < 4" @click="nextStep" :disabled="!canProceed"
            class="px-6 py-2.5 bg-(--accent-color) text-white rounded-lg hover:opacity-90 transition-opacity font-medium cursor-pointer flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
            Next
            <i class="ri-arrow-right-line"></i>
          </button>
          <button v-else @click="createProject" :disabled="isCreating"
            class="px-8 py-2.5 bg-(--accent-color) text-white rounded-lg hover:opacity-90 transition-opacity font-medium cursor-pointer flex items-center gap-2 disabled:opacity-50">
            <i v-if="isCreating" class="ri-loader-4-line animate-spin"></i>
            <i v-else class="ri-add-line"></i>
            {{ isCreating ? 'Creating...' : 'Create Project' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { open } from '@tauri-apps/plugin-dialog'
import type { WorkspaceConfig } from '../types'
import { usePdkManager } from '../composables/usePdkManager'

interface Emits {
  (e: 'close'): void
  (e: 'create', config: WorkspaceConfig): void
}

const emit = defineEmits<Emits>()

const currentStep = ref(1)
const isDragging = ref(false)
const isCreating = ref(false)

const steps = [
  { id: 1, title: 'Basic Info' },
  { id: 2, title: 'Design Files' },
  { id: 3, title: 'Technology Setup' },
  { id: 4, title: 'Review & Create' }
]

// PDK 管理
const { importedPdks, loadPdks, importPdk: doImportPdk, removePdk } = usePdkManager()
const selectedPdkId = ref<string>('')

onMounted(async () => {
  await loadPdks()
  // 如果只有一个 PDK，自动选中
  if (importedPdks.value.length === 1) {
    selectPdk(importedPdks.value[0])
  }
})

const config = ref<WorkspaceConfig>({
  directory: '',
  pdk: 'ics55',
  pdk_root: '',
  parameters: {
    // 基本信息
    design: '',           // 项目/设计名称 -> "Design"
    description: '',      // 项目描述
    // 设计参数
    top_module: '',       // 顶层模块名 -> "Top module"
    clock: '',            // 时钟信号名 -> "Clock"
    // 工艺参数
    frequency_max: 100,   // 目标频率 -> "Frequency max [MHz]"
    core_utilization: 0.5, // 核心利用率 -> "Core.Utilitization"
    target_density: 0.6,  // 目标密度 -> "Target density"
    max_fanout: 20        // 最大扇出 -> "Max fanout"
  },
  origin_def: '',
  origin_verilog: '',
  rtl_list: []
})

const canProceed = computed(() => {
  switch (currentStep.value) {
    case 1:
      // 项目名称和保存位置都是必需的
      return config.value.directory.trim() !== '' &&
        (config.value.parameters.design as string)?.trim() !== ''
    case 2:
      // RTL 文件、顶层模块和时钟信号都是必需的
      return config.value.rtl_list.length > 0 &&
        (config.value.parameters.top_module as string)?.trim() !== '' &&
        (config.value.parameters.clock as string)?.trim() !== ''
    case 3:
      return selectedPdkId.value !== ''
    default:
      return true
  }
})

const selectLocation = async () => {
  const result = await open({
    directory: true,
    multiple: false,
    title: 'Select Project Save Location'
  })
  if (result) {
    config.value.directory = result as string
  }
}

const selectDesignFiles = async () => {
  const result = await open({
    multiple: true,
    filters: [{
      name: 'HDL Files',
      extensions: ['v', 'sv', 'vhd', 'vhdl']
    }],
    title: 'Select Design Files'
  })
  if (result) {
    const files = Array.isArray(result) ? result : [result]
    addFiles(files as string[])
  }
}

const handleFileDrop = (event: DragEvent) => {
  isDragging.value = false
  const files = event.dataTransfer?.files
  if (files) {
    const paths = Array.from(files).map(f => f.name)
    // Note: In Tauri, we need to handle this differently
    console.log('Dropped files:', paths)
  }
}

const addFiles = (paths: string[]) => {
  const existing = new Set(config.value.rtl_list)
  for (const path of paths) {
    if (!existing.has(path)) {
      config.value.rtl_list.push(path)
      existing.add(path)
    }
  }
}

const removeFile = (path: string) => {
  config.value.rtl_list = config.value.rtl_list.filter(f => f !== path)
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
  const found = importedPdks.value.find(p => p.pdkId === pdkIdentifier || p.id === selectedPdkId.value)
  return found?.name || pdkIdentifier
}

const nextStep = () => {
  if (currentStep.value < 4 && canProceed.value) {
    currentStep.value++
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
/* Slide fade transition */
.slide-fade-enter-active {
  transition: all 0.3s ease-out;
}

.slide-fade-leave-active {
  transition: all 0.2s ease-in;
}

.slide-fade-enter-from {
  opacity: 0;
  transform: translateX(20px);
}

.slide-fade-leave-to {
  opacity: 0;
  transform: translateX(-20px);
}

/* List transition */
.list-enter-active,
.list-leave-active {
  transition: all 0.3s ease;
}

.list-enter-from,
.list-leave-to {
  opacity: 0;
  transform: translateX(-20px);
}

/* Custom range slider */
input[type="range"] {
  -webkit-appearance: none;
  appearance: none;
  background: var(--bg-secondary);
  border-radius: 8px;
}

input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 18px;
  height: 18px;
  background: var(--accent-color);
  border-radius: 50%;
  cursor: pointer;
  border: 2px solid white;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
}

input[type="range"]::-moz-range-thumb {
  width: 18px;
  height: 18px;
  background: var(--accent-color);
  border-radius: 50%;
  cursor: pointer;
  border: 2px solid white;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
}
</style>
