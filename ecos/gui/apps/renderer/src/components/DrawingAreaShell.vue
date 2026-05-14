<template>
  <section class="drawing-area-shell">
    <div class="drawing-area-shell__body">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.drawing-area-shell {
  height: 100%;
  min-height: 560px;
  background:
    linear-gradient(90deg, rgba(60, 52, 38, 0.05) 1px, transparent 1px) 0 0 / 20px 20px,
    rgba(255, 250, 240, 0.78);
  border: 1px solid rgba(60, 52, 38, 0.16);
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 22px 58px -48px rgba(23, 20, 15, 0.5);
}

.drawing-area-shell__body {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 560px;
  padding: 14px;
  background:
    radial-gradient(circle at top right, rgba(191, 72, 39, 0.11), transparent 26%),
    linear-gradient(180deg, rgba(255, 250, 240, 0.8), rgba(236, 229, 213, 0.86));
}

.drawing-area-shell__body::before {
  content: "";
  position: absolute;
  inset: 14px;
  border-radius: 8px;
  background:
    linear-gradient(rgba(255, 250, 240, 0.06) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 250, 240, 0.06) 1px, transparent 1px),
    linear-gradient(180deg, #10191c 0%, #263238 100%);
  background-size: 24px 24px, 24px 24px, auto;
  border: 1px solid rgba(255, 250, 240, 0.12);
  box-shadow:
    inset 0 1px 0 rgba(255, 250, 240, 0.05),
    0 20px 40px -28px rgba(16, 25, 28, 0.7);
}

.drawing-area-shell__body > * {
  position: relative;
  z-index: 1;
}
</style>
