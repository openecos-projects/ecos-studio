<script setup lang="ts">
import { shallowRef, watch } from 'vue'
import { useRoute } from 'vue-router'
import { EditorContainer, type Editor } from '@/applications/editor'
import DrawingToolbar from './DrawingToolbar.vue'
import { useWorkspace } from '@/composables/useWorkspace'
import { useEDA } from '@/composables/useEDA'
import { getInfoApi } from '@/api/flow'
import { CMDEnum, InfoEnum, StepEnum, ResponseEnum } from '@/api/type'

const route = useRoute()
const { currentProject } = useWorkspace()
const { getResourceUrl } = useEDA()

const editor = shallowRef<Editor | null>(null)

// 从 StepEnum 动态生成路由路径映射（忽略大小写）
const stepEnumValues = Object.values(StepEnum)

function getStepEnumFromPath(path: string): StepEnum | undefined {
  return stepEnumValues.find(step => step.toLowerCase() === path.toLowerCase())
}

const onEditorReady = (editorInstance: Editor) => {
  console.log('Editor ready:', editorInstance)
  editor.value = editorInstance

  // 初始加载当前路径对应的数据
  const pathParts = route.path.split('/')
  const stage = pathParts[pathParts.length - 1] || 'home'
  handleStageChange(stage)
}

/**
 * 处理阶段切换，加载对应的 EDA 结果
 */
const handleStageChange = async (stage: string) => {
  if (!editor.value || !stage) return

  // 从路由路径获取对应的 StepEnum
  const stepEnum = getStepEnumFromPath(stage)
  if (!stepEnum) {
    console.log('No step enum found for stage:', stage)
    editor.value.clearBackground()
    return
  }


  try {
    // 1. 调用 getInfoApi 获取 layout 图片路径
    const response = await getInfoApi({
      cmd: CMDEnum.get_info,
      data: {
        step: stepEnum,
        id: InfoEnum.layout
      }
    })

    console.log('getInfoApi layout response:', response)

    if (response.response !== ResponseEnum.success) {
      console.warn('Failed to get layout info:', response.message)
      editor.value.clearBackground()
      return
    }

    const imagePath = response.data?.info?.image
    if (!imagePath) {
      console.warn('No image path in response')
      editor.value.clearBackground()
      return
    }

    // 2. 将本地文件路径转换为可访问的 blob URL
    const imageUrl = await getResourceUrl(imagePath, currentProject.value?.path || '')
    console.log('Image URL:', imageUrl)

    // 3. 更新编辑器背景
    await editor.value.setBackgroundImage(imageUrl)

  } catch (error) {
    console.error('Failed to load stage results:', error)
    editor.value?.clearBackground()
  }
}

// 监听路由路径变化
watch(() => route.path, (newPath) => {
  const pathParts = newPath.split('/')
  const stage = pathParts[pathParts.length - 1] || 'home'
  handleStageChange(stage)
})
</script>

<template>
  <div class="flex flex-col h-full overflow-hidden">
    <!-- 顶部工具栏 -->
    <DrawingToolbar :editor="editor" />

    <!-- 编辑器容器 -->
    <div class="relative flex-1 overflow-hidden">
      <EditorContainer @ready="onEditorReady" />
    </div>
  </div>
</template>
