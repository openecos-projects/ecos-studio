<template>
  <div class="flex flex-col h-full bg-(--bg-primary)">
    <!-- 内容区域 -->
    <ScrollPanel class="flex-1">
      <div v-if="!selectedObject" class="flex flex-col items-center justify-center h-full text-center py-12 px-4">
        <i class="ri-cursor-line text-5xl text-(--text-secondary) opacity-30 mb-4"></i>
        <p class="text-[13px] text-(--text-secondary)">
          Select an object to view its properties
        </p>
      </div>

      <div v-else class="p-4 space-y-4">
        <!-- 对象信息 -->
        <div class="flex items-center gap-3 p-3 bg-(--bg-secondary) rounded-lg border border-(--border-color)">
          <div class="w-10 h-10 bg-green-500/10 rounded flex items-center justify-center">
            <i class="ri-share-line text-green-500 text-xl"></i>
          </div>
          <div class="flex-1">
            <h3 class="text-[13px] font-bold text-(--text-primary)">{{ selectedObject.name }}</h3>
            <p class="text-[11px] text-(--text-secondary)">Type: {{ selectedObject.type }}</p>
          </div>
        </div>

        <!-- PHYSICAL PARAMS -->
        <div>
          <h4 class="text-[10px] font-bold text-(--text-secondary) uppercase tracking-wider mb-3">Physical Params</h4>
          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <span class="text-[12px] text-(--text-secondary)">Layer</span>
              <span
                class="px-3 py-1 text-[12px] bg-(--bg-secondary) border border-(--border-color) rounded text-(--text-primary) focus:outline-none focus:border-(--accent-color)">
                {{ selectedObject.layer }}
              </span>
            </div>

            <div class="flex items-center justify-between">
              <span class="text-[12px] text-(--text-secondary)">Width</span>
              <div class="flex items-center gap-2">
                <span type="text" :value="selectedObject.width"
                  class="w-24 px-3 py-1 text-[12px] bg-(--bg-secondary) border border-(--border-color) rounded text-(--text-primary) text-right focus:outline-none focus:border-(--accent-color)">
                  {{ selectedObject.width }}
                </span>
                <span class="text-[11px] text-(--text-secondary)">μm</span>
              </div>
            </div>

            <div class="flex items-center justify-between">
              <span class="text-[12px] text-(--text-secondary)">Spacing</span>
              <div class="flex items-center gap-2">
                <span
                  class="w-24 px-3 py-1 text-[12px] bg-(--bg-secondary) border border-(--border-color) rounded text-(--text-primary) text-right focus:outline-none focus:border-(--accent-color)">
                  {{ selectedObject.spacing }}
                </span>
                <span class="text-[11px] text-(--text-secondary)">μm</span>
              </div>
            </div>

            <div class="flex items-center justify-between">
              <span class="text-[12px] text-(--text-secondary)">Status</span>
              <div class="flex items-center gap-2">
                <span class="w-2 h-2 bg-yellow-500 rounded-full"></span>
                <span class="text-[12px] text-(--text-primary)">{{ selectedObject.status }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- CONNECTIVITY -->
        <div>
          <h4 class="text-[10px] font-bold text-(--text-secondary) uppercase tracking-wider mb-3">Connectivity</h4>
          <div class="space-y-3">
            <div>
              <span class="text-[11px] text-(--text-secondary) mb-1.5 block">Driver</span>
              <div class="px-3 py-2 bg-(--bg-secondary) rounded border border-(--border-color)">
                <code class="text-[11px] text-blue-400 font-mono">{{ selectedObject.driver }}</code>
              </div>
            </div>

            <div>
              <span class="text-[11px] text-(--text-secondary) mb-1.5 block">Load(s)</span>
              <div class="px-3 py-2 bg-(--bg-secondary) rounded border border-(--border-color)">
                <code class="text-[11px] text-blue-400 font-mono">{{ selectedObject.loads }}</code>
              </div>
            </div>
          </div>
        </div>

        <!-- DRC Violation (如果有) -->
        <div v-if="selectedObject.violation" class="p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
          <div class="flex items-start gap-2 mb-3">
            <i class="ri-error-warning-fill text-red-500 text-lg mt-0.5"></i>
            <div class="flex-1">
              <h4 class="text-[13px] font-bold text-red-400 mb-1">DRC Violation</h4>
              <p class="text-[11px] text-red-300 leading-relaxed">
                {{ selectedObject.violation }}
              </p>
            </div>
          </div>
          <button
            class="w-full px-4 py-2 bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 rounded text-[12px] font-medium text-red-300 transition-all">
            Auto-Fix
          </button>
        </div>
      </div>
    </ScrollPanel>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import ScrollPanel from 'primevue/scrollpanel'

// 示例选中对象数据
const selectedObject = ref({
  name: 'net_data_bus_0',
  type: 'Signal',
  layer: 'M3 (Metal 3)',
  width: '0.045',
  spacing: '0.050',
  status: 'Routing',
  driver: 'u_cpu_cluster_0/out_port_a',
  loads: 'u_mem_interface/in_port_0',
  violation: 'Min-spacing violation detected at (340, 250). Gap is 0.03μm, required 0.04μm.'
})
</script>
