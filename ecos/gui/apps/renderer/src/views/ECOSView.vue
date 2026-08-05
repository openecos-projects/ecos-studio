<template>
  <div
    class="relative flex h-full w-full flex-col items-center justify-center overflow-hidden text-(--text-primary)"
  >
    <div class="relative z-10 flex w-full max-w-4xl flex-col items-center px-8">
      <!-- Logo + Title -->
      <div class="mb-10 flex items-center justify-center">
        <div class="relative">
          <div
            class="absolute -inset-4 rounded-full bg-(--accent-color)/10 blur-xl"
          ></div>
          <i class="ri-cpu-line relative text-6xl text-(--accent-color)"></i>
        </div>
        <div class="ml-5 flex flex-col">
          <h1 class="text-4xl font-bold tracking-tight text-(--text-primary)">
            ECOS Studio
          </h1>
        </div>
      </div>

      <!-- Design Tools -->
      <div class="mb-8 w-full max-w-2xl">
        <h3
          class="mb-3 px-1 text-xs font-semibold tracking-wider text-(--text-secondary) uppercase"
        >
          Design Tools
        </h3>
        <div class="grid grid-cols-2 gap-4">
          <!-- Frontend Design -->
          <button
            @click="navigateToFE"
            class="group flex cursor-pointer flex-col items-center justify-center rounded-xl border border-(--border-color) bg-(--bg-secondary) py-8 transition-all duration-200 hover:scale-[1.02] hover:border-(--accent-color) hover:shadow-(--accent-color)/5 hover:shadow-lg"
          >
            <div
              class="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-(--bg-primary)"
            >
              <i
                class="ri-code-s-slash-line text-2xl text-(--text-secondary) transition-colors group-hover:text-(--accent-color)"
              ></i>
            </div>
            <span class="mb-1 text-sm font-medium text-(--text-primary)"
              >Frontend Design</span
            >
            <span class="text-xs text-(--text-secondary)"
              >RTL / Verilog / SystemVerilog</span
            >
          </button>
          <!-- Backend Design -->
          <button
            @click="navigateToECC"
            class="group flex cursor-pointer flex-col items-center justify-center rounded-xl border border-(--border-color) bg-(--bg-secondary) py-8 transition-all duration-200 hover:scale-[1.02] hover:border-(--accent-color) hover:shadow-(--accent-color)/5 hover:shadow-lg"
          >
            <div
              class="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-(--bg-primary) transition-colors group-hover:bg-(--accent-color)/10"
            >
              <i
                class="ri-cpu-line text-2xl text-(--text-secondary) transition-colors group-hover:text-(--accent-color)"
              ></i>
            </div>
            <span class="mb-1 text-sm font-medium text-(--text-primary)"
              >Backend Design</span
            >
            <span class="text-xs text-(--text-secondary)">Synthesis → P&R → GDS</span>
          </button>
        </div>
      </div>

      <!-- Quick links -->
      <div class="mb-8 w-full max-w-2xl">
        <div class="grid grid-cols-2 gap-4">
          <div>
            <div class="space-y-2">
              <button
                @click="navigateToTools"
                class="group flex w-full cursor-pointer items-center gap-3 rounded-lg border border-(--border-color) bg-(--bg-secondary) px-4 py-3 text-left transition-all duration-200 hover:border-(--accent-color)"
              >
                <i class="ri-tools-line text-lg text-(--accent-color)"></i>
                <span class="min-w-0 flex-1">
                  <span class="block text-sm font-medium text-(--text-primary)"
                    >Resource Manager</span
                  >
                  <span class="block truncate text-xs text-(--text-secondary)"
                    >EDA tools and PDKs</span
                  >
                </span>
                <i
                  class="ri-arrow-right-s-line text-lg text-(--text-secondary) transition-colors group-hover:text-(--accent-color)"
                ></i>
              </button>

              <button
                @click="handleNotReady"
                class="group flex w-full cursor-pointer items-center gap-3 rounded-lg border border-(--border-color) bg-(--bg-secondary) px-4 py-3 text-left opacity-50 transition-all duration-200 hover:border-(--accent-color)"
              >
                <i class="ri-puzzle-line text-lg text-(--text-secondary)"></i>
                <span class="text-sm text-(--text-primary)">IP Catalog</span>
              </button>
            </div>
          </div>

          <div>
            <div class="space-y-2">
              <button
                @click="navigateToMpcResources"
                class="group flex w-full cursor-pointer items-center gap-3 rounded-lg border border-(--border-color) bg-(--bg-secondary) px-4 py-3 text-left transition-all duration-200 hover:border-(--accent-color)"
              >
                <i class="ri-layout-grid-line text-lg text-(--accent-color)"></i>
                <span class="min-w-0 flex-1">
                  <span class="block text-sm font-medium text-(--text-primary)"
                    >MPC Resources</span
                  >
                  <span class="block truncate text-xs text-(--text-secondary)"
                    >Templates and core constraints</span
                  >
                </span>
                <i
                  class="ri-arrow-right-s-line text-lg text-(--text-secondary) transition-colors group-hover:text-(--accent-color)"
                ></i>
              </button>

              <button
                @click="handleNotReady"
                class="group flex w-full cursor-pointer items-center gap-3 rounded-lg border border-(--border-color) bg-(--bg-secondary) px-4 py-3 text-left opacity-50 transition-all duration-200 hover:border-(--accent-color)"
              >
                <i class="ri-bar-chart-box-line text-lg text-(--text-secondary)"></i>
                <span class="text-sm text-(--text-primary)">Benchmarks</span>
              </button>
            </div>
          </div>
        </div>
      </div>
      <!-- Project Management entry -->
      <button
        @click="navigateToProjects"
        class="group flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-(--border-color) px-6 py-3 text-(--text-secondary) transition-all duration-200 hover:border-(--accent-color) hover:text-(--accent-color)"
      >
        <i
          class="ri-folder-settings-line text-lg transition-colors group-hover:text-(--accent-color)"
        ></i>
        <span class="text-sm font-medium">Project Management</span>
        <i
          class="ri-arrow-right-s-line text-lg transition-transform group-hover:translate-x-0.5"
        ></i>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'

const router = useRouter()

const navigateToECC = () => router.push('/ecc')
const navigateToFE = () => router.push('/fe')
const navigateToProjects = () => router.push('/projects')
const navigateToTools = () => router.push('/tools')
const navigateToMpcResources = () => router.push('/mpc')
const handleNotReady = () => {
  /* placeholder */
}
</script>
