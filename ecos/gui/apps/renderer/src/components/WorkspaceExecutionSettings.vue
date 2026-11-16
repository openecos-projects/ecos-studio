<template>
  <div class="mt-4 max-w-lg">
    <label
      for="workspace-step-execution"
      class="block text-sm font-semibold text-(--text-primary)"
      >Step execution</label
    >
    <select
      id="workspace-step-execution"
      v-model="stepSubprocess"
      :disabled="!supported"
      aria-describedby="workspace-step-execution-help"
      class="mt-2 w-full cursor-pointer rounded-lg border border-(--border-color) bg-(--bg-primary) px-3 py-2 text-sm text-(--text-primary) disabled:cursor-not-allowed disabled:opacity-50"
    >
      <option v-if="inherit" :value="undefined">Inherit source workspace</option>
      <option :value="true">Isolated processes (recommended)</option>
      <option :value="false">In-process, sequential</option>
    </select>
    <p id="workspace-step-execution-help" class="mt-2 text-xs text-(--text-secondary)">
      {{
        supported
          ? 'Saved for this workspace. Isolated processes allow independent checks to run in parallel when memory permits.'
          : 'Update ECC to configure step execution for this workspace.'
      }}
    </p>
  </div>
</template>

<script setup lang="ts">
defineProps<{ supported: boolean; inherit?: boolean }>()
const stepSubprocess = defineModel<boolean | undefined>({ required: true })
</script>
