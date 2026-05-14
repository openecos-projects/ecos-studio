<script setup lang="ts">
import { watchEffect } from 'vue'
import InputText from 'primevue/inputtext'
import InputNumber from 'primevue/inputnumber'
import Checkbox from 'primevue/checkbox'

const draft = defineModel<Record<string, unknown>>({ required: true })

function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

watchEffect(() => {
  if (!isObj(draft.value.Floorplan)) draft.value.Floorplan = {}
  if (!isObj(draft.value.PDN)) draft.value.PDN = {}
  const fp = draft.value.Floorplan as Record<string, unknown>
  const ap = fp['Auto place pin']
  if (!isObj(ap)) fp['Auto place pin'] = { layer: 'MET1', width: 0, height: 0, sides: [] as unknown[] }
  if (!Array.isArray(fp.Tracks)) fp.Tracks = []
  const pdn = draft.value.PDN as Record<string, unknown>
  if (!Array.isArray(pdn.IO)) pdn.IO = []
  if (!Array.isArray(pdn['Global connect'])) pdn['Global connect'] = []
  if (!isObj(pdn.Grid)) pdn.Grid = { layer: '', 'power net': '', 'power ground': '', width: 0, offset: 0 }
  if (!Array.isArray(pdn.Stripe)) pdn.Stripe = []
  if (!Array.isArray(pdn['Connect layers'])) pdn['Connect layers'] = []
})

const fp = () => draft.value.Floorplan as Record<string, unknown>
const pdn = () => draft.value.PDN as Record<string, unknown>
const autoPin = () => fp()['Auto place pin'] as Record<string, unknown>

function addTrack(): void {
  const t = fp().Tracks as Record<string, unknown>[]
  t.push({ layer: 'MET1', 'x start': 0, 'x step': 200, 'y start': 0, 'y step': 200 })
}

function removeTrack(i: number): void {
  ;(fp().Tracks as unknown[]).splice(i, 1)
}

function addIo(): void {
  ;(pdn().IO as Record<string, unknown>[]).push({
    'net name': '',
    direction: 'INOUT',
    'is power': false,
  })
}

function removeIo(i: number): void {
  ;(pdn().IO as unknown[]).splice(i, 1)
}

function addGc(): void {
  ;(pdn()['Global connect'] as Record<string, unknown>[]).push({
    'net name': '',
    'instance pin name': '',
    'is power': false,
  })
}

function removeGc(i: number): void {
  ;(pdn()['Global connect'] as unknown[]).splice(i, 1)
}

function addStripe(): void {
  ;(pdn().Stripe as Record<string, unknown>[]).push({
    layer: '',
    'power net': '',
    'ground net': '',
    width: 0,
    pitch: 0,
    offset: 0,
  })
}

function removeStripe(i: number): void {
  ;(pdn().Stripe as unknown[]).splice(i, 1)
}

function addConnectLayer(): void {
  ;(pdn()['Connect layers'] as Record<string, unknown>[]).push({ layers: [] as string[] })
}

function removeConnectLayer(i: number): void {
  ;(pdn()['Connect layers'] as unknown[]).splice(i, 1)
}

function setConnectLayersFromText(item: Record<string, unknown>, raw: string | undefined): void {
  const s = raw ?? ''
  item.layers = s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
}

/** 表格内数值列与文本列共用 InputText 时的展示（Stripe / Tracks） */
function tableNumStr(n: unknown): string {
  if (n === undefined || n === null) return ''
  const x = Number(n)
  return Number.isFinite(x) ? String(x) : ''
}

function setStripeNum(row: Record<string, unknown>, key: 'width' | 'pitch' | 'offset', raw: string | undefined): void {
  const s = (raw ?? '').trim()
  if (s === '') {
    row[key] = 0
    return
  }
  const n = Number(s)
  row[key] = Number.isFinite(n) ? n : 0
}

