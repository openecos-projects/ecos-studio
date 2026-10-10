<template>
  <article
    v-bind="$attrs"
    class="flow-signoff-card"
    aria-label="Signoff delivery milestone"
  >
    <header>Signoff</header>
    <i class="ri-shield-check-line" aria-hidden="true" />
    <strong>{{ eligible ? 'Ready for review' : 'Waiting for verification' }}</strong>
    <p>Delivery review, not a runtime step</p>
    <button type="button" :disabled="!eligible" @click="void exportSignoffPackage()">
      Review &amp; export
    </button>
  </article>
  <SignoffPackageReviewDialog
    :visible="signoffPackageReview.visible"
    :loading="signoffPackageReview.loading"
    :error="signoffPackageReview.error"
    :result="signoffPackageReview.result"
    @close="closeSignoffPackageReview"
    @refresh="refreshSignoffPackageReview"
    @export="confirmSignoffPackageExport"
  />
</template>

<script setup lang="ts">
import SignoffPackageReviewDialog from '@/components/SignoffPackageReviewDialog.vue'
import { useSignoffPackageExport } from '@/composables/useSignoffPackageExport'
import { useWorkspace } from '@/composables/useWorkspace'

defineProps<{ eligible: boolean }>()
defineOptions({ inheritAttrs: false })
const { currentProject, workspaceSession, showToast } = useWorkspace()
const {
  signoffPackageReview,
  exportSignoffPackage,
  closeSignoffPackageReview,
  refreshSignoffPackageReview,
  confirmSignoffPackageExport,
} = useSignoffPackageExport({ currentProject, workspaceSession, showToast })
</script>

<style scoped>
.flow-signoff-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: space-between;
  width: 150px;
  height: 176px;
  padding: 8px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 10px;
  text-align: center;
}
header {
  align-self: flex-start;
  font-weight: 650;
}
i {
  font-size: 28px;
  color: var(--accent-color);
}
p {
  margin: 0;
  color: var(--text-secondary);
}
button {
  border: 1px solid var(--border-color);
  border-radius: 4px;
  padding: 5px;
  background: transparent;
  color: var(--accent-color);
  cursor: pointer;
}
button:disabled {
  opacity: 0.55;
  cursor: default;
}
button:focus-visible {
  outline: 2px solid var(--accent-color);
}
</style>
