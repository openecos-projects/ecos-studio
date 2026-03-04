import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ThemeName } from '@/applications/editor'

export const useThemeStore = defineStore('theme', () => {
  const themeName = ref<ThemeName>('dark')

  /** 初始化主题 */
  const initTheme = () => {
    const savedTheme = localStorage.getItem('theme') as ThemeName | null
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches

    if (savedTheme === 'dark' || savedTheme === 'light') {
      themeName.value = savedTheme
    } else if (prefersDark) {
      themeName.value = 'dark'
    } else {
      themeName.value = 'light'
    }

    applyTheme(themeName.value)
  }

  /** 切换主题 */
  const toggleTheme = () => {
    themeName.value = themeName.value === 'dark' ? 'light' : 'dark'
    applyTheme(themeName.value)
    localStorage.setItem('theme', themeName.value)
  }

  /** 设置主题 */
  const setTheme = (name: ThemeName) => {
    themeName.value = name
    applyTheme(name)
    localStorage.setItem('theme', name)
  }

  /** 应用主题到 DOM */
  const applyTheme = (name: ThemeName) => {
    if (name === 'dark') {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }

  /** 是否是暗色主题 */
  const isDark = () => themeName.value === 'dark'

  return {
    themeName,
    initTheme,
    toggleTheme,
    setTheme,
    isDark
  }
})

