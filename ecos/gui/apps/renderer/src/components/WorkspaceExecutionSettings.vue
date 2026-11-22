<template>
  <div class="mt-4 max-w-lg">
    <label
      for="workspace-step-execution"
      class="block text-sm font-semibold text-(--text-primary)"
      >Analysis scheduling</label
    >
    <select
      id="workspace-step-execution"
      v-model="stepSubprocess"
      :disabled="!supported"
      aria-describedby="workspace-step-execution-help"
      class="mt-2 w-full cursor-pointer rounded-lg border border-(--border-color) bg-(--bg-primary) px-3 py-2 text-sm text-(--text-primary) disabled:cursor-not-allowed disabled:opacity-50"
    >
      <option v-if="inherit" :value="undefined">Inherit source workspace</option>
      <option :value="true">Parallel checks (recommended)</option>
      <option :value="false">Sequential checks</option>
    </select>
    <p id="workspace-step-execution-help" class="mt-2 text-xs text-(--text-secondary)">
      {{
        supported
          ? 'Independent checks can run in parallel when memory permits.'
          : 'Update ECC to configure analysis scheduling for this workspace.'
      }}
    </p>
  </div>
</template>

<script setup lang="ts">
defineProps<{ supported: boolean; inherit?: boolean }>()
const stepSubprocess = defineModel<boolean | undefined>({ required: true })
</script>
