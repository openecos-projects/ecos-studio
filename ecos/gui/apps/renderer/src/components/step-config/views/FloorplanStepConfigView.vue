<script setup lang="ts">
import { onMounted, watchEffect } from 'vue'
import InputText from 'primevue/inputtext'
import InputNumber from 'primevue/inputnumber'
import Checkbox from 'primevue/checkbox'
import Select from 'primevue/select'
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

/** Baseline-comparison highlighting; leaf-level for direct fields, container-level for panels. */
function isChanged(path: string): boolean {
  return diff?.isChanged(path) ?? false
}

function changedUnder(prefix: string): boolean {
  return (diff?.changedCountUnder(prefix) ?? 0) > 0
}

onMounted(() => emit('initialized'))

function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

const dieModeOptions = [
  { label: 'die_util', value: 'die_util' },
  { label: 'die_size', value: 'die_size' },
]

watchEffect(() => {
  if (!isObj(draft.value.ifp)) draft.value.ifp = {}
  if (!isObj(draft.value.macro_placer)) draft.value.macro_placer = {}
  if (!isObj(draft.value.die_builder)) draft.value.die_builder = {}
  if (!isObj(draft.value.io_placer)) draft.value.io_placer = {}
  if (!isObj(draft.value.phy_placer)) draft.value.phy_placer = {}
  if (!isObj(draft.value.pdn_generator)) draft.value.pdn_generator = {}

  const die = draft.value.die_builder as Record<string, unknown>
  if (!isObj(die.margin)) die.margin = {}
  if (!isObj(die.die_util)) die.die_util = {}
  if (!isObj(die.die_size)) die.die_size = {}
  if (die.mode !== 'die_util' && die.mode !== 'die_size') die.mode = 'die_util'

  const io = draft.value.io_placer as Record<string, unknown>
  if (!Array.isArray(io.io_layer_list)) io.io_layer_list = []

  const phy = draft.value.phy_placer as Record<string, unknown>
  if (!isObj(phy.well_tap)) phy.well_tap = {}
  if (!isObj(phy.side_endcap)) phy.side_endcap = {}
  if (!isObj(phy.edge_endcap)) phy.edge_endcap = {}
  if (!isObj(phy.boundary_tap)) phy.boundary_tap = {}
  const edge = phy.edge_endcap as Record<string, unknown>
  if (!Array.isArray(edge.top_cell_name_list)) edge.top_cell_name_list = []
  if (!Array.isArray(edge.bottom_cell_name_list)) edge.bottom_cell_name_list = []
  const tap = phy.boundary_tap as Record<string, unknown>
  if (!Array.isArray(tap.top_cell_name_list)) tap.top_cell_name_list = []
  if (!Array.isArray(tap.bottom_cell_name_list)) tap.bottom_cell_name_list = []

  const pdn = draft.value.pdn_generator as Record<string, unknown>
  if (!Array.isArray(pdn.global_connect)) pdn.global_connect = []
  if (!Array.isArray(pdn.rail)) pdn.rail = []
  if (!Array.isArray(pdn.stripe)) pdn.stripe = []
  if (!Array.isArray(pdn.connect_layers)) pdn.connect_layers = []
})

const ifp = () => draft.value.ifp as Record<string, unknown>
const macro = () => draft.value.macro_placer as Record<string, unknown>
const die = () => draft.value.die_builder as Record<string, unknown>
const margin = () => die().margin as Record<string, unknown>
const dieUtil = () => die().die_util as Record<string, unknown>
const dieSize = () => die().die_size as Record<string, unknown>
const io = () => draft.value.io_placer as Record<string, unknown>
const phy = () => draft.value.phy_placer as Record<string, unknown>
const wellTap = () => phy().well_tap as Record<string, unknown>
const sideEndcap = () => phy().side_endcap as Record<string, unknown>
const edgeEndcap = () => phy().edge_endcap as Record<string, unknown>
const boundaryTap = () => phy().boundary_tap as Record<string, unknown>
const pdn = () => draft.value.pdn_generator as Record<string, unknown>

