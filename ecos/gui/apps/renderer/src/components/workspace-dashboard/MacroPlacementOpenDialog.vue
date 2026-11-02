<template>
  <Dialog
    :visible="visible"
    modal
    header="Open Macro Placement"
    :style="{ width: 'min(440px, calc(100vw - 32px))' }"
    :draggable="false"
    @update:visible="emit('update:visible', $event)"
  >
    <p class="macro-placement-open-copy">
      View the saved macro placement layout, or enter edit mode to adjust macro positions.
    </p>
    <div class="macro-placement-open-actions">
      <button type="button" class="macro-placement-open-action" @click="emit('view')">
        View layout
      </button>
      <button
        type="button"
        class="macro-placement-open-action is-primary"
        @click="emit('edit')"
      >
        Enter edit mode
      </button>
    </div>
  </Dialog>
</template>

<script setup lang="ts">
import Dialog from 'primevue/dialog'

defineProps<{ visible: boolean }>()

const emit = defineEmits<{
  edit: []
  'update:visible': [visible: boolean]
  view: []
}>()
</script>

<style scoped>
.macro-placement-open-copy {
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.55;
  margin: 0;
}

.macro-placement-open-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 22px;
}

.macro-placement-open-action {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  color: var(--text-primary);
  cursor: pointer;
  font-size: 12px;
  min-width: 92px;
  padding: 7px 10px;
}

.macro-placement-open-action:hover {
  border-color: var(--accent-color);
  color: var(--accent-color);
}

.macro-placement-open-action.is-primary {
  background: var(--accent-color);
  border-color: var(--accent-color);
  color: #fff;
}
</style>
