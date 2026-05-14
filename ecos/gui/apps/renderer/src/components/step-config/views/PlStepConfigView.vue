<script setup lang="ts">
import { computed, watchEffect } from 'vue'
import InputText from 'primevue/inputtext'
import InputNumber from 'primevue/inputnumber'
import GenericStepConfigView from '../GenericStepConfigView.vue'

const draft = defineModel<Record<string, unknown>>({ required: true })

function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

/**
 * DreamPlace `dreamplace.json`: flat keys at root (`global_place_stages`, `lef_input`, …).
 * ECC `pl_default_config.json`: `{ "PL": { "GP": …, "BUFFER": … } }`.
 * Do not inject empty `PL` onto DreamPlace files or the form binds to the wrong shape.
 */
function isEccPlNestedConfig(d: Record<string, unknown>): boolean {
  const pl = d.PL
  if (!isObj(pl)) return false
  return 'GP' in pl || 'BUFFER' in pl || 'LG' in pl || 'DP' in pl || 'Filler' in pl
}

const useEccPlForm = computed(() => isEccPlNestedConfig(draft.value))

watchEffect(() => {
  if (!useEccPlForm.value) return
  if (!isObj(draft.value.PL)) draft.value.PL = {}
  const pl = draft.value.PL as Record<string, unknown>
  if (!isObj(pl.GP)) pl.GP = {}
  const gp = pl.GP as Record<string, unknown>
  if (!isObj(gp.Wirelength)) gp.Wirelength = {}
  if (!isObj(gp.Density)) gp.Density = {}
  if (!isObj(gp.Nesterov)) gp.Nesterov = {}
  if (!isObj(pl.BUFFER)) pl.BUFFER = {}
  if (!isObj(pl.LG)) pl.LG = {}
  if (!isObj(pl.DP)) pl.DP = {}
  if (!isObj(pl.Filler)) pl.Filler = {}
  const f = pl.Filler as Record<string, unknown>
  if (!Array.isArray(f.first_iter)) f.first_iter = []
  if (!Array.isArray(f.second_iter)) f.second_iter = []
})

const pl = () => draft.value.PL as Record<string, unknown>
const gp = () => pl().GP as Record<string, unknown>
const buf = () => pl().BUFFER as Record<string, unknown>
const lg = () => pl().LG as Record<string, unknown>
const dp = () => pl().DP as Record<string, unknown>
const filler = () => pl().Filler as Record<string, unknown>
</script>

