<template>
  <div class="flex h-full flex-col overflow-hidden bg-(--bg-primary)">
    <!-- 装饰性背景渐变 -->
    <div class="welcome-gradient pointer-events-none absolute inset-0 opacity-5"></div>

    <!-- 装饰性网格背景 -->
    <div
      class="pointer-events-none absolute inset-0 opacity-[0.02]"
      style="
        background-image:
          linear-gradient(var(--text-primary) 1px, transparent 1px),
          linear-gradient(90deg, var(--text-primary) 1px, transparent 1px);
        background-size: 50px 50px;
      "
    ></div>

    <router-view class="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto" />
  </div>
</template>

<style scoped>
.welcome-gradient {
  background: radial-gradient(
    ellipse at 50% 30%,
    var(--accent-color) 0%,
    transparent 60%
  );
}
</style>
