<script setup lang="ts">
import { computed } from 'vue'
import InputText from 'primevue/inputtext'

const draft = defineModel<Record<string, unknown>>({ required: true })

function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

const rtEntries = computed(() => {
  const inner = draft.value.RT
  const block = isObj(inner) ? inner : draft.value
  return Object.entries(block).sort(([a], [b]) => a.localeCompare(b))
})

function setRtKey(k: string, val: string | undefined): void {
  const s = val ?? ''
  if (isObj(draft.value.RT)) {
    ;(draft.value.RT as Record<string, unknown>)[k] = s
  } else {
    draft.value[k] = s
  }
}
</script>

<template>
  <div class="sc-pro sc-cards" data-accent="cyan">
    <section class="sc-pro-section">
      <div class="sc-pro-section__head">
        <div class="sc-pro-section__stripe" />
        <div class="sc-pro-section__titles">
          <div class="sc-pro-section__title">Router engine flags</div>
          <div class="sc-pro-section__desc">CLI-style flags: parameter name on the left, value on the right</div>
        </div>
      </div>
      <div class="sc-pro-section__body flex flex-col gap-2">
        <div v-for="[k, v] in rtEntries" :key="k" class="sc-pro-flag">
          <div class="sc-pro-flag__key">{{ k }}</div>
          <div class="sc-pro-flag__val min-w-0">
            <InputText
              :model-value="v === null || v === undefined ? '' : String(v)"
              size="small"
              fluid
              class="w-full min-w-0"
              @update:model-value="setRtKey(k, $event)" />
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
