<template>
  <div class="space-y-6">
    <div>
      <h3 class="text-lg font-semibold text-(--text-primary)">General RTL Setup</h3>
      <p class="mt-1 text-sm text-(--text-secondary)">
        Prepare → RTL Review → Elaboration → Lint. Simulation is not included in this
        flow.
      </p>
    </div>
    <div class="grid gap-4 sm:grid-cols-2">
      <label class="space-y-2 text-sm text-(--text-primary)">
        <span>Top Module <span class="text-red-500">*</span></span>
        <input
          v-model.trim="topModule"
          class="rtl-input"
          placeholder="e.g. simple_counter"
        />
      </label>
      <label class="space-y-2 text-sm text-(--text-primary)">
        <span>Clock Port (optional)</span>
        <input v-model.trim="clock" class="rtl-input" placeholder="e.g. clk" />
      </label>
      <label class="space-y-2 text-sm text-(--text-primary)">
        <span>Target Frequency (MHz)</span>
        <input v-model.number="frequency" class="rtl-input" type="number" min="1" />
      </label>
    </div>
    <section class="rounded-xl border border-(--border-color) bg-(--bg-secondary)/30 p-5">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h4 class="font-semibold text-(--text-primary)">Design Sources</h4>
        <div class="flex gap-2">
          <button type="button" class="rtl-button" @click="pickFilelist">
            Choose Filelist
          </button>
          <button type="button" class="rtl-button" @click="pickSources">
            Choose RTL Files
          </button>
        </div>
      </div>
      <p class="mt-2 text-xs text-(--text-secondary)">
        Choose a filelist or Verilog/SystemVerilog files. Include at least one .v or .sv
        source.
      </p>
      <div v-if="filelist" class="mt-4 flex items-center gap-3">
        <span class="min-w-0 flex-1 font-mono text-sm break-all">{{ filelist }}</span>
        <button
          type="button"
          aria-label="Remove filelist"
          class="rtl-button"
          @click="filelist = ''"
        >
          Remove
        </button>
      </div>
      <ul v-else-if="rtlFiles.length" class="mt-4 max-h-64 space-y-2 overflow-auto">
        <li v-for="file in rtlFiles" :key="file" class="flex items-center gap-3">
          <span class="min-w-0 flex-1 font-mono text-sm break-all">{{ file }}</span>
          <button
            type="button"
            :aria-label="`Remove ${file}`"
            class="rtl-button"
            @click="rtlFiles = rtlFiles.filter((item) => item !== file)"
          >
            Remove
          </button>
        </li>
      </ul>
      <p v-else class="mt-4 text-sm text-(--text-secondary)">No sources selected.</p>
    </section>
    <ul v-if="issues.length" class="space-y-2 text-sm text-red-400" aria-live="polite">
      <li v-for="issue in issues" :key="issue">{{ issue }}</li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { getDesktopApi } from '@/platform/desktop'

defineProps<{ issues: string[] }>()
const topModule = defineModel<string>('topModule', { required: true })
const clock = defineModel<string>('clock', { required: true })
const frequency = defineModel<number>('frequency', { required: true })
const filelist = defineModel<string>('filelist', { default: '' })
const rtlFiles = defineModel<string[]>('rtlFiles', { required: true })

async function pickFilelist() {
  const selected = await getDesktopApi().dialog.pickFiles({
    title: 'Select RTL Filelist',
    multiple: false,
    filters: [{ name: 'Filelists', extensions: ['f', 'fl', 'filelist'] }],
  })
  if (!selected?.[0]) return
  filelist.value = selected[0]
  rtlFiles.value = []
}

async function pickSources() {
  const selected = await getDesktopApi().dialog.pickFiles({
    title: 'Select RTL Sources',
    multiple: true,
    filters: [{ name: 'Verilog / SystemVerilog', extensions: ['v', 'sv', 'vh', 'svh'] }],
  })
  if (!selected?.length) return
  rtlFiles.value = [...new Set([...rtlFiles.value, ...selected])]
  filelist.value = ''
}
</script>

<style scoped>
.rtl-input {
  display: block;
  width: 100%;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-secondary);
  padding: 10px 12px;
  color: var(--text-primary);
}
.rtl-input:focus {
  outline: 1px solid var(--accent-color);
}
.rtl-button {
  flex-shrink: 0;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 6px 12px;
  font-size: 12px;
  color: var(--text-primary);
}
.rtl-button:hover {
  background: var(--bg-secondary);
}
</style>
