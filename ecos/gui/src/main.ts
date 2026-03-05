import { createApp } from 'vue'
import { createPinia } from 'pinia'
import PrimeVue from 'primevue/config'
import ToastService from 'primevue/toastservice'
import Aura from '@primevue/themes/aura'
import router from './router'
import App from './App.vue'
import { initApiPort } from './api/client'
import '@fontsource-variable/inter'
import '@fontsource/noto-sans-sc/400.css'
import '@fontsource/noto-sans-sc/500.css'
import '@fontsource/noto-sans-sc/600.css'
import '@fontsource/noto-sans-sc/700.css'
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
    app.mount('#app')
  })

