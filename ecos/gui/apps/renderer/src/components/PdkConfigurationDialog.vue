<template>
  <Dialog
    :visible="request !== null"
    modal
    header="Configure PDK"
    :style="{ width: 'min(860px, 95vw)' }"
    @update:visible="
      (visible) => {
        if (!visible) finish(false)
      }
    "
  >
    <p class="mb-3 text-sm">
      PDK descriptions identify the process, version and resources. ECC adaptations
      configure tools separately. Changes are saved in ECC management; the PDK directory
      remains unchanged. Resource paths are relative to the PDK directory.
    </p>
    <p class="mb-3 text-sm break-all">PDK resources: {{ request?.root }}</p>
    <p v-if="configurationPath" class="mb-3 text-sm break-all">
      Configuration source: {{ configurationPath }}
    </p>
    <div v-if="error" role="alert" class="mb-3 text-red-500">{{ error }}</div>
    <PdkProfileSelection
      v-if="request"
      :root="request.root"
      :revision="initialized ? revision : undefined"
      :disabled="busy"
      @applied="profileApplied"
    />
    <label class="block text-sm" for="pdk-family">Family ID</label>
    <input
      id="pdk-family"
      v-model="family"
      class="mb-3 w-full rounded border p-2"
      :disabled="busy || initialized"
    />
    <button
      v-if="!initialized"
      class="rounded border px-3 py-2"
      :disabled="busy || !family"
      @click="initialize"
    >
      Create configuration
    </button>
    <template v-else>
      <label class="block text-sm" for="pdk-field">Configuration section</label>
      <select
        id="pdk-field"
        v-model="field"
        class="mb-3 w-full rounded border p-2"
        @change="loadSection"
      >
        <option v-for="name in sections" :key="name" :value="name">{{ name }}</option>
      </select>
      <p class="mb-2 text-sm">{{ fieldDescription }}</p>
      <textarea
        v-model="value"
        aria-label="Section configuration"
        rows="12"
        spellcheck="false"
        class="w-full rounded border p-2 font-mono text-sm"
      />
      <div class="my-3 flex gap-2">
        <button class="rounded border px-3 py-2" :disabled="busy" @click="save">
          Save section
        </button>
        <button class="rounded border px-3 py-2" :disabled="busy" @click="discover">
          Discover files
        </button>
        <button class="rounded border px-3 py-2" :disabled="busy" @click="validate">
          Validate resources
        </button>
      </div>
      <div v-if="candidates.length" class="my-3 max-h-60 overflow-auto">
        <table class="w-full text-left text-xs">
          <thead>
            <tr>
              <th>Include</th>
              <th>File</th>
              <th>Resource role</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="candidate in candidates" :key="candidate.path">
              <td>
                <input
                  v-model="candidate.selected"
                  type="checkbox"
                  :aria-label="`Include ${candidate.path}`"
                />
              </td>
              <td class="break-all">{{ candidate.path }}</td>
              <td>
                <select
                  v-model="candidate.role"
                  :aria-label="`Role for ${candidate.path}`"
                >
                  <option v-for="role in resourceRoles" :key="role">{{ role }}</option>
                </select>
              </td>
            </tr>
          </tbody>
        </table>
        <button
          class="my-2 rounded border px-3 py-2"
          :disabled="busy"
          @click="saveResources"
        >
          Add selected resources
        </button>
        <p class="text-xs">
          Choose technology LEF explicitly. Library views, synthesis libraries and cell
          roles are configured in their sections.
        </p>
      </div>
      <table v-if="Object.keys(stages).length" class="my-3 w-full text-left text-xs">
        <thead>
          <tr>
            <th>Stage</th>
            <th>Resource readiness</th>
            <th>Missing roles</th>
            <th>Backend qualification</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(stage, name) in stages" :key="name">
            <td>{{ name }}</td>
            <td>{{ stage.resources_ready ? 'Available' : 'Blocked' }}</td>
            <td>{{ stage.missing_roles.join(', ') }}</td>
            <td>{{ stage.qualification }}</td>
          </tr>
        </tbody>
      </table>
      <pre v-if="details" class="max-h-60 overflow-auto text-xs whitespace-pre-wrap">{{
        details
      }}</pre>
    </template>
    <div class="mt-4 flex justify-end gap-2">
      <button class="rounded border px-3 py-2" :disabled="busy" @click="finish(false)">
        Cancel
      </button>
      <button
        class="rounded border px-3 py-2"
        :disabled="busy || !validated"
        @click="finish(true)"
      >
        Import configured PDK
      </button>
    </div>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Dialog from 'primevue/dialog'