function stringList(obj: Record<string, unknown>, key: string): string[] {
  if (!Array.isArray(obj[key])) obj[key] = []
  return obj[key] as string[]
}

function addString(list: string[]): void {
  list.push('')
}

function removeString(list: string[], index: number): void {
  list.splice(index, 1)
}

function addGlobalConnect(): void {
  ;(pdn().global_connect as Record<string, unknown>[]).push({
    net_name: '',
    instance_pin_name: '',
    is_power: false,
  })
}

function removeGlobalConnect(index: number): void {
  ;(pdn().global_connect as unknown[]).splice(index, 1)
}

function addRail(): void {
  ;(pdn().rail as Record<string, unknown>[]).push({
    routing_layer_name: '',
    width_micron: 0,
  })
}

function removeRail(index: number): void {
  ;(pdn().rail as unknown[]).splice(index, 1)
}

function addStripe(): void {
  ;(pdn().stripe as Record<string, unknown>[]).push({
    routing_layer_name: '',
    width_micron: 0,
    pitch_micron: 0,
    offset_micron: 0,
  })
}

function removeStripe(index: number): void {
  ;(pdn().stripe as unknown[]).splice(index, 1)
}

function addConnectLayer(): void {
  ;(pdn().connect_layers as Record<string, unknown>[]).push({
    bottom_routing_layer_name: '',
    top_routing_layer_name: '',
  })
}

function removeConnectLayer(index: number): void {
  ;(pdn().connect_layers as unknown[]).splice(index, 1)
}

function tableNumStr(n: unknown): string {
  if (n === undefined || n === null) return ''
  const x = Number(n)
  return Number.isFinite(x) ? String(x) : ''
}

function setRowNum(
  row: Record<string, unknown>,
  key: string,
  raw: string | undefined,
): void {
  const s = (raw ?? '').trim()
  if (s === '') {
    row[key] = 0
    return
  }
  const n = Number(s)
  row[key] = Number.isFinite(n) ? n : 0
}

function setDieMode(value: unknown): void {
  die().mode = value === 'die_size' ? 'die_size' : 'die_util'
}
</script>

