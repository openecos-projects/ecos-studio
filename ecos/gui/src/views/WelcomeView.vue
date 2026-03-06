<template>
  <div class="flex flex-col h-full overflow-hidden bg-(--bg-primary)">
    <!-- 装饰性背景渐变 -->
    <div class="absolute inset-0 opacity-5 pointer-events-none welcome-gradient"></div>

    <!-- 装饰性网格背景 -->
    <div class="absolute inset-0 opacity-[0.02] pointer-events-none"
      style="background-image: linear-gradient(var(--text-primary) 1px, transparent 1px), linear-gradient(90deg, var(--text-primary) 1px, transparent 1px); background-size: 50px 50px;">
    </div>

    <router-view />
  </div>
</template>

<style scoped>
.welcome-gradient {
  background: radial-gradient(ellipse at 50% 30%, var(--accent-color) 0%, transparent 60%);
}
</style>