/** Tracks 数值列与 layer 列共用 InputText（同 Stripe，避免 InputNumber + table overflow 裁切边框） */
function setTrackNum(
  row: Record<string, unknown>,
  key: 'x start' | 'x step' | 'y start' | 'y step',
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
</script>

<template>
  <div class="sc-pro sc-cards" data-accent="indigo">
    <!-- Hero metrics -->
    <div class="sc-pro-hero">
      <div class="sc-pro-hero__accent" />
      <div class="sc-pro-hero__body">
        <div class="sc-pro-hero__label">Tap distance</div>
        <div class="field mb-0 mt-1 w-full min-w-0 max-w-xs">
          <InputNumber
            v-model="(draft.Floorplan as Record<string, unknown>)['Tap distance'] as number"
            size="small"
            fluid
            :use-grouping="false"
            class="w-full min-w-0" />
        </div>
        <p class="sc-pro-hero__hint">Global tap distance (same as template Floorplan section)</p>
      </div>
    </div>

    <!-- Floorplan: auto place pin + tracks -->
    <section class="sc-pro-section">
      <div class="sc-pro-section__head">
        <div class="sc-pro-section__stripe" />
        <div class="sc-pro-section__titles">
          <div class="sc-pro-section__title">Layout · Auto place pin</div>
          <div class="sc-pro-section__desc">Pin layer and dimensions; maintain sides as a string array in JSON editing below</div>
        </div>
      </div>
      <div class="sc-pro-section__body">
        <div class="sc-pro-grid">
          <div class="field">
            <label>layer</label>
            <InputText
              v-model="(autoPin() as Record<string, string>).layer"
              size="small"
              fluid
              class="min-w-0 w-full" />
          </div>
          <div class="field">
            <label>width</label>
            <InputNumber
              v-model="(autoPin() as Record<string, number>).width"
              size="small"
              fluid
              :use-grouping="false"
              class="w-full min-w-0" />
          </div>
          <div class="field">
            <label>height</label>
            <InputNumber
              v-model="(autoPin() as Record<string, number>).height"
              size="small"
              fluid
              :use-grouping="false"
              class="w-full min-w-0" />
          </div>
        </div>
      </div>
    </section>

    <section class="sc-pro-section">
      <div class="sc-pro-section__head">
        <div class="sc-pro-section__stripe" />
        <div class="sc-pro-section__titles">
          <div class="sc-pro-section__title">Tracks · Routing tracks</div>
          <div class="sc-pro-section__desc">Per-layer start positions and step sizes</div>
        </div>
      </div>
      <div class="sc-pro-section__body">
        <div class="sc-pro-table-wrap">
          <table class="sc-pro-table sc-pro-table--tracks">
            <colgroup>
              <col span="5" class="sc-pro-tracks__col-data" />
              <col class="sc-pro-tracks__col-action" />
            </colgroup>
            <thead>
              <tr>
                <th>layer</th>
                <th>x start</th>
                <th>x step</th>
                <th>y start</th>
                <th>y step</th>
                <th class="w-10"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, i) in (fp().Tracks as Record<string, string | number>[])" :key="i">
                <td>
                  <InputText v-model="(row as Record<string, string>).layer" size="small" fluid class="w-full min-w-0 sc-mono" />
                </td>
                <td>
                  <InputText
                    :model-value="tableNumStr((row as Record<string, unknown>)['x start'])"
                    size="small"
                    fluid
                    class="w-full min-w-0 sc-mono"
                    @update:model-value="setTrackNum(row as Record<string, unknown>, 'x start', $event)" />
                </td>
                <td>
                  <InputText
                    :model-value="tableNumStr((row as Record<string, unknown>)['x step'])"
                    size="small"
                    fluid
                    class="w-full min-w-0 sc-mono"
                    @update:model-value="setTrackNum(row as Record<string, unknown>, 'x step', $event)" />
                </td>
                <td>
                  <InputText
                    :model-value="tableNumStr((row as Record<string, unknown>)['y start'])"
                    size="small"
                    fluid
                    class="w-full min-w-0 sc-mono"
                    @update:model-value="setTrackNum(row as Record<string, unknown>, 'y start', $event)" />
                </td>
                <td>
                  <InputText
                    :model-value="tableNumStr((row as Record<string, unknown>)['y step'])"
                    size="small"
                    fluid
                    class="w-full min-w-0 sc-mono"
                    @update:model-value="setTrackNum(row as Record<string, unknown>, 'y step', $event)" />
                </td>
                <td>
                  <button type="button" class="sc-pro-btn sc-pro-btn--danger" title="Remove" @click="removeTrack(i)">
                    <i class="ri-delete-bin-line"></i>
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="sc-pro-inline-actions">
          <button type="button" class="sc-pro-btn" @click="addTrack">
            <i class="ri-add-line"></i>
            Add track layer
          </button>
        </div>
      </div>
    </section>

    <!-- PDN -->
    <section class="sc-pro-section">
      <div class="sc-pro-section__head">
        <div class="sc-pro-section__stripe" />
        <div class="sc-pro-section__titles">
          <div class="sc-pro-section__title">PDN · IO</div>
          <div class="sc-pro-section__desc">Power delivery IO pin declarations</div>
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
                <th>net name</th>
                <th>direction</th>
                <th>is power</th>
                <th class="w-10"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, i) in (pdn().IO as Record<string, unknown>[])" :key="i">
                <td>
                  <InputText v-model="(row as Record<string, string>)['net name']" size="small" fluid class="w-full min-w-0 sc-mono" />
                </td>
                <td>
                  <InputText v-model="(row as Record<string, string>).direction" size="small" fluid class="w-full min-w-0 sc-mono" />
                </td>
                <td>
                  <Checkbox v-model="(row as Record<string, boolean>)['is power']" binary />
                </td>
                <td>
                  <button type="button" class="sc-pro-btn sc-pro-btn--danger" @click="removeIo(i)">
                    <i class="ri-delete-bin-line"></i>
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="sc-pro-inline-actions">
          <button type="button" class="sc-pro-btn" @click="addIo"><i class="ri-add-line"></i> Add IO</button>
        </div>
      </div>
    </section>

    <section class="sc-pro-section">
      <div class="sc-pro-section__head">
        <div class="sc-pro-section__stripe" />
        <div class="sc-pro-section__titles">
          <div class="sc-pro-section__title">Global connect</div>
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
                <th>net name</th>
                <th>instance pin name</th>
                <th>is power</th>
                <th class="w-10"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, i) in (pdn()['Global connect'] as Record<string, unknown>[])" :key="i">
                <td>
                  <InputText v-model="(row as Record<string, string>)['net name']" size="small" fluid class="w-full min-w-0 sc-mono" />
                </td>
                <td>
                  <InputText
                    v-model="(row as Record<string, string>)['instance pin name']"
                    size="small"
                    fluid
                    class="w-full min-w-0 sc-mono" />
                </td>
                <td>
                  <Checkbox v-model="(row as Record<string, boolean>)['is power']" binary />
                </td>
                <td>
                  <button type="button" class="sc-pro-btn sc-pro-btn--danger" @click="removeGc(i)">
                    <i class="ri-delete-bin-line"></i>
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="sc-pro-inline-actions">
          <button type="button" class="sc-pro-btn" @click="addGc"><i class="ri-add-line"></i> Add rule</button>
        </div>
      </div>
    </section>

    <section class="sc-pro-section">
      <div class="sc-pro-section__head">
        <div class="sc-pro-section__stripe" />
        <div class="sc-pro-section__titles">
          <div class="sc-pro-section__title">Grid</div>
        </div>
      </div>
      <div class="sc-pro-section__body sc-pro-grid min-w-0">
        <div class="field min-w-0">
          <label>layer</label>
          <InputText
            v-model="(pdn().Grid as Record<string, string>).layer"
            size="small"
            fluid
            class="w-full min-w-0 sc-mono" />
        </div>
        <div class="field min-w-0">
          <label>power net</label>
          <InputText
            v-model="(pdn().Grid as Record<string, string>)['power net']"
            size="small"
            fluid
            class="w-full min-w-0 sc-mono" />
        </div>
        <div class="field min-w-0">
          <label>power ground</label>
          <InputText
            v-model="(pdn().Grid as Record<string, string>)['power ground']"
            size="small"
            fluid
            class="w-full min-w-0 sc-mono" />
        </div>
        <div class="field min-w-0">
          <label>width</label>
          <InputNumber
            v-model="(pdn().Grid as Record<string, number>).width"
            size="small"
            fluid
            :use-grouping="false"
            class="w-full min-w-0" />
        </div>
        <div class="field sc-pro-grid__full min-w-0">
          <label>offset</label>
          <InputNumber
            v-model="(pdn().Grid as Record<string, number>).offset"
            size="small"
            fluid
            :use-grouping="false"
            class="w-full min-w-0" />
        </div>
      </div>
    </section>

    <section class="sc-pro-section">
      <div class="sc-pro-section__head">
        <div class="sc-pro-section__stripe" />
        <div class="sc-pro-section__titles">
          <div class="sc-pro-section__title">Stripe</div>
        </div>
      </div>
      <div class="sc-pro-section__body">
        <div class="sc-pro-table-wrap">
          <table class="sc-pro-table sc-pro-table--stripe">
            <colgroup>
              <col span="6" class="sc-pro-stripe__col-data" />
              <col class="sc-pro-stripe__col-action" />
            </colgroup>
            <thead>
              <tr>
                <th>layer</th>
                <th>power net</th>
                <th>ground net</th>
                <th>width</th>
                <th>pitch</th>
                <th>offset</th>
                <th class="w-10"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, i) in (pdn().Stripe as Record<string, unknown>[])" :key="i">
                <td>
                  <InputText v-model="(row as Record<string, string>).layer" size="small" fluid class="w-full min-w-0 sc-mono" />
                </td>
                <td>
                  <InputText v-model="(row as Record<string, string>)['power net']" size="small" fluid class="w-full min-w-0 sc-mono" />
                </td>
                <td>
                  <InputText v-model="(row as Record<string, string>)['ground net']" size="small" fluid class="w-full min-w-0 sc-mono" />
                </td>
                <td>
                  <InputText
                    :model-value="tableNumStr((row as Record<string, unknown>).width)"
                    size="small"
                    fluid
                    class="w-full min-w-0 sc-mono"
                    @update:model-value="setStripeNum(row as Record<string, unknown>, 'width', $event)" />
                </td>
                <td>
                  <InputText
                    :model-value="tableNumStr((row as Record<string, unknown>).pitch)"
                    size="small"
                    fluid
                    class="w-full min-w-0 sc-mono"
                    @update:model-value="setStripeNum(row as Record<string, unknown>, 'pitch', $event)" />
                </td>
                <td>
                  <InputText
                    :model-value="tableNumStr((row as Record<string, unknown>).offset)"
                    size="small"
                    fluid
                    class="w-full min-w-0 sc-mono"
                    @update:model-value="setStripeNum(row as Record<string, unknown>, 'offset', $event)" />
                </td>
                <td>
                  <button type="button" class="sc-pro-btn sc-pro-btn--danger" @click="removeStripe(i)">
                    <i class="ri-delete-bin-line"></i>
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="sc-pro-inline-actions">
          <button type="button" class="sc-pro-btn" @click="addStripe"><i class="ri-add-line"></i> Add stripe</button>
        </div>
      </div>
    </section>

    <section class="sc-pro-section">
      <div class="sc-pro-section__head">
        <div class="sc-pro-section__stripe" />
        <div class="sc-pro-section__titles">
          <div class="sc-pro-section__title">Connect layers</div>
          <div class="sc-pro-section__desc">Layer pairs; layers is a string array</div>
        </div>
      </div>
      <div class="sc-pro-section__body space-y-2 min-w-0">
        <div
          v-for="(item, i) in (pdn()['Connect layers'] as Record<string, unknown>[])"
          :key="i"
          class="sc-pro-subpanel min-w-0 max-w-full">
          <div class="flex items-center justify-between gap-2 mb-2 min-w-0">
            <span class="text-[10px] font-bold uppercase text-(--text-secondary) truncate min-w-0"
              >Pair {{ i + 1 }}</span>
            <button
              type="button"
              class="sc-pro-btn sc-pro-btn--danger shrink-0"
              @click="removeConnectLayer(i)">
              <i class="ri-delete-bin-line"></i>
            </button>
          </div>
          <div class="field mb-0 min-w-0 max-w-full">
            <label>layers (comma-separated)</label>
            <InputText
              :model-value="(item.layers as string[] | undefined)?.join(', ') ?? ''"
              size="small"
              fluid
              class="w-full min-w-0 max-w-full sc-mono"
              @update:model-value="setConnectLayersFromText(item as Record<string, unknown>, $event)" />
          </div>
        </div>
        <button type="button" class="sc-pro-btn" @click="addConnectLayer">
          <i class="ri-add-line"></i>
          Add layer pair
        </button>
      </div>
    </section>
  </div>
</template>
