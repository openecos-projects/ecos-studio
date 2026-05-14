<script setup lang="ts">
import { ref, shallowRef, markRaw, onMounted, onUnmounted, watch } from 'vue'
import { createDefaultEditor, Editor } from './index'
import type { IPlugin } from './plugins'
import { useThemeStore } from '@/stores/themeStore'

interface Props {
  /** 额外的插件 */
  plugins?: IPlugin[]
  /** 是否使用默认插件配置 (默认 true) */
  useDefaultPlugins?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  plugins: () => [],
  useDefaultPlugins: true
})

const emit = defineEmits<{
  /** 编辑器初始化完成 */
  ready: [editor: Editor]
}>()

const themeStore = useThemeStore()

const containerRef = ref<HTMLDivElement | null>(null)
// 使用 shallowRef 避免 Vue 深度代理 Pixi.js 对象，这会导致兼容性问题
const editor = shallowRef<Editor | null>(null)
const isReady = ref(false)

/** 初始化编辑器 */
async function initEditor() {
  if (!containerRef.value) return

  // 根据配置创建编辑器，使用 markRaw 防止 Vue 代理 Pixi.js 对象
  // 使用当前主题初始化
  const editorOptions = { theme: themeStore.themeName }
  if (props.useDefaultPlugins) {
    editor.value = markRaw(createDefaultEditor(editorOptions))
  } else {
    editor.value = markRaw(new Editor(editorOptions))
  }

  // 注册额外插件
  editor.value.use(props.plugins);
  // 整个应用禁止鼠标缩放
  containerRef.value.addEventListener('wheel', (event) => {
    event.preventDefault()
  }, { passive: false })

  // 禁止右键
  containerRef.value.addEventListener('contextmenu', (event) => {
    event.preventDefault()
  }, { passive: false })

  // 初始化
  await editor.value.init(containerRef.value)
  isReady.value = true
  emit('ready', editor.value as Editor)
}

/** 销毁编辑器 */
function destroyEditor() {
  if (editor.value) {
    editor.value.destroy()
    editor.value = null
    isReady.value = false
  }
}

// 监听插件变化
watch(
  () => props.plugins,
  (newPlugins, oldPlugins) => {
    if (!editor.value || !isReady.value) return

    // 移除旧插件
    for (const plugin of oldPlugins || []) {
      editor.value.remove(plugin.name)
    }

    // 添加新插件
    for (const plugin of newPlugins) {
      editor.value.use(plugin)
    }
  },
  { deep: true }
)

// 监听主题变化
watch(
  () => themeStore.themeName,
  (newTheme) => {
    if (editor.value && isReady.value) {
      editor.value.setTheme(newTheme)
    }
  }
)

onMounted(() => {
  initEditor()
})

onUnmounted(() => {
  destroyEditor()
})

// 暴露编辑器实例供父组件访问
defineExpose({
  editor,
  isReady
})
</script>

<template>
  <div ref="containerRef" class="editor-container">
    <!-- 加载状态 -->
    <div v-if="!isReady" class="editor-loading">
      <div class="loading-spinner"></div>
      <span>Loading Editor...</span>
    </div>
  </div>
</template>

<style scoped>
.editor-container {
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;
  background: var(--bg-secondary, #1a1a2e);
}

.editor-loading {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--text-secondary, #888);
  font-size: 13px;
}

.loading-spinner {
  width: 24px;
  height: 24px;
  border: 2px solid var(--border-color, #333);
  border-top-color: var(--accent-color, #4a9eff);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
