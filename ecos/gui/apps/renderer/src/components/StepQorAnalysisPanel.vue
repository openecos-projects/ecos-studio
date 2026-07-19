<template>
  <div
    class="step-qor-root flex h-full min-h-0 w-full min-w-0 flex-col bg-(--bg-primary)"
  >
    <header
      class="flex shrink-0 items-start justify-between border-b border-(--border-color) px-3 py-2"
    >
      <div class="min-w-0">
        <h2 class="truncate text-[12px] font-bold text-(--text-primary)">
          {{ panelTitle }}
        </h2>
        <p class="mt-0.5 text-[10px] tracking-wider text-(--text-secondary) uppercase">
          Workspace step analysis
        </p>
      </div>
      <button
        type="button"
        class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border border-(--border-color) text-(--text-secondary) hover:border-(--accent-color) hover:text-(--accent-color)"
        title="Refresh QoR analysis"
        aria-label="Refresh QoR analysis"
        :disabled="loading"
        @click="refetch"
      >
        <i :class="loading ? 'ri-loader-4-line spin' : 'ri-refresh-line'"></i>
      </button>
    </header>

    <div
      v-if="loading"
      class="flex min-h-0 flex-1 flex-col items-center justify-center px-4 text-center"
    >
      <i class="ri-loader-4-line spin text-3xl text-(--accent-color)"></i>
      <p class="mt-3 text-[11px] text-(--text-secondary)">Loading QoR analysis...</p>
    </div>

    <div v-else-if="error" class="m-3 rounded border border-red-500/40 bg-red-500/10 p-3">
      <div class="flex items-start gap-2">
        <i class="ri-error-warning-line mt-0.5 shrink-0 text-lg text-red-400"></i>
        <p class="text-[12px] leading-relaxed break-words text-red-300">{{ error }}</p>
      </div>
      <button
        type="button"
        class="mt-3 text-[11px] text-(--accent-color) hover:underline"
        @click="refetch"
      >
        Retry
      </button>
    </div>

    <div
      v-else-if="!isSupported"
      class="flex min-h-0 flex-1 flex-col items-center justify-center px-4 text-center"
    >
      <i
        class="ri-bar-chart-box-line mb-3 text-4xl text-(--text-secondary) opacity-40"
      ></i>
      <p class="text-[12px] leading-relaxed text-(--text-secondary)">
        Detailed QoR analysis is available for Place, Route, and STA steps.
      </p>
    </div>

    <div
      v-else-if="isEmpty"
      class="flex min-h-0 flex-1 flex-col items-center justify-center px-4 text-center"
    >
      <i class="ri-file-chart-line mb-3 text-4xl text-(--text-secondary) opacity-40"></i>
      <p class="text-[12px] leading-relaxed text-(--text-secondary)">
        This step has no detailed QoR analysis yet.
      </p>
      <p
        v-if="messages.length"
        class="mt-2 text-[10px] leading-relaxed text-(--text-secondary)"
      >
        {{ messages.join(' ') }}
      </p>
    </div>

    <div v-else class="min-h-0 flex-1 overflow-auto">
      <section
        v-if="integrity.status === 'incomplete' || warnings.length"
        class="border-b border-(--border-color) px-3 py-2 text-[10px] text-amber-400"
        aria-label="Step QoR analysis warnings"
      >
        <p v-if="integrity.status === 'incomplete'">
          Analysis source validation needs attention.
        </p>
        <p v-if="warnings.length" :class="integrity.status === 'incomplete' ? 'mt-1' : ''">
          {{ warnings.join(' ') }}
        </p>
      </section>
      <section
        v-if="metrics.length"
        class="border-b border-(--border-color) px-3 py-2"
        aria-label="Step QoR metric overview"
      >
        <div
          class="mb-1 flex items-center justify-between gap-3 text-[10px] text-(--text-secondary)"
        >
          <span>Metric overview</span>
          <span
            v-if="qorStatus"
            :class="
              qorStatus === 'pass'
                ? 'text-emerald-400'
                : qorStatus === 'blocked'
                  ? 'text-red-400'
                  : 'text-amber-400'
            "
          >
            {{ qorStatus }}
          </span>
        </div>
        <div class="flex flex-wrap gap-x-4 gap-y-1 text-[11px] tabular-nums">
          <span
            v-for="metric in metrics"
            :key="metric.id"
            class="inline-flex min-w-0 gap-1"
          >
            <span class="truncate text-(--text-secondary)">{{ metric.displayName }}</span>
            <strong class="shrink-0 font-medium text-(--text-primary)">
              {{ formatMetric(metric.value) }}{{ metric.unit ? ` ${metric.unit}` : '' }}
            </strong>
          </span>
        </div>
        <p v-if="missingMetrics.length" class="mt-1 text-[10px] text-amber-400">
          Missing: {{ missingMetrics.join(', ') }}
        </p>
      </section>

      <section v-if="detail && kind === 'route'" class="min-w-max">
        <div
          class="flex items-center justify-between border-b border-(--border-color) px-3 py-2 text-[10px] text-(--text-secondary)"
        >
          <span>{{ routeLayers.length }} layers</span>
          <span v-if="routeFinalIteration !== null"
            >Final DR iteration {{ routeFinalIteration }}</span
          >
        </div>
        <table
          class="w-full border-collapse text-left text-[11px] tabular-nums"
          aria-label="Route layer QoR analysis"
        >
          <thead
            class="sticky top-0 bg-(--bg-secondary) text-[10px] text-(--text-secondary)"
          >
            <tr>
              <th class="sticky left-0 z-10 bg-(--bg-secondary) px-3 py-2 font-semibold">
                Layer
              </th>
              <th class="px-2 py-2 font-semibold">LA Demand</th>
              <th class="px-2 py-2 font-semibold">LA Overflow</th>
              <th class="px-2 py-2 font-semibold">LA WL</th>
              <th class="px-2 py-2 font-semibold">LA Vias</th>
              <th class="px-2 py-2 font-semibold">DR WL</th>
              <th class="px-2 py-2 font-semibold">DR Vias</th>
              <th class="px-2 py-2 font-semibold">DR Viol.</th>
              <th class="px-3 py-2 font-semibold">DR Patch</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="layer in routeLayers"
              :key="layer.id"
              class="border-b border-(--border-color)/70 hover:bg-(--bg-hover)"
            >
              <th
                class="sticky left-0 bg-(--bg-primary) px-3 py-2 font-medium text-(--text-primary)"
              >
                {{ layer.label }}
              </th>
              <td class="px-2 py-2">{{ formatMetric(layer.la.demand) }}</td>
              <td class="px-2 py-2" :class="numberRiskClass(layer.la.overflow)">
                {{ formatMetric(layer.la.overflow) }}
              </td>
              <td class="px-2 py-2">{{ formatMetric(layer.la.wirelength) }}</td>
              <td class="px-2 py-2">{{ formatMetric(layer.la.viaCount) }}</td>
              <td class="px-2 py-2">{{ formatMetric(layer.dr.wirelength) }}</td>
              <td class="px-2 py-2">{{ formatMetric(layer.dr.viaCount) }}</td>
              <td class="px-2 py-2" :class="numberRiskClass(layer.dr.violationCount)">
                {{ formatMetric(layer.dr.violationCount) }}
              </td>
              <td class="px-3 py-2">{{ formatMetric(layer.dr.patchCount) }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section v-else-if="detail && kind === 'place'" class="min-w-max">
        <div
          class="border-b border-(--border-color) px-3 py-2 text-[10px] text-(--text-secondary)"
        >
          {{ placeMaps.length }} declared map sources
        </div>
        <table
          class="w-full border-collapse text-left text-[11px] tabular-nums"
          aria-label="Place map QoR analysis"
        >
          <thead
            class="sticky top-0 bg-(--bg-secondary) text-[10px] text-(--text-secondary)"
          >
            <tr>
              <th class="px-3 py-2 font-semibold">Group</th>
              <th class="px-2 py-2 font-semibold">Map</th>
              <th class="px-2 py-2 font-semibold">Direction</th>
              <th class="px-2 py-2 font-semibold">Peak</th>
              <th class="px-2 py-2 font-semibold">Top 5%</th>
              <th class="px-2 py-2 font-semibold">Nonzero</th>
              <th class="px-3 py-2 font-semibold">High bins</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="map in placeMaps"
              :key="map.id"
              class="border-b border-(--border-color)/70 hover:bg-(--bg-hover)"
              :title="map.sourceFile"
            >
              <td class="px-3 py-2 font-medium text-(--text-primary)">{{ map.group }}</td>
              <td class="px-2 py-2">{{ map.metric }}</td>
              <td class="px-2 py-2 text-(--text-secondary)">
                {{ map.direction || '-' }}
              </td>
              <td class="px-2 py-2">{{ formatMetric(map.max) }}</td>
              <td class="px-2 py-2">{{ formatMetric(map.topAverage) }}</td>
              <td class="px-2 py-2">
                {{ formatRatio(map.nonzeroCount, map.valueCount) }}
              </td>
              <td class="px-3 py-2" :class="numberRiskClass(map.highBinCount)">
                {{ formatRatio(map.highBinCount, map.valueCount) }}
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section v-else-if="detail && kind === 'sta'" class="min-w-max">
        <div
          class="flex border-b border-(--border-color) px-3 pt-2"
          role="tablist"
          aria-label="STA QoR analysis view"
        >
          <button
            type="button"
            role="tab"
            :aria-selected="staView === 'groups'"
            :class="staTabClass('groups')"
            @click="staView = 'groups'"
          >
            Path groups
          </button>
          <button
            type="button"
            role="tab"
            :aria-selected="staView === 'corners'"
            :class="staTabClass('corners')"
            @click="staView = 'corners'"
          >
            Corner records
          </button>
        </div>
        <table
          v-if="staView === 'groups'"
          class="w-full border-collapse text-left text-[11px] tabular-nums"
          aria-label="STA path group summary"
        >
          <thead
            class="sticky top-0 bg-(--bg-secondary) text-[10px] text-(--text-secondary)"
          >
            <tr>
              <th class="px-3 py-2 font-semibold">Path group</th>
              <th class="px-2 py-2 font-semibold">Setup WNS</th>
              <th class="px-2 py-2 font-semibold">Setup TNS</th>
              <th class="px-2 py-2 font-semibold">Min freq.</th>
              <th class="px-2 py-2 font-semibold">Setup NVP</th>
              <th class="px-2 py-2 font-semibold">Hold WNS</th>
              <th class="px-2 py-2 font-semibold">Hold TNS</th>
              <th class="px-3 py-2 font-semibold">Hold NVP</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="group in staGroups"
              :key="group.name"
              class="border-b border-(--border-color)/70 hover:bg-(--bg-hover)"
            >
              <th
                class="px-3 py-2 font-medium text-(--text-primary)"
                :title="group.cornerHint"
              >
                {{ group.name }}
              </th>
              <td class="px-2 py-2" :class="timingRiskClass(group.setup.wns)">
                {{ formatMetric(group.setup.wns) }}
              </td>
              <td class="px-2 py-2" :class="timingRiskClass(group.setup.tns)">
                {{ formatMetric(group.setup.tns) }}
              </td>
              <td class="px-2 py-2">{{ formatMetric(group.setup.frequency) }}</td>
              <td class="px-2 py-2" :class="numberRiskClass(group.setup.nvp)">
                {{ formatMetric(group.setup.nvp) }}
              </td>
              <td class="px-2 py-2" :class="timingRiskClass(group.hold.wns)">
                {{ formatMetric(group.hold.wns) }}
              </td>
              <td class="px-2 py-2" :class="timingRiskClass(group.hold.tns)">
                {{ formatMetric(group.hold.tns) }}
              </td>
              <td class="px-3 py-2" :class="numberRiskClass(group.hold.nvp)">
                {{ formatMetric(group.hold.nvp) }}
              </td>
            </tr>
          </tbody>
        </table>
        <table
          v-else
          class="w-full border-collapse text-left text-[11px] tabular-nums"
          aria-label="STA corner path group records"
        >
          <thead
            class="sticky top-0 bg-(--bg-secondary) text-[10px] text-(--text-secondary)"
          >
            <tr>
              <th class="px-3 py-2 font-semibold">Corner</th>
              <th class="px-2 py-2 font-semibold">Path group</th>
              <th class="px-2 py-2 font-semibold">Setup WNS</th>
              <th class="px-2 py-2 font-semibold">Setup TNS</th>
              <th class="px-2 py-2 font-semibold">Setup NVP</th>
              <th class="px-2 py-2 font-semibold">Freq.</th>
              <th class="px-2 py-2 font-semibold">Hold WNS</th>
              <th class="px-2 py-2 font-semibold">Hold TNS</th>
              <th class="px-3 py-2 font-semibold">Hold NVP</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="record in staRecords"
              :key="record.id"
              class="border-b border-(--border-color)/70 hover:bg-(--bg-hover)"
              :title="record.sourceFile"
            >
              <th class="px-3 py-2 font-medium text-(--text-primary)">
                {{ record.corner }}
              </th>
              <td class="px-2 py-2">{{ record.pathGroup }}</td>
              <td class="px-2 py-2" :class="timingRiskClass(record.setup.wns)">
                {{ formatMetric(record.setup.wns) }}
              </td>
              <td class="px-2 py-2" :class="timingRiskClass(record.setup.tns)">
                {{ formatMetric(record.setup.tns) }}
              </td>
              <td class="px-2 py-2" :class="numberRiskClass(record.setup.nvp)">
                {{ formatMetric(record.setup.nvp) }}
              </td>
              <td class="px-2 py-2">{{ formatMetric(record.setup.frequency) }}</td>
              <td class="px-2 py-2" :class="timingRiskClass(record.hold.wns)">
                {{ formatMetric(record.hold.wns) }}
              </td>
              <td class="px-2 py-2" :class="timingRiskClass(record.hold.tns)">
                {{ formatMetric(record.hold.tns) }}
              </td>
              <td class="px-3 py-2" :class="numberRiskClass(record.hold.nvp)">
                {{ formatMetric(record.hold.nvp) }}
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <footer
        v-if="metricsPath"
        class="border-t border-(--border-color) px-3 py-2 text-[10px] text-(--text-secondary)"
        :title="metricsPath"
      >
        {{ sourceFileName(metricsPath) }}
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useStepQorAnalysis } from '@/composables/useStepQorAnalysis'

