<template>
  <div class="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-xl transition-all p-4 sm:p-6">
    <div
      class="relative w-full max-w-5xl bg-(--bg-primary)/95 backdrop-blur-2xl rounded-[24px] shadow-[0_32px_64px_-16px_rgba(0,0,0,0.5)] border border-white/10 dark:border-white/5 overflow-hidden flex flex-col h-[85vh] max-h-[850px] ring-1 ring-black/5 dark:ring-white/5">
      
      <!-- Top Decorative Gradient -->
      <div class="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500/80 via-(--accent-color)/80 to-purple-500/80"></div>

      <!-- Close Button -->
      <button @click="$emit('close')"
        class="absolute top-6 right-6 z-20 w-8 h-8 flex items-center justify-center rounded-full bg-(--bg-secondary)/80 hover:bg-(--border-color) text-(--text-secondary) hover:text-(--text-primary) transition-colors duration-200 cursor-pointer">
        <i class="ri-close-line text-lg"></i>
      </button>

      <div class="flex flex-col md:flex-row h-full">
        <!-- Sidebar Stepper -->
        <div class="w-full md:w-80 bg-(--bg-secondary)/40 border-r border-(--border-color)/40 p-8 md:p-10 flex flex-col shrink-0 relative">
          <!-- Subtle lighting reflection effect -->
          <div class="absolute top-0 left-0 w-full h-full bg-gradient-to-b from-white/5 to-transparent pointer-events-none"></div>

          <div class="mb-12 relative z-10">
            <h1 class="text-3xl font-bold text-(--text-primary) tracking-tight">New Project</h1>
            <p class="text-sm text-(--text-secondary) mt-2">Configure your chip design environment</p>
          </div>
          
          <div class="flex flex-col gap-8 relative z-10">
            <template v-for="(step, index) in steps" :key="step.id">
              <div class="relative flex items-start gap-4 group"
                   :class="[
                     step.id <= highestStep && step.id !== currentStep ? 'cursor-pointer hover:opacity-80 transition-opacity' : 'cursor-default'
                   ]"
                   @click="handleStepClick(step.id)">
                <!-- Connector Line -->
                <div v-if="index < steps.length - 1" 
                     class="absolute left-5 top-12 bottom-[-32px] w-[2px] -translate-x-1/2 rounded-full transition-colors duration-200"
                     :class="currentStep > step.id ? 'bg-(--accent-color)' : 'bg-(--border-color)/60'">
                </div>

                <!-- Step Indicator -->
                <div class="relative z-10 flex flex-col items-center shrink-0">
                  <div :class="[
                    'w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold transition-colors duration-200 shadow-sm',
                    currentStep > step.id ? 'bg-(--accent-color) text-white ring-4 ring-(--accent-color)/20 border border-transparent' : 
                    currentStep === step.id ? 'bg-(--accent-color) text-white ring-4 ring-(--accent-color)/30 border border-transparent' : 
                    'bg-(--bg-primary)/80 text-(--text-secondary) border border-(--border-color)'
                  ]">
                    <i v-if="currentStep > step.id" class="ri-check-line text-lg"></i>
                    <span v-else>{{ step.id }}</span>
                  </div>
                </div>

                <!-- Step Text -->
                <div class="flex flex-col pt-2 transition-transform duration-200" :class="currentStep === step.id ? 'translate-x-1' : ''">
                  <span :class="[
                    'text-base font-semibold transition-colors duration-200',
                    currentStep >= step.id ? 'text-(--text-primary)' : 'text-(--text-secondary)'
                  ]">{{ step.title }}</span>
                  <span v-if="currentStep === step.id" class="text-xs text-(--accent-color) mt-1 font-medium tracking-wide uppercase">In Progress</span>
                </div>
              </div>
            </template>
          </div>
          
        </div>

        <!-- Main Content Area -->
        <div class="flex-1 flex flex-col min-w-0 bg-transparent relative">
          <!-- Step Content Scrollable Area -->
          <div class="flex-1 overflow-y-auto p-8 md:p-12 custom-scrollbar">
            <Transition name="fade-slide" mode="out-in">
              <!-- Step 1: Basic Info -->
              <div v-if="currentStep === 1" key="step1" class="max-w-2xl mx-auto w-full">
                <div class="mb-10">
                  <h2 class="text-2xl font-bold text-(--text-primary)">Project Basics</h2>
                  <p class="text-(--text-secondary) mt-2">Set up the fundamental details for your new workspace.</p>
                </div>

                <div class="space-y-8">
                  <!-- Project Name -->
                  <div class="group">
                    <label class="block text-sm font-semibold text-(--text-primary) mb-2 group-focus-within:text-(--accent-color) transition-colors duration-200">
                      Project Name <span class="text-red-500">*</span>
                    </label>
                    <input v-model="config.parameters.design" type="text" placeholder="e.g. my_chip_design"
                      :class="[
                        'w-full px-4 py-3.5 bg-(--bg-secondary)/40 border rounded-xl text-(--text-primary) placeholder:text-(--text-secondary)/50 focus:outline-none focus:bg-(--bg-primary)/80 transition-colors duration-200 shadow-sm',
                        designNameError ? 'border-red-500 focus:border-red-500' : 'border-(--border-color) focus:border-(--accent-color)'
                      ]" />
                    <p v-if="designNameError" class="mt-2 text-xs text-red-500 flex items-center gap-1">
                      <i class="ri-error-warning-fill"></i> {{ designNameError }}
                    </p>
                    <p v-else class="mt-2 text-xs text-(--text-secondary) flex items-center gap-1">
                      <i class="ri-error-warning-line"></i> Only letters, numbers, and underscores are allowed; spaces and Chinese characters are not permitted.
                    </p>
                  </div>

                  <!-- Project Description -->
                  <div class="group">
                    <label class="block text-sm font-semibold text-(--text-primary) mb-2 group-focus-within:text-(--accent-color) transition-colors duration-200">
                      Project Description
                    </label>
                    <textarea v-model="config.parameters.description" rows="3" placeholder="Briefly describe your chip design project..."
                      class="w-full px-4 py-3.5 bg-(--bg-secondary)/40 border border-(--border-color) rounded-xl text-(--text-primary) placeholder:text-(--text-secondary)/50 focus:outline-none focus:border-(--accent-color) focus:bg-(--bg-primary)/80 transition-colors duration-200 shadow-sm resize-none"></textarea>
                  </div>

                  <!-- Project Location -->
                  <div class="group">
                    <label class="block text-sm font-semibold text-(--text-primary) mb-2 group-focus-within:text-(--accent-color) transition-colors duration-200">
                      Save Location <span class="text-red-500">*</span>
                    </label>
                    <div class="flex gap-3">
                      <div class="relative flex-1">
                        <div class="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                          <i class="ri-folder-line text-(--text-secondary)"></i>
                        </div>
                        <input v-model="config.directory" type="text" readonly placeholder="Choose a folder..."
                          @click="selectLocation()"
                          :class="[
                            'w-full pl-10 pr-4 py-3.5 bg-(--bg-secondary)/40 border rounded-xl text-(--text-primary) placeholder:text-(--text-secondary)/50 cursor-pointer focus:bg-(--bg-primary)/80 transition-colors duration-200 shadow-sm truncate',
                            directoryError ? 'border-red-500 focus:border-red-500' : 'border-(--border-color) focus:border-(--accent-color)'
                          ]" />
                      </div>
                      <button @click="selectLocation"
                        class="px-6 py-3.5 bg-(--bg-primary)/50 border border-(--border-color) text-(--text-primary) rounded-xl hover:bg-(--bg-secondary) hover:border-(--text-secondary) transition-colors duration-200 font-medium cursor-pointer shadow-sm flex items-center gap-2 shrink-0">
                        Browse
                      </button>
                    </div>
                    <p v-if="directoryError" class="mt-2 text-xs text-red-500 flex items-center gap-1">
                      <i class="ri-error-warning-fill"></i> {{ directoryError }}
                    </p>
                    <p v-else-if="!config.directory" class="mt-2 text-xs text-(--text-secondary) flex items-center gap-1">
                      <i class="ri-information-line"></i> The path cannot contain spaces or Chinese characters.
                    </p>
                  </div>
                </div>
              </div>

              <!-- Step 2: Design Files -->
              <div v-else-if="currentStep === 2" key="step2" class="max-w-2xl mx-auto w-full">
                <div class="mb-10">
                  <h2 class="text-2xl font-bold text-(--text-primary)">Design Files</h2>
                  <p class="text-(--text-secondary) mt-2">Upload or select your RTL design files to be synthesized.</p>
                </div>

                <!-- Drag & Drop Zone -->
                <div @dragover.prevent="isDragging = true" @dragleave.prevent="isDragging = false"
                  @drop.prevent="handleFileDrop" :class="[
                    'relative border-2 border-dashed rounded-2xl p-10 text-center transition-colors duration-200 cursor-pointer group',
                    isDragging
                      ? 'border-(--accent-color) bg-(--accent-color)/5'
                      : 'border-(--border-color) hover:border-(--accent-color)/50 hover:bg-(--bg-secondary)/40'
                  ]" @click="selectDesignFiles">
                  <div class="flex flex-col items-center">
                    <div
                      class="w-20 h-20 rounded-2xl bg-(--bg-secondary)/50 border border-(--border-color) flex items-center justify-center mb-5 shadow-sm transition-colors duration-200"
                      :class="{ 'border-(--accent-color) text-(--accent-color)': isDragging }">
                      <i class="ri-upload-cloud-2-line text-4xl" :class="isDragging ? 'text-(--accent-color)' : 'text-(--text-secondary) group-hover:text-(--accent-color)'"></i>
                    </div>
                    <h3 class="text-lg font-bold text-(--text-primary) mb-2">Click or drag files here</h3>
                    <p class="text-sm text-(--text-secondary) mb-6 max-w-sm">Supports Verilog (.v), SystemVerilog (.sv), and VHDL (.vhd) files</p>
                    <button type="button"
                      class="px-8 py-3 bg-(--accent-color) text-white rounded-xl hover:opacity-90 shadow-sm transition-opacity duration-200 font-medium cursor-pointer">
                      Browse Files
                    </button>
                  </div>
                </div>

                <!-- File List -->
                <div v-if="config.rtl_list.length > 0" class="mt-8 space-y-3">
                  <div class="flex items-center justify-between mb-4">
                    <h4 class="text-sm font-semibold text-(--text-primary)">
                      Added Files <span class="bg-(--bg-secondary) px-2 py-0.5 rounded-full text-xs ml-2">{{ config.rtl_list.length }}</span>
                    </h4>
                  </div>
                  <div class="max-h-48 overflow-y-auto custom-scrollbar pr-2 space-y-2">
                    <TransitionGroup name="list">
                      <div v-for="file in config.rtl_list" :key="file"
                        class="flex items-center justify-between px-4 py-3 bg-(--bg-secondary)/30 rounded-xl border border-(--border-color) group hover:bg-(--bg-secondary)/60 transition-colors duration-200 shadow-sm cursor-default">
                        <div class="flex items-center gap-4 min-w-0">
                          <div class="w-10 h-10 rounded-lg bg-(--bg-primary)/80 flex items-center justify-center border border-(--border-color)/50 shadow-sm">
                            <i :class="[
                              'text-lg',
                              file.endsWith('.v') || file.endsWith('.sv')
                                ? 'ri-file-code-line text-blue-500'
                                : file.endsWith('.vhd')
                                  ? 'ri-file-code-line text-purple-500'
                                  : 'ri-file-line text-(--text-secondary)'
                            ]"></i>
                          </div>
                          <div class="min-w-0">
                            <p class="font-medium text-(--text-primary) truncate text-sm" :title="file">{{ file.split('/').pop() || file }}</p>
                            <p class="text-xs text-(--text-secondary) truncate opacity-70">{{ file }}</p>
                          </div>
                        </div>
                        <button @click.stop="removeFile(file)"
                          class="w-8 h-8 flex items-center justify-center rounded-lg opacity-0 group-hover:opacity-100 hover:bg-red-500/10 transition-colors duration-200 cursor-pointer text-(--text-secondary) hover:text-red-500 shrink-0">
                          <i class="ri-delete-bin-line"></i>
                        </button>
                      </div>
                    </TransitionGroup>
                  </div>
                </div>

                <!-- Top Module and Clock Selection -->
                <div class="mt-8 grid grid-cols-2 gap-6 p-6 bg-(--bg-secondary)/20 rounded-2xl border border-(--border-color)">
                  <div class="group">
                    <label class="block text-sm font-semibold text-(--text-primary) mb-2 group-focus-within:text-(--accent-color) transition-colors duration-200">
                      Top Module Name <span class="text-red-500">*</span>
                    </label>
                    <input v-model="config.parameters.top_module" type="text" placeholder="e.g. top_module"
                      class="w-full px-4 py-3 bg-(--bg-primary)/60 border border-(--border-color) rounded-xl text-(--text-primary) placeholder:text-(--text-secondary)/50 focus:outline-none focus:border-(--accent-color) transition-colors duration-200 shadow-sm" />
                  </div>
                  <div class="group">
                    <label class="block text-sm font-semibold text-(--text-primary) mb-2 group-focus-within:text-(--accent-color) transition-colors duration-200">
                      Clock Signal Name <span class="text-red-500">*</span>
                    </label>
                    <input v-model="config.parameters.clock" type="text" placeholder="e.g. clk"
                      class="w-full px-4 py-3 bg-(--bg-primary)/60 border border-(--border-color) rounded-xl text-(--text-primary) placeholder:text-(--text-secondary)/50 focus:outline-none focus:border-(--accent-color) transition-colors duration-200 shadow-sm" />
                    <p class="mt-2 text-[11px] text-(--text-secondary) leading-tight">Used for timing constraints</p>
                  </div>
                </div>
              </div>

              <!-- Step 3: Technology Config -->
              <div v-else-if="currentStep === 3" key="step3" class="max-w-2xl mx-auto w-full">
                <div class="mb-10">
                  <h2 class="text-2xl font-bold text-(--text-primary)">Technology Setup</h2>
                  <p class="text-(--text-secondary) mt-2">Choose target process libraries and define your design constraints.</p>
                </div>

                <div class="space-y-8">
                  <!-- PDK Selection -->
                  <div>
                    <div class="flex items-center justify-between mb-4">
                      <label class="block text-sm font-semibold text-(--text-primary)">
                        Process Design Kit (PDK) <span class="text-red-500">*</span>
                      </label>
                      <button v-if="importedPdks.length > 0" @click="handleImportPdk" class="text-xs font-medium text-(--accent-color) hover:text-(--accent-color)/80 transition-colors duration-200 flex items-center gap-1 cursor-pointer">
                        <i class="ri-add-line"></i> Import New
                      </button>
                    </div>

                    <div v-if="importedPdks.length > 0" class="grid grid-cols-1 gap-4">
                      <div v-for="pdk in importedPdks" :key="pdk.id" @click="selectPdk(pdk)" :class="[
                        'flex flex-col p-5 rounded-2xl border transition-colors duration-200 cursor-pointer text-left group relative overflow-hidden',
                        selectedPdkId === pdk.id
                          ? 'border-(--accent-color) bg-(--accent-color)/5 shadow-sm'
                          : 'border-(--border-color) hover:bg-(--bg-secondary)/40 bg-(--bg-secondary)/20'
                      ]">
                        <!-- Select indicator line -->
                        <div v-if="selectedPdkId === pdk.id" class="absolute left-0 top-0 bottom-0 w-1 bg-(--accent-color)"></div>

                        <div class="flex items-start gap-4 w-full">
                          <div :class="[
                            'w-12 h-12 rounded-xl flex items-center justify-center shrink-0 shadow-sm transition-colors duration-200',
                            selectedPdkId === pdk.id ? 'bg-(--accent-color) text-white' : 'bg-(--bg-primary)/80 text-(--text-secondary) border border-(--border-color)'
                          ]">
                            <i class="ri-cpu-line text-2xl"></i>
                          </div>
                          
                          <div class="flex-1 min-w-0 pr-8">
                            <div class="flex items-center gap-3">
                              <h4 class="font-bold text-(--text-primary) text-base">{{ pdk.name }}</h4>
                              <span v-if="pdk.techNode"
                                class="text-xs px-2 py-0.5 rounded-full bg-(--accent-color)/10 text-(--accent-color) font-bold border border-(--accent-color)/20">
                                {{ pdk.techNode }}
                              </span>
                            </div>
                            <p v-if="pdk.description" class="text-sm text-(--text-secondary) mt-1.5">{{ pdk.description }}</p>
                            <p class="text-xs text-(--text-secondary) mt-2 truncate font-mono bg-(--bg-primary)/60 px-2 py-1 rounded inline-block border border-(--border-color)/50">
                              <i class="ri-folder-line mr-1 opacity-70"></i>{{ pdk.path }}
                            </p>
                          </div>
                        </div>

                        <!-- 目录结构摘要 -->
                        <div v-if="selectedPdkId === pdk.id && pdk.detectedFiles"
                          class="mt-4 pt-4 border-t border-(--border-color)/50 w-full">
                          <p class="text-[11px] font-semibold text-(--text-secondary) mb-2 uppercase tracking-wider">Contents Detected</p>
                          <div class="flex flex-wrap gap-2">
                            <span v-for="dir in pdk.detectedFiles.directories" :key="dir"
                              class="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg bg-(--bg-primary)/80 text-(--text-secondary) border border-(--border-color)/50 shadow-sm">
                              <i class="ri-folder-fill text-yellow-500/80"></i>{{ dir }}
                            </span>
                            <span v-for="file in pdk.detectedFiles.files.slice(0, 4)" :key="file"
                              class="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg bg-(--bg-primary)/80 text-(--text-secondary) border border-(--border-color)/50 shadow-sm">
                              <i class="ri-file-text-line opacity-70"></i>{{ file }}
                            </span>
                            <span v-if="pdk.detectedFiles.files.length > 4" class="text-xs text-(--text-secondary) px-1 py-1">
                              +{{ pdk.detectedFiles.files.length - 4 }} more
                            </span>
                          </div>
                        </div>
                        
                        <!-- 选中标记 -->
                        <div v-if="selectedPdkId === pdk.id"
                          class="absolute top-5 right-5 w-6 h-6 rounded-full bg-(--accent-color) flex items-center justify-center shadow-sm">
                          <i class="ri-check-line text-white text-sm"></i>
                        </div>
                        
                        <!-- 删除按钮 -->
                        <div @click.stop="handleRemovePdk(pdk.id)"
                          class="absolute top-5 right-5 p-2 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-red-500/10 transition-colors duration-200 cursor-pointer z-10"
                          :class="{'hidden': selectedPdkId === pdk.id}"
                          title="Remove PDK">
                          <i class="ri-delete-bin-line text-(--text-secondary) hover:text-red-500"></i>
                        </div>
                      </div>
                    </div>

                    <!-- 无 PDK 时的空状态 -->
                    <div v-else
                      class="flex flex-col items-center py-12 px-6 border-2 border-dashed border-(--border-color) rounded-2xl bg-(--bg-secondary)/20 hover:bg-(--bg-secondary)/40 transition-colors duration-200">
                      <div class="w-16 h-16 rounded-2xl bg-(--accent-color)/10 flex items-center justify-center mb-5">
                        <i class="ri-database-2-line text-3xl text-(--accent-color)"></i>
                      </div>
                      <h4 class="font-bold text-(--text-primary) mb-2">No PDK Imported</h4>
                      <p class="text-sm text-(--text-secondary) text-center mb-6 max-w-sm">
                        Import a Process Design Kit directory to get started. We'll automatically detect process files.
                      </p>
                      <button @click="handleImportPdk"
                        class="px-6 py-3 bg-(--accent-color) text-white rounded-xl hover:opacity-90 transition-opacity duration-200 font-medium cursor-pointer flex items-center gap-2 shadow-sm">
                        <i class="ri-folder-add-line"></i>
                        Select PDK Directory
                      </button>
                    </div>
                  </div>

                  <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <!-- Target Frequency -->
                    <div>
                      <div class="flex items-center justify-between mb-3">
                        <label class="block text-sm font-semibold text-(--text-primary)">
                          Target Frequency
                        </label>
                        <span class="text-sm font-bold text-(--accent-color) bg-(--accent-color)/10 px-2 py-0.5 rounded-md font-mono">{{ config.parameters.frequency_max }} MHz</span>
                      </div>
                      <input v-model.number="config.parameters.frequency_max" type="range" min="10" max="1000" step="10"
                        class="w-full h-2.5 bg-(--bg-secondary)/60 rounded-full appearance-none cursor-pointer accent-(--accent-color)" />
                    </div>
                    
                    <!-- Max Fanout -->
                    <div class="group">
                      <label class="block text-sm font-semibold text-(--text-primary) mb-2 group-focus-within:text-(--accent-color) transition-colors duration-200">
                        Max Fanout
                      </label>
                      <input v-model.number="config.parameters.max_fanout" type="number" min="1" max="100"
                        class="w-full px-4 py-2.5 bg-(--bg-secondary)/40 border border-(--border-color) rounded-xl text-(--text-primary) focus:outline-none focus:border-(--accent-color) focus:bg-(--bg-primary)/80 transition-colors duration-200 shadow-sm" />
                    </div>
                  </div>

                  <!-- Advanced Settings -->
                  <div class="p-6 rounded-2xl bg-(--bg-secondary)/20 border border-(--border-color)">
                    <h3 class="text-sm font-bold text-(--text-primary) mb-5 flex items-center gap-2">
                      <i class="ri-settings-3-line text-(--accent-color)"></i>
                      Physical Constraints
                    </h3>
                    <div class="grid grid-cols-2 gap-8">
                      <!-- Core Utilization -->
                      <div>
                        <div class="flex items-center justify-between mb-3">
                          <label class="block text-sm font-medium text-(--text-primary)">
                            Core Utilization
                          </label>
                          <span class="text-sm font-bold text-(--text-primary) font-mono">{{ ((config.parameters.core_utilization as number || 0.5) * 100).toFixed(0) }}%</span>
                        </div>
                        <input v-model.number="config.parameters.core_utilization" type="range" min="0.1" max="0.9" step="0.05"
                          class="w-full h-2 bg-(--border-color) rounded-full appearance-none cursor-pointer accent-(--accent-color)" />
                      </div>

                      <!-- Target Density -->
                      <div>
                        <div class="flex items-center justify-between mb-3">
                          <label class="block text-sm font-medium text-(--text-primary)">
                            Target Density
                          </label>
                          <span class="text-sm font-bold text-(--text-primary) font-mono">{{ ((config.parameters.target_density as number || 0.6) * 100).toFixed(0) }}%</span>
                        </div>
                        <input v-model.number="config.parameters.target_density" type="range" min="0.1" max="0.9" step="0.05"
                          class="w-full h-2 bg-(--border-color) rounded-full appearance-none cursor-pointer accent-(--accent-color)" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Step 4: Review -->
              <div v-else-if="currentStep === 4" key="step4" class="max-w-2xl mx-auto w-full">
                <div class="mb-10 text-center">
                  <div class="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center mx-auto mb-4 border border-green-500/20 shadow-sm">
                    <i class="ri-check-double-line text-3xl text-green-500"></i>
                  </div>
                  <h2 class="text-2xl font-bold text-(--text-primary)">Review & Create</h2>
                  <p class="text-(--text-secondary) mt-2">Almost there! Review your configuration before finalizing.</p>
                </div>

                <!-- Review Cards -->
                <div class="space-y-5">
                  <!-- Section 1 & 2 combined -->
                  <div class="bg-(--bg-secondary)/20 rounded-2xl border border-(--border-color) overflow-hidden backdrop-blur-sm">
                    <div class="px-6 py-4 border-b border-(--border-color)/60 flex items-center justify-between bg-(--bg-secondary)/40">
                      <h3 class="font-bold text-(--text-primary) flex items-center gap-2">
                        <i class="ri-folder-info-line text-(--accent-color)"></i>
                        Project details
                      </h3>
                      <button @click="jumpToStep(1)" class="text-sm font-medium text-(--accent-color) hover:text-(--accent-color)/80 transition-colors duration-200 px-3 py-1 rounded-md hover:bg-(--accent-color)/10 cursor-pointer">
                        Edit
                      </button>
                    </div>
                    <div class="p-6 grid grid-cols-2 gap-y-6 gap-x-8">
                      <div>
                        <span class="text-[11px] font-semibold text-(--text-secondary) uppercase tracking-wider">Project Name</span>
                        <p class="font-medium text-(--text-primary) mt-1.5">{{ config.parameters.design || '-' }}</p>
                      </div>
                      <div>
                        <span class="text-[11px] font-semibold text-(--text-secondary) uppercase tracking-wider">Top Module</span>
                        <p class="font-medium text-(--text-primary) mt-1.5 font-mono">{{ config.parameters.top_module || '-' }}</p>
                      </div>
                      <div class="col-span-2">
                        <span class="text-[11px] font-semibold text-(--text-secondary) uppercase tracking-wider">Save Location</span>
                        <p class="font-medium text-(--text-primary) mt-1.5 font-mono text-sm bg-(--bg-primary)/60 p-2.5 rounded-lg border border-(--border-color)/50 truncate">{{ config.directory || '-' }}</p>
                      </div>
                      <div class="col-span-2">
                         <span class="text-[11px] font-semibold text-(--text-secondary) uppercase tracking-wider">Design Files ({{ config.rtl_list.length }})</span>
                         <div class="mt-2 max-h-24 overflow-y-auto pr-2 custom-scrollbar bg-(--bg-primary)/40 rounded-lg border border-(--border-color)/50 p-2">
                           <p v-for="file in config.rtl_list" :key="file" class="text-sm text-(--text-primary) py-1.5 px-2 hover:bg-(--bg-secondary)/50 rounded transition-colors duration-200 truncate flex items-center gap-2">
                             <i class="ri-file-code-line text-(--text-secondary)"></i>{{ file.split('/').pop() }}
                           </p>
                         </div>
                      </div>
                    </div>
                  </div>

                  <!-- Technology Card -->
                  <div class="bg-(--bg-secondary)/20 rounded-2xl border border-(--border-color) overflow-hidden backdrop-blur-sm">
                    <div class="px-6 py-4 border-b border-(--border-color)/60 flex items-center justify-between bg-(--bg-secondary)/40">
                      <h3 class="font-bold text-(--text-primary) flex items-center gap-2">
                        <i class="ri-cpu-line text-(--accent-color)"></i>
                        Technology & Constraints
                      </h3>
                      <button @click="jumpToStep(3)" class="text-sm font-medium text-(--accent-color) hover:text-(--accent-color)/80 transition-colors duration-200 px-3 py-1 rounded-md hover:bg-(--accent-color)/10 cursor-pointer">
                        Edit
                      </button>
                    </div>
                    <div class="p-6 grid grid-cols-2 md:grid-cols-4 gap-6">
                      <div class="col-span-2">
                        <span class="text-[11px] font-semibold text-(--text-secondary) uppercase tracking-wider">PDK</span>
                        <p class="font-bold text-(--text-primary) mt-1.5 flex items-center gap-2 bg-(--bg-primary)/60 px-3 py-1.5 rounded-lg border border-(--border-color)/50 w-fit">
                           {{ getPdkName(config.pdk) }}
                           <i class="ri-checkbox-circle-fill text-green-500"></i>
                        </p>
                      </div>
                      <div class="col-span-2">
                        <span class="text-[11px] font-semibold text-(--text-secondary) uppercase tracking-wider">Clock Signal</span>
                        <p class="font-medium text-(--text-primary) mt-1.5 font-mono bg-(--bg-primary)/60 px-3 py-1.5 rounded-lg border border-(--border-color)/50 w-fit">{{ config.parameters.clock || '-' }}</p>
                      </div>
                      <div>
                        <span class="text-[11px] font-semibold text-(--text-secondary) uppercase tracking-wider">Target Freq</span>
                        <p class="font-medium text-(--text-primary) mt-1.5 font-mono">{{ config.parameters.frequency_max }} MHz</p>
                      </div>
                      <div>
                        <span class="text-[11px] font-semibold text-(--text-secondary) uppercase tracking-wider">Max Fanout</span>
                        <p class="font-medium text-(--text-primary) mt-1.5 font-mono">{{ config.parameters.max_fanout }}</p>
                      </div>
                      <div>
                        <span class="text-[11px] font-semibold text-(--text-secondary) uppercase tracking-wider">Utilization</span>
                        <p class="font-medium text-(--text-primary) mt-1.5 font-mono">{{ ((config.parameters.core_utilization as number || 0.5) * 100).toFixed(0) }}%</p>
                      </div>
                      <div>
                        <span class="text-[11px] font-semibold text-(--text-secondary) uppercase tracking-wider">Density</span>
                        <p class="font-medium text-(--text-primary) mt-1.5 font-mono">{{ ((config.parameters.target_density as number || 0.6) * 100).toFixed(0) }}%</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </Transition>
          </div>

          <!-- Footer Actions -->
          <div class="px-8 md:px-12 py-6 border-t border-(--border-color)/60 bg-(--bg-primary)/80 backdrop-blur-md flex items-center justify-between shrink-0 shadow-[0_-10px_30px_-15px_rgba(0,0,0,0.1)] z-10">
            <button v-if="currentStep > 1" @click="prevStep"
              class="px-6 py-3 text-(--text-primary) bg-(--bg-secondary)/40 border border-(--border-color) hover:bg-(--bg-secondary)/80 rounded-xl transition-colors duration-200 font-semibold cursor-pointer flex items-center gap-2 shadow-sm">
              <i class="ri-arrow-left-line"></i>
              Back
            </button>
            <div v-else></div>

            <div class="flex items-center gap-4">
              <button @click="$emit('close')"
                class="px-6 py-3 text-(--text-secondary) hover:text-(--text-primary) hover:bg-(--bg-secondary)/50 rounded-xl transition-colors duration-200 font-semibold cursor-pointer">
                Cancel
              </button>
              
              <button v-if="highestStep === 4 && currentStep < 4" @click="returnToReview" :disabled="!canProceed"
                class="px-6 py-3 bg-(--bg-secondary)/50 text-(--text-primary) border border-(--border-color) rounded-xl hover:bg-(--bg-secondary) hover:border-(--text-secondary) shadow-sm hover:shadow-md transition-all duration-200 font-semibold cursor-pointer flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
                <i class="ri-check-double-line"></i>
                Save & Return
              </button>
              
              <button v-if="currentStep < 4" @click="nextStep" :disabled="!canProceed"
                class="px-8 py-3 bg-(--accent-color) text-white rounded-xl hover:bg-(--accent-color)/90 shadow-sm hover:shadow-md transition-all duration-200 font-semibold cursor-pointer flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-sm">
                Continue
                <i class="ri-arrow-right-line"></i>
              </button>
              
              <button v-else @click="createProject" :disabled="isCreating"
                class="px-8 py-3 bg-gradient-to-r from-(--accent-color) to-purple-600 text-white rounded-xl hover:opacity-90 shadow-md hover:shadow-lg transition-all duration-200 font-bold cursor-pointer flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
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
const highestStep = ref(1)
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
    frequency_max: 50,   // 目标频率 -> "Frequency max [MHz]"
    core_utilization: 0.2, // 核心利用率 -> "Core.Utilitization"
    target_density: 0.3,  // 目标密度 -> "Target density"
    max_fanout: 32        // 最大扇出 -> "Max fanout"
  },
  origin_def: '',
  origin_verilog: '',
  rtl_list: []
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
      return config.value.directory.trim() !== '' &&
        (config.value.parameters.design as string)?.trim() !== '' &&
        !designNameError.value &&
        !directoryError.value
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
    highestStep.value = Math.max(highestStep.value, currentStep.value)
  }
}

