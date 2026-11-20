<template>
  <div class="mb-4 rounded border p-3">
    <template v-if="profiles.length">
      <label for="ecc-default-profile" class="block text-sm"
        >ECC default adaptation</label
      >
      <select
        id="ecc-default-profile"
        v-model="selected"
        class="my-2 w-full rounded border p-2"
        :disabled="disabled || busy"
      >
        <option value="">Select a reviewed profile</option>
        <option v-for="profile in profiles" :key="profile.id" :value="profile.id">
          {{ profile.family_id }} · {{ profile.release }} · {{ profile.profile_revision }}
        </option>
      </select>
      <p class="text-sm">
        ECC checks the selected PDK files before saving. New workspaces use the saved
        configuration. Synthetic EMIR models are for flow testing only.
      </p>
      <label v-if="revision" class="my-2 flex gap-2 text-sm">
        <input v-model="replaceDefaults" type="checkbox" :disabled="disabled || busy" />
        Replace the saved defaults for new workspaces, including my edits.
      </label>
      <button
        class="mt-2 rounded border px-3 py-2"
        :disabled="disabled || busy || !selected || (!!revision && !replaceDefaults)"
        @click="apply"
      >
        Apply default adaptation
      </button>
    </template>
    <p v-if="message" role="status" class="text-sm">{{ message }}</p>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { getDesktopApi } from '@/platform/desktop'

const props = defineProps<{ root: string; revision?: string; disabled?: boolean }>()
const emit = defineEmits<{ applied: [] }>()
type Profile = {
  id: string
  family_id: string
  release: string
  profile_revision: string
}
const profiles = ref<Profile[]>([])
const selected = ref('')
const replaceDefaults = ref(false)
const busy = ref(false)
const message = ref('')
watch(
  () => props.root,
  async (_root, _previous, onCleanup) => {
    let active = true
    onCleanup(() => {
      active = false
    })
    selected.value = ''
    replaceDefaults.value = false
    profiles.value = []
    message.value = ''
    try {
      const response = await getDesktopApi().pdkInventory.configure({
        action: 'profiles-list',
      })
      if (!active) return
      if (response.error) throw new Error(JSON.stringify(response.error))
      profiles.value = Array.isArray(response.profiles) ? response.profiles : []
    } catch {
      if (!active) return
      message.value =
        'Default profiles are unavailable in this ECC runtime. You can configure the PDK below.'
    }
  },
  { immediate: true },
)
watch(
  () => props.revision,
  () => {
    replaceDefaults.value = false
  },
)
async function apply() {
  busy.value = true
  message.value = ''
  try {
    const result = await getDesktopApi().pdkInventory.configure({
      action: 'profiles-apply',
      root: props.root,
      profileId: selected.value,
      expectedRevision: props.revision,
    })
    if (result.error) throw new Error(JSON.stringify(result.error))
    message.value = 'Default adaptation saved. Validate resources before importing.'
    replaceDefaults.value = false
    emit('applied')
  } catch (error) {
    message.value = String(error)
  } finally {
    busy.value = false
  }
}
</script>
