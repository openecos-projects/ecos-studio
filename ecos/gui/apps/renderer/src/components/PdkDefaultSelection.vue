<template>
  <button
    type="button"
    class="mt-2 rounded border px-3 py-1 text-xs"
    :disabled="busy"
    @click="save"
  >
    Use for new Studio projects
  </button>
  <p v-if="message" role="status" class="mt-1 text-xs">{{ message }}</p>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { getDesktopApi } from '@/platform/desktop'

const props = defineProps<{ installationId: string }>()
const busy = ref(false)
const message = ref('')
async function save() {
  busy.value = true
  try {
    const result = await getDesktopApi().pdkInventory.configure({
      action: 'library-default',
      installationId: props.installationId,
      client: 'studio',
    })
    if (result.error) throw new Error(JSON.stringify(result.error))
    message.value =
      'Studio default saved. Existing projects and the ECC CLI default are unchanged.'
  } catch (error) {
    message.value = String(error)
  } finally {
    busy.value = false
  }
}
</script>
