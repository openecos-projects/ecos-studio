<template>
  <section
    v-if="rows.length"
    class="my-4 border border-(--border-color) bg-(--bg-secondary)/30 p-4"
  >
    <div class="mb-3 flex items-center justify-between gap-3">
      <h3 class="text-sm font-semibold text-(--text-primary)">{{ title }}</h3>
      <span class="text-xs text-(--text-secondary)">{{ executionState }}</span>
    </div>
    <table
      class="selectable w-full table-fixed border-collapse text-left text-xs text-(--text-secondary)"
    >
      <thead>
        <tr class="border-b border-(--border-color)">
          <th scope="col" class="w-40 py-2 font-medium">Key</th>
          <th scope="col" class="py-2 font-medium">Value</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="[key, value] in rows"
          :key="key"
          class="border-b border-(--border-color)/60"
        >
          <th scope="row" class="py-2 pr-3 align-top font-medium text-(--text-secondary)">
            {{ key }}
          </th>
          <td class="py-2 break-all text-(--text-primary)">{{ value }}</td>
        </tr>
      </tbody>
    </table>
    <p
      v-if="confirmationText"
      class="selectable mt-4 text-xs leading-5 whitespace-pre-line text-(--text-primary)"
    >
      {{ confirmationText }}
    </p>
  </section>
</template>

<script setup lang="ts">
defineProps<{
  confirmationText?: string
  executionState: string
  rows: [string, string][]
  title: string
}>()
</script>
