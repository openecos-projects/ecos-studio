<script setup lang="ts">
import InputText from 'primevue/inputtext'
import Textarea from 'primevue/textarea'

const draft = defineModel<Record<string, unknown>>({ required: true })

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
</script>

<template>
  <div class="sc-pro sc-cards" data-accent="emerald">
    <section class="sc-pro-section">
      <div class="sc-pro-section__head">
        <div class="sc-pro-section__stripe" />
        <div class="sc-pro-section__titles">
          <div class="sc-pro-section__title">DRC input</div>
          <div class="sc-pro-section__desc">Technology and layout file paths (absolute paths recommended)</div>
        </div>
      </div>
      <div class="sc-pro-section__body space-y-3 sc-pro-path-field">
        <div class="field min-w-0 max-w-full">
          <label>tech_lef_path</label>
          <InputText
            v-model="(draft.INPUT as Record<string, string>).tech_lef_path"
            size="small"
            fluid
            class="min-w-0 max-w-full" />
        </div>
        <div class="field min-w-0 max-w-full">
          <label>lef_paths</label>
          <Textarea
            v-model="(draft.INPUT as Record<string, string>).lef_paths"
            auto-resize
            rows="3"
            fluid
            class="w-full min-w-0 max-w-full" />
        </div>
        <div class="field min-w-0 max-w-full">
          <label>def_path</label>
          <InputText
            v-model="(draft.INPUT as Record<string, string>).def_path"
            size="small"
            fluid
            class="min-w-0 max-w-full" />
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
        <div class="field min-w-0 max-w-full">
          <label>output_dir_path</label>
          <InputText
            v-model="(draft.OUTPUT as Record<string, string>).output_dir_path"
            size="small"
            fluid
            class="min-w-0 max-w-full" />
        </div>
      </div>
    </section>
  </div>
</template>
