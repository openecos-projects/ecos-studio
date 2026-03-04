import { createApp } from 'vue'
import { createPinia } from 'pinia'
import PrimeVue from 'primevue/config'
import ToastService from 'primevue/toastservice'
import Aura from '@primevue/themes/aura'
import router from './router'
import App from './App.vue'
import { initApiPort } from './api/client'
import { isTauri } from './composables/useTauri'
import './styles/index.css'
import 'remixicon/fonts/remixicon.css'

const app = createApp(App)
const pinia = createPinia()

app.use(PrimeVue, {
  theme: {
    preset: Aura,
    options: {
      darkModeSelector: '.dark'
    }
  }
})
app.use(ToastService)

app.use(pinia)
app.use(router)

// 初始化 API 端口（从 Tauri 后端获取动态端口），然后挂载应用
// initApiPort 会在 Tauri 环境中查询后端实际使用的端口，
// 非 Tauri 环境下会使用默认端口，不会阻塞
initApiPort()
  .then((port) => {
    console.log(`[app] API port resolved: ${port}`)
  })
  .catch((err) => {
    console.error('[app] API port init failed, mounting with defaults:', err)
  })
  .finally(() => {
    // 无论端口初始化成功或失败，始终挂载应用
    app.mount('#app')

    // 在 Tauri 环境中，通知后端应用已准备就绪
    const inTauri = isTauri();

    if (inTauri) {
      // 异步触发窗口显示，不阻塞主流程
      (async () => {
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          await router.isReady();
          // 等待 DOM 渲染
          requestAnimationFrame(() => {
            invoke('show_main_window').catch(console.error);
            console.log('ECC Window show signal sent');
          });
        } catch (e) {
          console.error('Failed to signal window show:', e);
        }
      })();
    }
  })

