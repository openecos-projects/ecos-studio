<script setup lang="ts">
import { onMounted } from 'vue'
import InputText from 'primevue/inputtext'
import Textarea from 'primevue/textarea'
import { useStepConfigDiff } from '../stepConfigDiff'

const draft = defineModel<Record<string, unknown>>({ required: true })
const emit = defineEmits<{ initialized: [] }>()

withDefaults(
  defineProps<{
    readonly?: boolean
  }>(),
  { readonly: false },
)

const diff = useStepConfigDiff()

function isChanged(path: string): boolean {
  return diff?.isChanged(path) ?? false
}

function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function ensure(): void {
  if (!isObj(draft.value.INPUT)) {
    draft.value.INPUT = { tech_lef_path: '', lef_paths: '', def_path: '' }
  }
  if (!isObj(draft.value.OUTPUT)) {
    draft.value.OUTPUT = { output_dir_path: '' }
  }
}

ensure()
onMounted(() => emit('initialized'))
</script>

<template>
  <div
    class="sc-pro sc-cards"
    :class="{ 'is-readonly': readonly }"
    :inert="readonly"
    data-accent="emerald"
  >
    <section class="sc-pro-section">
      <div class="sc-pro-section__head">
        <div class="sc-pro-section__stripe" />
        <div class="sc-pro-section__titles">
          <div class="sc-pro-section__title">DRC input</div>
          <div class="sc-pro-section__desc">
            Technology and layout file paths (absolute paths recommended)
          </div>
        </div>
      </div>
      <div class="sc-pro-section__body sc-pro-path-field space-y-3">
        <div
          class="field max-w-full min-w-0"
          :class="{ 'sc-diff': isChanged('INPUT.tech_lef_path') }"
        >
          <label>tech_lef_path</label>
          <InputText
            v-model="(draft.INPUT as Record<string, string>).tech_lef_path"
            size="small"
            fluid
            class="max-w-full min-w-0"
          />
        </div>
        <div
          class="field max-w-full min-w-0"
          :class="{ 'sc-diff': isChanged('INPUT.lef_paths') }"
        >
          <label>lef_paths</label>
          <Textarea
            v-model="(draft.INPUT as Record<string, string>).lef_paths"
            auto-resize
            rows="3"
            fluid
            class="w-full max-w-full min-w-0"
          />
        </div>
        <div
          class="field max-w-full min-w-0"
          :class="{ 'sc-diff': isChanged('INPUT.def_path') }"
        >
          <label>def_path</label>
          <InputText
            v-model="(draft.INPUT as Record<string, string>).def_path"
            size="small"
            fluid
            class="max-w-full min-w-0"
          />
        </div>
      </div>
    </section>
    <section class="sc-pro-section">
      <div class="sc-pro-section__head">
        <div class="sc-pro-section__stripe" />
        <div class="sc-pro-section__titles">
          <div class="sc-pro-section__title">DRC output</div>
          <div class="sc-pro-section__desc">Results output directory</div>
        </div>
      </div>
      <div class="sc-pro-section__body sc-pro-path-field">
        <div
          class="field max-w-full min-w-0"
          :class="{ 'sc-diff': isChanged('OUTPUT.output_dir_path') }"
        >
          <label>output_dir_path</label>
          <InputText
            v-model="(draft.OUTPUT as Record<string, string>).output_dir_path"
            size="small"
            fluid
            class="max-w-full min-w-0"
          />
        </div>
      </div>
    </section>
  </div>
</template>