import { getDesktopApi } from '@/platform/desktop'
import { usePdkConfiguration } from '@/composables/usePdkConfiguration'
import type { PdkConfigureRequest } from '@ecos-studio/shared'
import PdkProfileSelection from './PdkProfileSelection.vue'

const { request, finish } = usePdkConfiguration()
const family = ref('')
const field = ref('resources')
const value = ref('{}')
const revision = ref('')
const configurationPath = ref('')
const document = ref<Record<string, unknown>>({})
const properties = ref<Record<string, { description?: string }>>({})
const sections = computed(() =>
  Object.keys(properties.value).filter((name) => name !== 'schema_version'),
)
const fieldDescription = computed(
  () =>
    properties.value[field.value]?.description ??
    'Edit the JSON value. ECC validates the configuration when saved.',
)
const initialized = ref(false)
const validated = ref(false)
const busy = ref(false)
const error = ref('')
const details = ref('')
const candidates = ref<{ path: string; role: string; selected: boolean }[]>([])
const resourceRoles = [
  'tech',
  'lef',
  'liberty',
  'verilog',
  'gds',
  'mapping',
  'rc',
  'em',
  'model',
]
const stages = ref<
  Record<
    string,
    { resources_ready: boolean; missing_roles: string[]; qualification: string }
  >
>({})
watch(value, () => {
  validated.value = false
})

async function command(
  action: PdkConfigureRequest['action'],
  extra: Partial<PdkConfigureRequest> = {},
) {
  const result = await getDesktopApi().pdkInventory.configure({
    action,
    root: request.value?.root,
    ...extra,
  })
  if (result.error) throw new Error(JSON.stringify(result.error))
  return result
}
async function perform(operation: () => Promise<void>) {
  busy.value = true
  error.value = ''
  try {
    await operation()
  } catch (reason) {
    error.value = String(reason)
  } finally {
    busy.value = false
  }
}
function loadSection() {
  value.value = JSON.stringify(document.value[field.value] ?? {}, null, 2)
}
async function reload() {
  let result = await command('show')
  if (!result.revision) {
    await command('adopt')
    result = await command('show')
  }
  document.value = result.descriptor as Record<string, unknown>
  revision.value = typeof result.revision === 'string' ? result.revision : ''
  configurationPath.value = typeof result.path === 'string' ? result.path : ''
  initialized.value = true
  loadSection()
}
async function initialize() {
  await perform(async () => {
    await command('init', { familyId: family.value })
    await reload()
  })
}
async function profileApplied() {
  validated.value = false
  await perform(reload)
}
async function save() {
  validated.value = false
  await perform(async () => {
    await command('set', {
      field: field.value,
      value: JSON.parse(value.value),
      expectedRevision: revision.value,
    })
    await reload()
  })
}
async function discover() {
  await perform(async () => {
    const result = await command('discover')
    candidates.value = (
      result.candidates as { path: string; candidate_role: string }[]
    ).map((candidate) => ({
      path: candidate.path,
      role: candidate.candidate_role,
      selected: false,
    }))
  })
}
async function validate() {
  validated.value = false
  await perform(async () => {
    const result = await command('validate')
    details.value = JSON.stringify(result.diagnostics, null, 2)
    stages.value = result.stages as typeof stages.value
    validated.value = Array.isArray(result.diagnostics) && result.diagnostics.length === 0
  })
}
async function saveResources() {
  await perform(async () => {
    const resources = { ...(document.value.resources as Record<string, unknown>) }
    for (const candidate of candidates.value.filter((item) => item.selected)) {
      let index = 1
      while (`resource_${index}` in resources) index += 1
      resources[`resource_${index}`] = { path: candidate.path, role: candidate.role }
    }
    await command('set', {
      field: 'resources',
      value: resources,
      expectedRevision: revision.value,
    })
    validated.value = false
    candidates.value = []
    field.value = 'resources'
    await reload()
  })
}
watch(request, async (current) => {
  if (!current) return
  family.value = current.familyId
  initialized.value = false
  configurationPath.value = ''
  validated.value = false
  details.value = ''
  candidates.value = []
  stages.value = {}
  await perform(async () => {
    const schema = await command('schema')
    properties.value = schema.properties as Record<string, { description?: string }>
    const existing = await getDesktopApi().pdkInventory.configure({
      action: 'show',
      root: current.root,
    })
    const problem = existing.error as { code?: string } | undefined
    if (problem?.code === 'pdk_descriptor_missing') return
    if (problem) throw new Error(JSON.stringify(problem))
    await reload()
  })
})
</script>
