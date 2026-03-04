<template>
  <div class="maps-gallery w-full">
    <!-- 图片网格 -->
    <div class="grid grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
      <div v-for="(item, key) in mapsData" :key="key" @click="handleMapClick(key as string, item)" :class="[
        'group relative rounded-lg overflow-hidden cursor-pointer',
        'bg-(--bg-secondary) border border-(--border-color)/50',
        'transition-all duration-200 ease-out',
        'hover:border-(--accent-color)/50 hover:shadow-md hover:shadow-(--accent-color)/10',
        'hover:-translate-y-0.5',
        selectedKey === key ? 'ring-2 ring-(--accent-color) border-(--accent-color)' : ''
      ]">
        <!-- 图片容器 -->
        <div class="relative aspect-4/3 overflow-hidden bg-(--bg-tertiary)">
          <!-- 加载状态 -->
          <div v-if="loadingImages[key as string]" class="absolute inset-0 flex items-center justify-center">
            <i class="ri-loader-4-line text-lg text-(--accent-color) animate-spin"></i>
          </div>

          <!-- 图片 -->
          <img v-if="getImageUrl(key as string)" v-show="!loadingImages[key as string]"
            :src="getImageUrl(key as string)" :alt="key as string"
            class="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
            @load="handleImageLoad(key as string)" @error="handleImageError(key as string)" />

          <!-- 加载失败占位 -->
          <div v-if="errorImages[key as string]"
            class="absolute inset-0 flex flex-col items-center justify-center text-(--text-secondary)/50">
            <i class="ri-image-line text-lg"></i>
          </div>

          <!-- 悬浮遮罩 -->
          <div
            class="absolute inset-0 bg-linear-to-t from-black/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200">
          </div>

          <!-- 选中标记 -->
          <div v-if="selectedKey === key" class="absolute top-1 right-1">
            <div class="w-4 h-4 rounded-full bg-(--accent-color) flex items-center justify-center">
              <i class="ri-check-line text-white text-[10px]"></i>
            </div>
          </div>
        </div>

        <!-- 标题 -->
        <div class="p-1.5">
          <h4
            class="text-[10px] font-medium text-(--text-primary) truncate group-hover:text-(--accent-color) transition-colors">
            {{ formatMapName(key as string) }}
          </h4>
        </div>
      </div>
    </div>

    <!-- 空状态 -->
    <div v-if="Object.keys(mapsData).length === 0" class="flex flex-col items-center justify-center py-8">
      <i class="ri-image-line text-4xl text-(--text-secondary)/30 mb-2"></i>
      <p class="text-xs text-(--text-secondary)">No data</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onUnmounted } from 'vue'
import { readFile } from '@tauri-apps/plugin-fs'
import { useTauri } from '../composables/useTauri'
import { useWorkspace } from '../composables/useWorkspace'

// Props
interface MapInfo {
  path: string
  info: string[]
}

interface Props {
  mapsData: Record<string, MapInfo>
}

const props = defineProps<Props>()

// Emits
const emit = defineEmits<{
  (e: 'select', key: string, item: MapInfo, blobUrl: string): void
}>()

const { isInTauri } = useTauri()
const { currentProject } = useWorkspace()

// 状态
const selectedKey = ref<string | null>(null)
const loadingImages = ref<Record<string, boolean>>({})
const errorImages = ref<Record<string, boolean>>({})
// 存储加载后的 blob URL
const imageUrls = ref<Record<string, string>>({})

// 将远程路径转换为本地项目路径
function convertToLocalPath(remotePath: string): string {
  if (!remotePath.includes('/nfs/')) {
    return remotePath
  }

  const projectPath = currentProject.value?.path
  if (!projectPath) {
    console.warn('No current project path available')
    return remotePath
  }

  const projectName = projectPath.split('/').filter(Boolean).pop()
  if (!projectName) {
    console.warn('Cannot extract project name from path:', projectPath)
    return remotePath
  }

  const projectNameIndex = remotePath.indexOf(`/${projectName}/`)
  if (projectNameIndex === -1) {
    console.warn('Project name not found in remote path:', remotePath)
    return remotePath
  }

  const relativePath = remotePath.slice(projectNameIndex + projectName.length + 2)
  const localPath = `${projectPath}/${relativePath}`
  return localPath
}

// 根据文件扩展名获取 MIME 类型
function getMimeType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'png': return 'image/png'
    case 'jpg':
    case 'jpeg': return 'image/jpeg'
    case 'gif': return 'image/gif'
    case 'webp': return 'image/webp'
    case 'svg': return 'image/svg+xml'
    default: return 'image/png'
  }
}

// 异步加载图片并创建 blob URL
async function loadImage(key: string, path: string): Promise<void> {
  // 如果已经加载过，跳过
  if (imageUrls.value[key]) return

  // 设置加载状态
  loadingImages.value[key] = true
  errorImages.value[key] = false

  try {
    if (!isInTauri) {
      // 开发模式下使用占位图
      imageUrls.value[key] = `https://placehold.co/200x200/1a1a2e/16a085?text=${encodeURIComponent(key.slice(0, 10))}`
      loadingImages.value[key] = false
      return
    }

    const localPath = convertToLocalPath(path)
    console.log('Loading image from:', localPath)

    // 使用 fs plugin 读取文件
    const fileData = await readFile(localPath)

    // 创建 Blob
    const mimeType = getMimeType(path)
    const blob = new Blob([fileData], { type: mimeType })

    // 创建 blob URL
    const blobUrl = URL.createObjectURL(blob)
    imageUrls.value[key] = blobUrl

    console.log('Created blob URL for', key, ':', blobUrl)
  } catch (error) {
    console.error('Failed to load image:', key, error)
    errorImages.value[key] = true
  } finally {
    loadingImages.value[key] = false
  }
}

// 获取图片 URL（已加载的 blob URL 或空字符串）
function getImageUrl(key: string): string {
  return imageUrls.value[key] || ''
}

// 监听 mapsData 变化，自动加载图片
watch(
  () => props.mapsData,
  async (newData) => {
    if (!newData) return
    // 并行加载所有图片
    const loadPromises = Object.entries(newData).map(([key, item]) =>
      loadImage(key, item.path)
    )
    await Promise.allSettled(loadPromises)
  },
  { immediate: true, deep: true }
)

// 组件销毁时清理 blob URL
onUnmounted(() => {
  Object.values(imageUrls.value).forEach(url => {
    if (url.startsWith('blob:')) {
      URL.revokeObjectURL(url)
    }
  })
})

// 格式化地图名称
function formatMapName(key: string): string {
  // 将 key 转换为更友好的显示名称
  return key
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

// 处理图片加载成功（img onload）
function handleImageLoad(key: string) {
  loadingImages.value[key] = false
  errorImages.value[key] = false
}

// 处理图片加载错误（img onerror）
function handleImageError(key: string) {
  loadingImages.value[key] = false
  errorImages.value[key] = true
}

// 处理地图点击
function handleMapClick(key: string, item: MapInfo) {
  selectedKey.value = key
  const blobUrl = imageUrls.value[key] || ''
  emit('select', key, item, blobUrl)
}
</script>

<style scoped>
/* 组件样式已通过 Tailwind 类实现 */
</style>