type Numeric = number | null
type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function numberValue(value: unknown): Numeric {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function field(record: unknown, key: string): Numeric {
  return isRecord(record) ? numberValue(record[key]) : null
}

function stringField(record: unknown, key: string): string {
  return isRecord(record) && typeof record[key] === 'string' ? record[key] : ''
}

const {
  currentStep,
  detail,
  error,
  integrity,
  isEmpty,
  isSupported,
  kind,
  loading,
  metrics,
  messages,
  missingMetrics,
  metricsPath,
  qorStatus,
  refetch,
  warnings,
} = useStepQorAnalysis()

const staView = ref<'groups' | 'corners'>('groups')
const panelTitle = computed(() => {
  if (kind.value === 'route') return 'Route QoR'
  if (kind.value === 'place') return 'Place QoR'
  if (kind.value === 'sta') return 'STA QoR'
  return currentStep.value ? `${currentStep.value} QoR` : 'QoR Analysis'
})

const routeLayers = computed(() => {
  const layers =
    isRecord(detail.value) && Array.isArray(detail.value.layers)
      ? detail.value.layers
      : []
  return layers.filter(isRecord).map((layer, index) => ({
    id: `${stringField(layer, 'layer') || index}`,
    label: stringField(layer, 'layer') || `Layer ${index + 1}`,
    la: {
      demand: field(layer.la, 'demand'),
      overflow: field(layer.la, 'overflow'),
      wirelength: field(layer.la, 'wirelength'),
      viaCount: field(layer.la, 'via_count'),
    },
    dr: {
      wirelength: field(layer.dr, 'wirelength'),
      viaCount: field(layer.dr, 'via_count'),
      violationCount: field(layer.dr, 'violation_count'),
      patchCount: field(layer.dr, 'patch_count'),
    },
  }))
})
const routeFinalIteration = computed(() => field(detail.value, 'final_dr_iteration'))

const placeMaps = computed(() => {
  const maps =
    isRecord(detail.value) && Array.isArray(detail.value.maps) ? detail.value.maps : []
  return maps.filter(isRecord).map((map, index) => ({
    id: `${stringField(map, 'group')}-${stringField(map, 'metric')}-${stringField(map, 'direction')}-${index}`,
    group: stringField(map, 'group') || '-',
    metric: stringField(map, 'metric') || '-',
    direction: stringField(map, 'direction'),
    sourceFile: stringField(map, 'source_file'),
    max: field(map, 'max'),
    topAverage: field(map, 'top_5_percent_average'),
    nonzeroCount: field(map, 'nonzero_count'),
    highBinCount: field(map, 'high_bin_count'),
    valueCount: field(map, 'value_count'),
  }))
})

function timingValues(record: unknown) {
  return {
    wns: field(record, 'wns'),
    tns: field(record, 'tns'),
    nvp: field(record, 'nvp'),
    frequency: field(record, 'frequency_mhz'),
  }
}

const staGroups = computed(() => {
  const groups =
    isRecord(detail.value) && Array.isArray(detail.value.path_groups)
      ? detail.value.path_groups
      : []
  return groups.filter(isRecord).map((group, index) => {
    const setup = isRecord(group.setup) ? group.setup : {}
    const hold = isRecord(group.hold) ? group.hold : {}
    return {
      name: stringField(group, 'path_group') || `Path group ${index + 1}`,
      cornerHint: [
        stringField(setup, 'worst_wns_corner'),
        stringField(hold, 'worst_wns_corner'),
      ]
        .filter(Boolean)
        .join(' / '),
      setup: {
        wns: field(setup, 'worst_wns'),
        tns: field(setup, 'worst_tns'),
        frequency: field(setup, 'minimum_frequency_mhz'),
        nvp: field(setup, 'nvp_total'),
      },
      hold: {
        wns: field(hold, 'worst_wns'),
        tns: field(hold, 'worst_tns'),
        nvp: field(hold, 'nvp_total'),
      },
    }
  })
})

const staRecords = computed(() => {
  const records =
    isRecord(detail.value) && Array.isArray(detail.value.records)
      ? detail.value.records
      : []
  return records.filter(isRecord).map((record, index) => ({
    id: `${stringField(record, 'corner')}-${stringField(record, 'path_group')}-${index}`,
    corner: stringField(record, 'corner') || '-',
    pathGroup: stringField(record, 'path_group') || '-',
    sourceFile: stringField(record, 'source_file'),
    setup: timingValues(record.setup),
    hold: timingValues(record.hold),
  }))
})

function formatMetric(value: Numeric): string {
  if (value === null) return '-'
  return Math.abs(value) >= 1000
    ? value.toLocaleString(undefined, { maximumFractionDigits: 2 })
    : String(Number(value.toFixed(4)))
}

function formatRatio(value: Numeric, total: Numeric): string {
  if (value === null || total === null || total <= 0) return '-'
  return `${formatMetric(value)} (${((value / total) * 100).toFixed(1)}%)`
}

function numberRiskClass(value: Numeric): string {
  return value !== null && value > 0 ? 'font-semibold text-red-400' : ''
}

function timingRiskClass(value: Numeric): string {
  return value !== null && value < 0 ? 'font-semibold text-red-400' : ''
}

function sourceFileName(path: string): string {
  return path.split('/').pop() || path
}

function staTabClass(view: 'groups' | 'corners'): string[] {
  return [
    'border-b-2 px-2.5 py-2 text-[10px] font-medium',
    staView.value === view
      ? 'border-(--accent-color) text-(--accent-color)'
      : 'border-transparent text-(--text-secondary) hover:text-(--text-primary)',
  ]
}
</script>
