<template>
  <div
    class="flex h-full w-8 shrink-0 flex-col items-center border-l border-(--border-color) bg-(--bg-sidebar) py-4"
  >
    <div
      class="vertical-text py-4 text-[11px] font-medium tracking-widest text-(--text-secondary)"
    >
      Inspector
    </div>
  </div>
</template>

<script setup lang="ts"></script>

<style scoped>
.vertical-text {
  writing-mode: vertical-rl;
  text-orientation: mixed;
}
</style>