<template>
  <div
    class="sc-pro sc-cards"
    :class="{ 'is-readonly': readonly }"
    :inert="readonly"
    data-accent="indigo"
  >
    <div class="sc-pro-hero">
      <div class="sc-pro-hero__accent" />
      <div class="sc-pro-hero__body">
        <div class="sc-pro-hero__label">ifp</div>
        <div class="sc-pro-grid mt-2">
          <div class="field" :class="{ 'sc-diff': isChanged('ifp.thread_number') }">
            <label>thread_number</label>
            <InputNumber
              v-model="(ifp() as Record<string, number>).thread_number"
              size="small"
              fluid
              :use-grouping="false"
              class="w-full min-w-0"
            />
          </div>
          <div
            class="field sc-pro-grid__full"
            :class="{ 'sc-diff': isChanged('ifp.temp_directory_path') }"
          >
            <label>temp_directory_path</label>
            <InputText
              v-model="(ifp() as Record<string, string>).temp_directory_path"
              size="small"
              fluid
              class="sc-mono w-full min-w-0"
            />
          </div>
        </div>
        <p class="sc-pro-hero__hint">Floorplan runtime and workspace temp directory</p>
      </div>
    </div>

    <section class="sc-pro-section">
      <div
        class="sc-pro-section__head"
        :class="{ 'sc-diff-panel': changedUnder('die_builder') }"
      >
        <div class="sc-pro-section__stripe" />
        <div class="sc-pro-section__titles">
          <div class="sc-pro-section__title">die_builder</div>
          <div class="sc-pro-section__desc">
            Die geometry from utilization or explicit size
          </div>
        </div>
      </div>
      <div class="sc-pro-section__body space-y-3">
        <div class="sc-pro-grid">
          <div class="field" :class="{ 'sc-diff': isChanged('die_builder.mode') }">
            <label>mode</label>
            <Select
              :model-value="die().mode as string"
              :options="dieModeOptions"
              option-label="label"
              option-value="value"
              size="small"
              fluid
              class="min-w-0"
              @update:model-value="setDieMode"
            />
          </div>
          <div class="field" :class="{ 'sc-diff': isChanged('die_builder.site_name') }">
            <label>site_name</label>
            <InputText
              v-model="(die() as Record<string, string>).site_name"
              size="small"
              fluid
              class="sc-mono w-full min-w-0"
            />
          </div>
        </div>

        <div
          class="sc-pro-subpanel"
          :class="{ 'sc-diff-panel': changedUnder('die_builder.margin') }"
        >
          <div class="sc-pro-subpanel__title">margin</div>
          <div class="sc-pro-grid">
            <div class="field">
              <label>left_micron</label>
              <InputNumber
                v-model="(margin() as Record<string, number>).left_micron"
                size="small"
                fluid
                :use-grouping="false"
                class="w-full min-w-0"
              />
            </div>
            <div class="field">
              <label>right_micron</label>
              <InputNumber
                v-model="(margin() as Record<string, number>).right_micron"
                size="small"
                fluid
                :use-grouping="false"
                class="w-full min-w-0"
              />
            </div>
            <div class="field">
              <label>top_micron</label>
              <InputNumber
                v-model="(margin() as Record<string, number>).top_micron"
                size="small"
                fluid
                :use-grouping="false"
                class="w-full min-w-0"
              />
            </div>
            <div class="field">
              <label>bottom_micron</label>
              <InputNumber
                v-model="(margin() as Record<string, number>).bottom_micron"
                size="small"
                fluid
                :use-grouping="false"
                class="w-full min-w-0"
              />
            </div>
          </div>
        </div>

        <div
          class="sc-pro-subpanel"
          :class="{ 'sc-diff-panel': changedUnder('die_builder.die_util') }"
        >
          <div class="sc-pro-subpanel__title">die_util</div>
          <div class="sc-pro-grid">
            <div class="field">
              <label>aspect_ratio</label>
              <InputNumber
                v-model="(dieUtil() as Record<string, number>).aspect_ratio"
                size="small"
                fluid
                :min-fraction-digits="0"
                :max-fraction-digits="6"
                :use-grouping="false"
                class="w-full min-w-0"
              />
            </div>
            <div class="field">
              <label>utilization</label>
              <InputNumber
                v-model="(dieUtil() as Record<string, number>).utilization"
                size="small"
                fluid
                :min="0"
                :max="1"
                :min-fraction-digits="0"
                :max-fraction-digits="6"
                :use-grouping="false"
                class="w-full min-w-0"
              />
            </div>
          </div>
        </div>

        <div
          class="sc-pro-subpanel"
          :class="{ 'sc-diff-panel': changedUnder('die_builder.die_size') }"
        >
          <div class="sc-pro-subpanel__title">die_size</div>
          <div class="sc-pro-grid">
            <div class="field">
              <label>width_micron</label>
              <InputNumber
                v-model="(dieSize() as Record<string, number>).width_micron"
                size="small"
                fluid
                :min-fraction-digits="0"
                :max-fraction-digits="6"
                :use-grouping="false"
                class="w-full min-w-0"
              />
            </div>
            <div class="field">
              <label>height_micron</label>
              <InputNumber
                v-model="(dieSize() as Record<string, number>).height_micron"
                size="small"
                fluid
                :min-fraction-digits="0"
                :max-fraction-digits="6"
                :use-grouping="false"
                class="w-full min-w-0"
              />
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="sc-pro-section">
      <div
        class="sc-pro-section__head"
        :class="{ 'sc-diff-panel': changedUnder('macro_placer') }"
      >
        <div class="sc-pro-section__stripe" />
        <div class="sc-pro-section__titles">
          <div class="sc-pro-section__title">macro_placer</div>
          <div class="sc-pro-section__desc">Macro halo and location input</div>
        </div>
      </div>
      <div class="sc-pro-section__body sc-pro-grid">
        <div class="field">
          <label>macro_placement_halo</label>
          <InputNumber
            v-model="(macro() as Record<string, number>).macro_placement_halo"
            size="small"
            fluid
            :min-fraction-digits="0"
            :max-fraction-digits="6"
            :use-grouping="false"
            class="w-full min-w-0"
          />
        </div>
        <div class="field">
          <label>macro_routing_halo</label>
          <InputNumber
            v-model="(macro() as Record<string, number>).macro_routing_halo"
            size="small"
            fluid
            :min-fraction-digits="0"
            :max-fraction-digits="6"
            :use-grouping="false"
            class="w-full min-w-0"
          />
        </div>
        <div class="field sc-pro-grid__full">
          <label>macro_location_path</label>
          <InputText
            v-model="(macro() as Record<string, string>).macro_location_path"
            size="small"
            fluid
            class="sc-mono w-full min-w-0"
          />
        </div>
      </div>
    </section>

    <section class="sc-pro-section">
      <div
        class="sc-pro-section__head"
        :class="{ 'sc-diff-panel': changedUnder('io_placer') }"
      >
        <div class="sc-pro-section__stripe" />
        <div class="sc-pro-section__titles">
          <div class="sc-pro-section__title">io_placer</div>
          <div class="sc-pro-section__desc">
            Routing layers eligible for IO-pin placement
          </div>
        </div>
      </div>
      <div class="sc-pro-section__body">
        <div class="field min-w-0">
          <label>io_layer_list</label>
          <div class="w-full min-w-0 space-y-1">
            <div
              v-for="(_layer, i) in stringList(io(), 'io_layer_list')"
              :key="'io-layer-' + i"
              class="flex w-full min-w-0 items-center gap-2"
              :class="{ 'sc-diff': isChanged(`io_placer.io_layer_list[${i}]`) }"
            >
              <InputText
                v-model="stringList(io(), 'io_layer_list')[i]"
                size="small"
                fluid
                class="sc-mono min-w-0 flex-1"
              />
              <button
                type="button"
                class="sc-pro-btn sc-pro-btn--danger shrink-0"
                @click="removeString(stringList(io(), 'io_layer_list'), i)"
              >
                <i class="ri-close-line"></i>
              </button>
            </div>
            <button
              type="button"
              class="sc-pro-btn"
              @click="addString(stringList(io(), 'io_layer_list'))"
            >
              <i class="ri-add-line"></i>
            </button>
          </div>
        </div>
      </div>
    </section>

    <section class="sc-pro-section">
      <div
        class="sc-pro-section__head"
        :class="{ 'sc-diff-panel': changedUnder('phy_placer') }"
      >
        <div class="sc-pro-section__stripe" />
        <div class="sc-pro-section__titles">
          <div class="sc-pro-section__title">phy_placer</div>
          <div class="sc-pro-section__desc">Well tap, endcap, and boundary tap cells</div>
        </div>
      </div>
      <div class="sc-pro-section__body space-y-3">
        <div
          class="sc-pro-subpanel"
          :class="{ 'sc-diff-panel': changedUnder('phy_placer.well_tap') }"
        >
          <div class="sc-pro-subpanel__title">well_tap</div>
          <div class="sc-pro-grid">
            <div class="field">
              <label>cell_name</label>
              <InputText
                v-model="(wellTap() as Record<string, string>).cell_name"
                size="small"
                fluid
                class="sc-mono w-full min-w-0"
              />
            </div>
            <div class="field">
              <label>distance_micron</label>
              <InputNumber
                v-model="(wellTap() as Record<string, number>).distance_micron"
                size="small"
                fluid
                :min-fraction-digits="0"
                :max-fraction-digits="6"
                :use-grouping="false"
                class="w-full min-w-0"
              />
            </div>
          </div>
        </div>

        <div
          class="sc-pro-subpanel"
          :class="{ 'sc-diff-panel': changedUnder('phy_placer.side_endcap') }"
        >
          <div class="sc-pro-subpanel__title">side_endcap</div>
          <div class="sc-pro-grid">
            <div class="field">
              <label>left_cell_name</label>
              <InputText
                v-model="(sideEndcap() as Record<string, string>).left_cell_name"
                size="small"
                fluid
                class="sc-mono w-full min-w-0"
              />
            </div>
            <div class="field">
              <label>right_cell_name</label>
              <InputText
                v-model="(sideEndcap() as Record<string, string>).right_cell_name"
                size="small"
                fluid
                class="sc-mono w-full min-w-0"
              />
            </div>
          </div>
        </div>

        <div
          class="sc-pro-subpanel"
          :class="{ 'sc-diff-panel': changedUnder('phy_placer.edge_endcap') }"
        >
          <div class="sc-pro-subpanel__title">edge_endcap</div>
          <div class="space-y-3">
            <div class="field min-w-0">
              <label>top_cell_name_list</label>
              <div class="w-full min-w-0 space-y-1">
                <div
                  v-for="(_cell, i) in stringList(edgeEndcap(), 'top_cell_name_list')"
                  :key="'edge-top-' + i"
                  class="flex w-full min-w-0 items-center gap-2"
                  :class="{
                    'sc-diff': isChanged(
                      `phy_placer.edge_endcap.top_cell_name_list[${i}]`,
                    ),
                  }"
                >
                  <InputText
                    v-model="stringList(edgeEndcap(), 'top_cell_name_list')[i]"
                    size="small"
                    fluid
                    class="sc-mono min-w-0 flex-1"
                  />
                  <button
                    type="button"
                    class="sc-pro-btn sc-pro-btn--danger shrink-0"
                    @click="
                      removeString(stringList(edgeEndcap(), 'top_cell_name_list'), i)
                    "
                  >
                    <i class="ri-close-line"></i>
                  </button>
                </div>
                <button
                  type="button"
                  class="sc-pro-btn"
                  @click="addString(stringList(edgeEndcap(), 'top_cell_name_list'))"
                >
                  <i class="ri-add-line"></i>
                </button>
              </div>
            </div>
            <div class="field min-w-0">
              <label>bottom_cell_name_list</label>
              <div class="w-full min-w-0 space-y-1">
                <div
                  v-for="(_cell, i) in stringList(edgeEndcap(), 'bottom_cell_name_list')"
                  :key="'edge-bot-' + i"
                  class="flex w-full min-w-0 items-center gap-2"
                  :class="{
                    'sc-diff': isChanged(
                      `phy_placer.edge_endcap.bottom_cell_name_list[${i}]`,
                    ),
                  }"
                >
                  <InputText
                    v-model="stringList(edgeEndcap(), 'bottom_cell_name_list')[i]"
                    size="small"
                    fluid
                    class="sc-mono min-w-0 flex-1"
                  />
                  <button
                    type="button"
                    class="sc-pro-btn sc-pro-btn--danger shrink-0"
                    @click="
                      removeString(stringList(edgeEndcap(), 'bottom_cell_name_list'), i)
                    "
                  >
                    <i class="ri-close-line"></i>
                  </button>
                </div>
                <button
                  type="button"
                  class="sc-pro-btn"
                  @click="addString(stringList(edgeEndcap(), 'bottom_cell_name_list'))"
                >
                  <i class="ri-add-line"></i>
                </button>
              </div>
            </div>
          </div>
        </div>

        <div
          class="sc-pro-subpanel"
          :class="{ 'sc-diff-panel': changedUnder('phy_placer.boundary_tap') }"
        >
          <div class="sc-pro-subpanel__title">boundary_tap</div>
          <div class="space-y-3">
            <div
              class="field max-w-xs"
              :class="{ 'sc-diff': isChanged('phy_placer.boundary_tap.rule_micron') }"
            >
              <label>rule_micron</label>
              <InputNumber
                v-model="(boundaryTap() as Record<string, number>).rule_micron"
                size="small"
                fluid
                :min-fraction-digits="0"
                :max-fraction-digits="6"
                :use-grouping="false"
                class="w-full min-w-0"
              />
            </div>
            <div class="field min-w-0">
              <label>top_cell_name_list</label>
              <div class="w-full min-w-0 space-y-1">
                <div
                  v-for="(_cell, i) in stringList(boundaryTap(), 'top_cell_name_list')"
                  :key="'bound-top-' + i"
                  class="flex w-full min-w-0 items-center gap-2"
                  :class="{
                    'sc-diff': isChanged(
                      `phy_placer.boundary_tap.top_cell_name_list[${i}]`,
                    ),
                  }"
                >
                  <InputText
                    v-model="stringList(boundaryTap(), 'top_cell_name_list')[i]"
                    size="small"
                    fluid
                    class="sc-mono min-w-0 flex-1"
                  />
                  <button
                    type="button"
                    class="sc-pro-btn sc-pro-btn--danger shrink-0"
                    @click="
                      removeString(stringList(boundaryTap(), 'top_cell_name_list'), i)
                    "
                  >
                    <i class="ri-close-line"></i>
                  </button>
                </div>
                <button
                  type="button"
                  class="sc-pro-btn"
                  @click="addString(stringList(boundaryTap(), 'top_cell_name_list'))"
                >
                  <i class="ri-add-line"></i>
                </button>
              </div>
            </div>
            <div class="field min-w-0">
              <label>bottom_cell_name_list</label>
              <div class="w-full min-w-0 space-y-1">
                <div
                  v-for="(_cell, i) in stringList(boundaryTap(), 'bottom_cell_name_list')"
                  :key="'bound-bot-' + i"
                  class="flex w-full min-w-0 items-center gap-2"
                  :class="{
                    'sc-diff': isChanged(
                      `phy_placer.boundary_tap.bottom_cell_name_list[${i}]`,
                    ),
                  }"
                >
                  <InputText
                    v-model="stringList(boundaryTap(), 'bottom_cell_name_list')[i]"
                    size="small"
                    fluid
                    class="sc-mono min-w-0 flex-1"
                  />
                  <button
                    type="button"
                    class="sc-pro-btn sc-pro-btn--danger shrink-0"
                    @click="
                      removeString(stringList(boundaryTap(), 'bottom_cell_name_list'), i)
                    "
                  >
                    <i class="ri-close-line"></i>
                  </button>
                </div>
                <button
                  type="button"
                  class="sc-pro-btn"
                  @click="addString(stringList(boundaryTap(), 'bottom_cell_name_list'))"
                >
                  <i class="ri-add-line"></i>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="sc-pro-section">
      <div
        class="sc-pro-section__head"
        :class="{ 'sc-diff-panel': changedUnder('pdn_generator.global_connect') }"
      >
        <div class="sc-pro-section__stripe" />
        <div class="sc-pro-section__titles">
          <div class="sc-pro-section__title">pdn_generator · global_connect</div>
          <div class="sc-pro-section__desc">Global net to instance pin binding</div>
        </div>
      </div>
      <div class="sc-pro-section__body">
        <div class="sc-pro-table-wrap">
          <table class="sc-pro-table sc-pro-table--fp4">
            <colgroup>
              <col />
              <col />
              <col />
              <col />
            </colgroup>
            <thead>
              <tr>
                <th>net_name</th>
                <th>instance_pin_name</th>
                <th>is_power</th>
                <th class="w-10"></th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(row, i) in pdn().global_connect as Record<string, unknown>[]"
                :key="'gc-' + i"
                :class="{
                  'sc-diff-row': changedUnder(`pdn_generator.global_connect[${i}]`),
                }"
              >
                <td>
                  <InputText
                    v-model="(row as Record<string, string>).net_name"
                    size="small"
                    fluid
                    class="sc-mono w-full min-w-0"
                  />
                </td>
                <td>
                  <InputText
                    v-model="(row as Record<string, string>).instance_pin_name"
                    size="small"
                    fluid
                    class="sc-mono w-full min-w-0"
                  />
                </td>
                <td>
                  <Checkbox v-model="(row as Record<string, boolean>).is_power" binary />
                </td>
                <td>
                  <button
                    type="button"
                    class="sc-pro-btn sc-pro-btn--danger"
                    @click="removeGlobalConnect(i)"
                  >
                    <i class="ri-delete-bin-line"></i>
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="sc-pro-inline-actions">
          <button type="button" class="sc-pro-btn" @click="addGlobalConnect">
            <i class="ri-add-line"></i> Add global connect
          </button>
        </div>
      </div>
    </section>

    <section class="sc-pro-section">
      <div
        class="sc-pro-section__head"
        :class="{ 'sc-diff-panel': changedUnder('pdn_generator.rail') }"
      >
        <div class="sc-pro-section__stripe" />
        <div class="sc-pro-section__titles">
          <div class="sc-pro-section__title">pdn_generator · rail</div>
          <div class="sc-pro-section__desc">
            Follow-pin rails on declared routing layers
          </div>
        </div>
      </div>
      <div class="sc-pro-section__body">
        <div class="sc-pro-table-wrap">
          <table class="sc-pro-table sc-pro-table--fp4">
            <colgroup>
              <col />
              <col />
              <col />
            </colgroup>
            <thead>
              <tr>
                <th>routing_layer_name</th>
                <th>width_micron</th>
                <th class="w-10"></th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(row, i) in pdn().rail as Record<string, unknown>[]"
                :key="'rail-' + i"
                :class="{ 'sc-diff-row': changedUnder(`pdn_generator.rail[${i}]`) }"
              >
                <td>
                  <InputText
                    v-model="(row as Record<string, string>).routing_layer_name"
                    size="small"
                    fluid
                    class="sc-mono w-full min-w-0"
                  />
                </td>
                <td>
                  <InputText
                    :model-value="
                      tableNumStr((row as Record<string, unknown>).width_micron)
                    "
                    size="small"
                    fluid
                    class="sc-mono w-full min-w-0"
                    @update:model-value="
                      setRowNum(row as Record<string, unknown>, 'width_micron', $event)
                    "
                  />
                </td>
                <td>
                  <button
                    type="button"
                    class="sc-pro-btn sc-pro-btn--danger"
                    @click="removeRail(i)"
                  >
                    <i class="ri-delete-bin-line"></i>
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="sc-pro-inline-actions">
          <button type="button" class="sc-pro-btn" @click="addRail">
            <i class="ri-add-line"></i> Add rail
          </button>
        </div>
      </div>
    </section>

    <section class="sc-pro-section">
      <div
        class="sc-pro-section__head"
        :class="{ 'sc-diff-panel': changedUnder('pdn_generator.stripe') }"
      >
        <div class="sc-pro-section__stripe" />
        <div class="sc-pro-section__titles">
          <div class="sc-pro-section__title">pdn_generator · stripe</div>
          <div class="sc-pro-section__desc">
            Periodic power stripes with width, pitch, and offset
          </div>
        </div>
      </div>
      <div class="sc-pro-section__body">
        <div class="sc-pro-table-wrap">
          <table class="sc-pro-table sc-pro-table--stripe">
            <colgroup>
              <col span="4" class="sc-pro-stripe__col-data" />
              <col class="sc-pro-stripe__col-action" />
            </colgroup>
            <thead>
              <tr>
                <th>routing_layer_name</th>
                <th>width_micron</th>
                <th>pitch_micron</th>
                <th>offset_micron</th>
                <th class="w-10"></th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(row, i) in pdn().stripe as Record<string, unknown>[]"
                :key="'stripe-' + i"
                :class="{ 'sc-diff-row': changedUnder(`pdn_generator.stripe[${i}]`) }"
              >
                <td>
                  <InputText
                    v-model="(row as Record<string, string>).routing_layer_name"
                    size="small"
                    fluid
                    class="sc-mono w-full min-w-0"
                  />
                </td>
                <td>
                  <InputText
                    :model-value="
                      tableNumStr((row as Record<string, unknown>).width_micron)
                    "
                    size="small"
                    fluid
                    class="sc-mono w-full min-w-0"
                    @update:model-value="
                      setRowNum(row as Record<string, unknown>, 'width_micron', $event)
                    "
                  />
                </td>
                <td>
                  <InputText
                    :model-value="
                      tableNumStr((row as Record<string, unknown>).pitch_micron)
                    "
                    size="small"
                    fluid
                    class="sc-mono w-full min-w-0"
                    @update:model-value="
                      setRowNum(row as Record<string, unknown>, 'pitch_micron', $event)
                    "
                  />
                </td>
                <td>
                  <InputText
                    :model-value="
                      tableNumStr((row as Record<string, unknown>).offset_micron)
                    "
                    size="small"
                    fluid
                    class="sc-mono w-full min-w-0"
                    @update:model-value="
                      setRowNum(row as Record<string, unknown>, 'offset_micron', $event)
                    "
                  />
                </td>
                <td>
                  <button
                    type="button"
                    class="sc-pro-btn sc-pro-btn--danger"
                    @click="removeStripe(i)"
                  >
                    <i class="ri-delete-bin-line"></i>
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="sc-pro-inline-actions">
          <button type="button" class="sc-pro-btn" @click="addStripe">
            <i class="ri-add-line"></i> Add stripe
          </button>
        </div>
      </div>
    </section>

    <section class="sc-pro-section">
      <div
        class="sc-pro-section__head"
        :class="{ 'sc-diff-panel': changedUnder('pdn_generator.connect_layers') }"
      >
        <div class="sc-pro-section__stripe" />
        <div class="sc-pro-section__titles">
          <div class="sc-pro-section__title">pdn_generator · connect_layers</div>
          <div class="sc-pro-section__desc">
            Routing-layer pairs connected through the PDN
          </div>
        </div>
      </div>
      <div class="sc-pro-section__body">
        <div class="sc-pro-table-wrap">
          <table class="sc-pro-table sc-pro-table--fp4">
            <colgroup>
              <col />
              <col />
              <col />
            </colgroup>
            <thead>
              <tr>
                <th>bottom_routing_layer_name</th>
                <th>top_routing_layer_name</th>
                <th class="w-10"></th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(row, i) in pdn().connect_layers as Record<string, unknown>[]"
                :key="'cl-' + i"
                :class="{
                  'sc-diff-row': changedUnder(`pdn_generator.connect_layers[${i}]`),
                }"
              >
                <td>
                  <InputText
                    v-model="(row as Record<string, string>).bottom_routing_layer_name"
                    size="small"
                    fluid
                    class="sc-mono w-full min-w-0"
                  />
                </td>
                <td>
                  <InputText
                    v-model="(row as Record<string, string>).top_routing_layer_name"
                    size="small"
                    fluid
                    class="sc-mono w-full min-w-0"
                  />
                </td>
                <td>
                  <button
                    type="button"
                    class="sc-pro-btn sc-pro-btn--danger"
                    @click="removeConnectLayer(i)"
                  >
                    <i class="ri-delete-bin-line"></i>
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="sc-pro-inline-actions">
          <button type="button" class="sc-pro-btn" @click="addConnectLayer">
            <i class="ri-add-line"></i> Add layer pair
          </button>
        </div>
      </div>
    </section>
  </div>
</template>