const jumpToStep = (step: number) => {
  highestStep.value = Math.max(highestStep.value, currentStep.value)
  currentStep.value = step
}

const handleStepClick = (targetStep: number) => {
  if (targetStep === currentStep.value) return;
  
  if (targetStep < currentStep.value) {
    jumpToStep(targetStep);
  } else if (targetStep <= highestStep.value && canProceed.value) {
    jumpToStep(targetStep);
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
/* Transition Effects */
.fade-slide-enter-active,
.fade-slide-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
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
input[type="range"] {
  -webkit-appearance: none;
  appearance: none;
  background: transparent;
}

input[type="range"]::-webkit-slider-runnable-track {
  width: 100%;
  height: 6px;
  background: transparent;
  border-radius: 9999px;
  border: 1px solid var(--border-color);
}

input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  background: var(--accent-color);
  border-radius: 50%;
  cursor: pointer;
  border: 2px solid var(--bg-primary);
  box-shadow: 0 0 0 1px var(--border-color), 0 2px 4px rgba(0, 0, 0, 0.2);
  margin-top: -6px;
  transition: box-shadow 0.2s;
}

input[type="range"]::-webkit-slider-thumb:hover {
  box-shadow: 0 0 0 1px var(--accent-color), 0 2px 6px rgba(0, 0, 0, 0.3);
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