<template>
  <GenericStepConfigView v-if="!useEccPlForm" v-model="draft" />

  <div v-else class="sc-pro sc-cards" data-accent="amber">
    <div class="sc-pro-hero">
      <div class="sc-pro-hero__accent" />
      <div class="sc-pro-hero__body">
        <div class="sc-pro-hero__label">Placement global</div>
        <div class="sc-pro-grid mt-2">
          <div class="field">
            <label>num_threads</label>
            <InputNumber fluid v-model="(pl() as Record<string, number>).num_threads" size="small" :use-grouping="false" class="w-full" />
          </div>
          <div class="field">
            <label>info_iter_num</label>
            <InputNumber fluid v-model="(pl() as Record<string, number>).info_iter_num" size="small" :use-grouping="false" class="w-full" />
          </div>
          <div class="field">
            <label>ignore_net_degree</label>
            <InputNumber fluid v-model="(pl() as Record<string, number>).ignore_net_degree" size="small" :use-grouping="false" class="w-full" />
          </div>
          <div class="field">
            <label>max_length_constraint</label>
            <InputNumber fluid v-model="(pl() as Record<string, number>).max_length_constraint" size="small" :use-grouping="false" class="w-full" />
          </div>
          <div class="field">
            <label>is_max_length_opt</label>
            <InputNumber fluid v-model="(pl() as Record<string, number>).is_max_length_opt" size="small" :min="0" :max="1" :use-grouping="false" class="w-full" />
          </div>
          <div class="field">
            <label>is_timing_effort</label>
            <InputNumber fluid v-model="(pl() as Record<string, number>).is_timing_effort" size="small" :min="0" :max="1" :use-grouping="false" class="w-full" />
          </div>
          <div class="field">
            <label>is_congestion_effort</label>
            <InputNumber fluid v-model="(pl() as Record<string, number>).is_congestion_effort" size="small" :min="0" :max="1" :use-grouping="false" class="w-full" />
          </div>
        </div>
      </div>
    </div>

    <section class="sc-pro-section">
      <div class="sc-pro-section__head">
        <div class="sc-pro-section__stripe" />
        <div class="sc-pro-section__titles">
          <div class="sc-pro-section__title">GP · Global placement</div>
          <div class="sc-pro-section__desc">Global placement: wirelength, density, and Nesterov blocks</div>
        </div>
      </div>
      <div class="sc-pro-section__body space-y-3">
        <div class="field sc-pro-grid--1 max-w-xs">
          <label>global_right_padding</label>
          <InputNumber fluid v-model="(gp() as Record<string, number>).global_right_padding" size="small" :use-grouping="false" class="w-full" />
        </div>

        <div class="sc-pro-subpanel">
          <div class="sc-pro-subpanel__title">Wirelength</div>
          <div class="sc-pro-grid">
            <div v-for="key in Object.keys((gp().Wirelength as object) ?? {}).sort()" :key="key" class="field">
              <label>{{ key }}</label>
              <InputNumber
                v-model="(gp().Wirelength as Record<string, number>)[key]"
                size="small"
                fluid
                :use-grouping="false"
                class="w-full min-w-0" />
            </div>
          </div>
        </div>

        <div class="sc-pro-subpanel">
          <div class="sc-pro-subpanel__title">Density</div>
          <div class="sc-pro-grid">
            <div v-for="key in Object.keys((gp().Density as object) ?? {}).sort()" :key="key" class="field">
              <label>{{ key }}</label>
              <InputNumber
                v-model="(gp().Density as Record<string, number>)[key]"
                size="small"
                fluid
                :use-grouping="false"
                class="w-full min-w-0" />
            </div>
          </div>
        </div>

        <div class="sc-pro-subpanel">
          <div class="sc-pro-subpanel__title">Nesterov</div>
          <div class="sc-pro-grid">
            <div v-for="key in Object.keys((gp().Nesterov as object) ?? {}).sort()" :key="key" class="field">
              <label>{{ key }}</label>
              <InputNumber
                v-model="(gp().Nesterov as Record<string, number>)[key]"
                size="small"
                fluid
                :use-grouping="false"
                class="w-full min-w-0" />
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="sc-pro-section">
      <div class="sc-pro-section__head">
        <div class="sc-pro-section__stripe" />
        <div class="sc-pro-section__titles">
          <div class="sc-pro-section__title">BUFFER</div>
        </div>
      </div>
      <div class="sc-pro-section__body">
        <div class="field max-w-xs">
          <label>max_buffer_num</label>
          <InputNumber fluid v-model="(buf() as Record<string, number>).max_buffer_num" size="small" :use-grouping="false" class="w-full" />
        </div>
        <div class="field min-w-0">
          <label>buffer_type</label>
          <div class="space-y-1 w-full min-w-0">
            <div
              v-for="(_x, i) in (buf().buffer_type as string[])"
              :key="i"
              class="flex w-full min-w-0 gap-2 items-center">
              <InputText
                v-model="(buf().buffer_type as string[])[i]"
                size="small"
                fluid
                class="min-w-0 flex-1 font-mono text-[11px]" />
              <button
                type="button"
                class="sc-pro-btn sc-pro-btn--danger shrink-0"
                @click="(buf().buffer_type as string[]).splice(i, 1)">
                <i class="ri-close-line"></i>
              </button>
            </div>
            <button type="button" class="sc-pro-btn" @click="(buf().buffer_type as string[]).push('')">
              <i class="ri-add-line"></i>
            </button>
          </div>
        </div>
      </div>
    </section>

    <section class="sc-pro-section">
      <div class="sc-pro-section__head">
        <div class="sc-pro-section__stripe" />
        <div class="sc-pro-section__titles">
          <div class="sc-pro-section__title">LG / DP</div>
          <div class="sc-pro-section__desc">Legalization and detailed placement</div>
        </div>
      </div>
      <div class="sc-pro-section__body sc-pro-grid">
        <div v-for="key in Object.keys(lg()).sort()" :key="'lg-' + key" class="field">
          <label>LG · {{ key }}</label>
          <InputNumber fluid v-model="(lg() as Record<string, number>)[key]" size="small" :use-grouping="false" class="w-full" />
        </div>
        <div v-for="key in Object.keys(dp()).sort()" :key="'dp-' + key" class="field">
          <label>DP · {{ key }}</label>
          <InputNumber
            v-if="typeof (dp() as Record<string, unknown>)[key] === 'number'"
            v-model="(dp() as Record<string, number>)[key]"
            size="small"
            fluid
            :use-grouping="false"
            class="w-full min-w-0" />
          <InputText
            v-else
            v-model="(dp() as Record<string, string>)[key]"
            size="small"
            fluid
            class="w-full min-w-0" />
        </div>
      </div>
    </section>

    <section class="sc-pro-section">
      <div class="sc-pro-section__head">
        <div class="sc-pro-section__stripe" />
        <div class="sc-pro-section__titles">
          <div class="sc-pro-section__title">Filler</div>
        </div>
      </div>
      <div class="sc-pro-section__body space-y-3">
        <div class="field max-w-xs">
          <label>min_filler_width</label>
          <InputNumber fluid v-model="(filler() as Record<string, number>).min_filler_width" size="small" :use-grouping="false" class="w-full" />
        </div>
        <div class="field min-w-0">
          <label>first_iter</label>
          <div class="space-y-1 w-full min-w-0">
            <div
              v-for="(_x, i) in (filler().first_iter as string[])"
              :key="'f1-' + i"
              class="flex w-full min-w-0 gap-2 items-center">
              <InputText
                v-model="(filler().first_iter as string[])[i]"
                size="small"
                fluid
                class="min-w-0 flex-1 font-mono text-[11px]" />
              <button
                type="button"
                class="sc-pro-btn sc-pro-btn--danger shrink-0"
                @click="(filler().first_iter as string[]).splice(i, 1)">
                <i class="ri-close-line"></i>
              </button>
            </div>
            <button type="button" class="sc-pro-btn" @click="(filler().first_iter as string[]).push('')">
              <i class="ri-add-line"></i>
            </button>
          </div>
        </div>
        <div class="field min-w-0">
          <label>second_iter</label>
          <div class="space-y-1 w-full min-w-0">
            <div
              v-for="(_x, i) in (filler().second_iter as string[])"
              :key="'f2-' + i"
              class="flex w-full min-w-0 gap-2 items-center">
              <InputText
                v-model="(filler().second_iter as string[])[i]"
                size="small"
                fluid
                class="min-w-0 flex-1 font-mono text-[11px]" />
              <button
                type="button"
                class="sc-pro-btn sc-pro-btn--danger shrink-0"
                @click="(filler().second_iter as string[]).splice(i, 1)">
                <i class="ri-close-line"></i>
              </button>
            </div>
            <button type="button" class="sc-pro-btn" @click="(filler().second_iter as string[]).push('')">
              <i class="ri-add-line"></i>
            </button>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
