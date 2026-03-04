<template>
  <div class="flex flex-col h-full bg-(--bg-primary)">
    <!-- Tabs 标题栏 -->
    <div class="flex items-center border-b border-(--border-color)">
      <button v-for="tab in tabs" :key="tab.id" @click="handleTabChange(tab.id)" :class="[
        'flex-1 flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium transition-all border-b-2',
        activeTab === tab.id
          ? 'text-(--accent-color) border-(--accent-color) bg-(--accent-color)/5'
          : 'text-(--text-secondary) border-transparent hover:text-(--text-primary) hover:bg-(--bg-secondary)/50'
      ]">
        <i :class="tab.icon"></i>
        <span>{{ tab.label }}</span>
      </button>
    </div>

    <!-- Tab 内容区域 -->
    <div class="flex-1 min-h-0 min-w-0 overflow-auto">
      <!-- 加载状态 -->
      <div v-if="isLoadingTab" class="flex items-center justify-center h-full">
        <div class="text-center">
          <i class="ri-loader-4-line text-2xl text-(--accent-color) animate-spin"></i>
          <p class="text-[11px] text-(--text-secondary) mt-2">Loading...</p>
        </div>
      </div>

      <!-- 无 step 时的提示 -->
      <div v-else-if="!currentStep" class="flex items-center justify-center h-full">
        <div class="text-center px-4">
          <i class="ri-information-line text-3xl text-(--text-secondary) opacity-50"></i>
          <p class="text-[11px] text-(--text-secondary) mt-2">Please select a flow step first</p>
        </div>
      </div>



      <!-- 空数据提示 -->
      <div v-else-if="Object.keys(currentTabInfo).length === 0" class="flex items-center justify-center h-full">
        <div class="text-center px-4">
          <i class="ri-file-list-3-line text-3xl text-(--text-secondary) opacity-50"></i>
          <p class="text-[11px] text-(--text-secondary) mt-2">No data</p>
        </div>
      </div>

      <!-- Info Keys 列表 -->
      <div v-else class="p-3 w-full">
        <!-- Analysis 网格布局 -->
        <div v-if="activeTab === InfoEnum.analysis" class="grid grid-cols-2 gap-2">
          <a v-for="(value, key) in currentTabInfo" :key="key" @click="handleKeyClick(key as string, value)" :class="[
            'group flex items-center gap-2.5 p-2.5 rounded-lg cursor-pointer',
            'transition-all duration-200 ease-out',
            'border',
            loadingKey === key
              ? 'bg-(--bg-secondary) border-(--border-color) opacity-60 pointer-events-none'
              : [
                'bg-(--bg-secondary)/50 border-(--border-color)/50',
                'hover:bg-(--bg-secondary) hover:border-(--border-color)',
                'hover:shadow-sm'
              ]
          ]">
            <!-- 图标 -->
            <div :class="[
              'flex items-center justify-center w-7 h-7 rounded-md shrink-0',
              'transition-colors duration-200',
              loadingKey === key
                ? 'bg-(--bg-tertiary) text-(--text-secondary)'
                : 'bg-(--accent-color)/10 text-(--accent-color) group-hover:bg-(--accent-color)/15'
            ]">
              <i v-if="loadingKey === key" class="ri-loader-4-line animate-spin text-sm"></i>
              <i v-else :class="[getAnalysisIcon(key as string), 'text-sm']"></i>
            </div>
            <!-- 文本 -->
            <span :class="[
              'text-[11px] font-medium truncate',
              'transition-colors duration-200',
              loadingKey === key
                ? 'text-(--text-secondary)'
                : 'text-(--text-primary) group-hover:text-(--accent-color)'
            ]">{{ key }}</span>
          </a>
        </div>

        <!-- Maps 展示 -->
        <div v-else-if="activeTab === InfoEnum.maps" class="w-full">
          <MapsGallery :maps-data="currentTabInfo as Record<string, MapInfoType>" @select="handleMapSelect" />
        </div>
      </div>

      <!-- 错误提示 -->
      <div v-if="currentTabError" class="p-3">
        <div class="p-3 rounded-lg bg-red-500/10 border border-red-500/30">
          <p class="text-[11px] text-red-500">{{ currentTabError }}</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useMessageStore } from '../stores/messageStore'
import { getInfoApi } from '../api/flow'
import { CMDEnum, InfoEnum, StepEnum, ResponseEnum } from '../api/type'
import { useTauri } from '../composables/useTauri'
import { useWorkspace } from '../composables/useWorkspace'
import { readTextFile } from '@tauri-apps/plugin-fs'
import MapsGallery from './MapsGallery.vue'
import type { MapInfo as MapInfoType } from '../types'

const route = useRoute()
const messageStore = useMessageStore()
const { isInTauri } = useTauri()
const { currentProject } = useWorkspace()

// Tabs 定义
const tabs = [
  { id: InfoEnum.analysis, label: 'Analysis', icon: 'ri-pie-chart-line' },
  { id: InfoEnum.maps, label: 'Maps', icon: 'ri-map-2-line' },
  { id: InfoEnum.checklist, label: 'Checklist', icon: 'ri-list-check-line' }
]

const activeTab = ref<InfoEnum>(InfoEnum.analysis)
const isLoadingTab = ref(false)
const loadingKey = ref<string | null>(null)

// 分析项图标映射
const analysisIconMap: Record<string, string> = {
  // 时序相关
  timing: 'ri-timer-line',
  clock: 'ri-time-line',
  setup: 'ri-arrow-up-line',
  hold: 'ri-arrow-down-line',
  slack: 'ri-speed-line',
  delay: 'ri-hourglass-line',
  // 功耗相关
  power: 'ri-flashlight-line',
  leakage: 'ri-drop-line',
  dynamic: 'ri-pulse-line',
  // 面积相关
  area: 'ri-layout-grid-line',
  utilization: 'ri-pie-chart-line',
  density: 'ri-apps-line',
  cell: 'ri-checkbox-blank-line',
  // 布线相关
  wire: 'ri-route-line',
  route: 'ri-git-branch-line',
  congestion: 'ri-traffic-light-line',
  drc: 'ri-shield-check-line',
  // 网表相关
  netlist: 'ri-share-line',
  instance: 'ri-instance-line',
  net: 'ri-links-line',
  pin: 'ri-pushpin-line',
  // 统计相关
  summary: 'ri-file-list-3-line',
  report: 'ri-file-chart-line',
  stats: 'ri-bar-chart-line',
  histogram: 'ri-bar-chart-grouped-line',
  // 其他
  design: 'ri-draft-line',
  floorplan: 'ri-layout-4-line',
  placement: 'ri-grid-line',
  cts: 'ri-tree-line'
}

// 根据 key 获取图标
function getAnalysisIcon(key: string): string {
  const lowerKey = key.toLowerCase()
  // 精确匹配
  if (analysisIconMap[lowerKey]) {
    return analysisIconMap[lowerKey]
  }
  // 模糊匹配
  for (const [keyword, icon] of Object.entries(analysisIconMap)) {
    if (lowerKey.includes(keyword)) {
      return icon
    }
  }
  // 默认图标
  return 'ri-file-text-line'
}

// 存储每个 tab 的 info 数据（值可能是字符串路径或对象）
const tabInfoCache = ref<Record<string, Record<string, unknown>>>({})

// 存储每个 tab 的错误信息
const tabErrorCache = ref<Record<string, string | null>>({})

// 获取当前 tab 的错误信息
const currentTabError = computed(() => {
  if (!currentStep.value) return null
  const cacheKey = `${currentStep.value}_${activeTab.value}`
  return tabErrorCache.value[cacheKey] || null
})

// 设置当前 tab 的错误信息
function setTabError(error: string | null) {
  if (!currentStep.value) return
  const cacheKey = `${currentStep.value}_${activeTab.value}`
  tabErrorCache.value[cacheKey] = error
}

// 获取当前 step
const stepEnumValues = Object.values(StepEnum)

function getStepEnumFromPath(path: string): StepEnum | undefined {
  return stepEnumValues.find(step => step.toLowerCase() === path.toLowerCase())
}

const currentStep = computed(() => {
  const pathParts = route.path.split('/')
  const currentPath = pathParts[pathParts.length - 1] || ''
  return getStepEnumFromPath(currentPath)
})

// 当前 tab 的 info 数据
const currentTabInfo = computed(() => {
  if (!currentStep.value) return {}
  const cacheKey = `${currentStep.value}_${activeTab.value}`
  return tabInfoCache.value[cacheKey] || {}
})

// 定义带有 path 和 info 的对象类型
interface InfoWithPath {
  path: string
  info: string[]
}

// 检查是否为字符串类型
function isString(value: unknown): value is string {
  return typeof value === 'string'
}

// 检查是否为带有 path 和 info 的对象
function isInfoWithPath(value: unknown): value is InfoWithPath {
  return (
    typeof value === 'object' &&
    value !== null &&
    'path' in value &&
    typeof (value as InfoWithPath).path === 'string'
  )
}

// 从值中提取路径
function getPath(value: unknown): string | null {
  if (isString(value)) return value
  if (isInfoWithPath(value)) return value.path
  return null
}

// 从值中提取 info 数组
function getInfoArray(value: unknown): string[] | null {
  if (isInfoWithPath(value) && Array.isArray(value.info)) {
    return value.info
  }
  return null
}

// 根据文件扩展名确定格式
function getFileFormat(value: unknown): 'json' | 'csv' | 'text' {
  const path = getPath(value)
  if (!path) return 'json' // 对象类型默认为 JSON 格式
  const ext = path.split('.').pop()?.toLowerCase()
  if (ext === 'json') return 'json'
  if (ext === 'csv') return 'csv'
  return 'text'
}

// 将远程路径转换为本地项目路径
// 例如: /nfs/share/home/xxx/benchmark/sky130_gcd/place_ecc/feature/file
// 转换为: /Users/ekko/projects/place_ecc/feature/file
function convertToLocalPath(remotePath: string): string {
  // 如果不是远程路径，直接返回
  if (!remotePath.includes('/nfs/')) {
    return remotePath
  }

  // 获取当前项目路径
  const projectPath = currentProject.value?.path
  console.log('projectPath:', currentProject.value)
  if (!projectPath) {
    console.warn('No current project path available')
    return remotePath
  }

  // 从项目路径中提取项目名称（最后一个目录名）
  const projectName = projectPath.split('/').filter(Boolean).pop()
  console.log('projectName:', projectName)
  if (!projectName) {
    console.warn('Cannot extract project name from path:', projectPath)
    return remotePath
  }

  // 在远程路径中找到项目名称的位置
  const projectNameIndex = remotePath.indexOf(`/${projectName}/`)
  if (projectNameIndex === -1) {
    console.warn('Project name not found in remote path:', remotePath)
    return remotePath
  }

  // 截取项目名称之后的相对路径部分
  const relativePath = remotePath.slice(projectNameIndex + projectName.length + 2) // +2 for the two '/'

  console.log('projectPath:', projectPath, 'relativePath:', relativePath)
  // 拼接本地项目路径
  const localPath = `${projectPath}/${relativePath}`
  console.log('Path converted:', remotePath, '->', localPath)

  return localPath
}

// 获取 Tab 数据
async function fetchTabInfo(tabId: InfoEnum) {
  if (!currentStep.value) return

  const cacheKey = `${currentStep.value}_${tabId}`

  // 如果已有缓存，不重新请求
  if (tabInfoCache.value[cacheKey]) return

  isLoadingTab.value = true
  setTabError(null)

  try {
    const response = await getInfoApi({
      cmd: CMDEnum.get_info,
      data: {
        step: currentStep.value,
        id: tabId
      }
    })

    console.log('getInfoApi response:', response)

    if (response.response !== ResponseEnum.success) {
      setTabError(response.message?.join(', ') || 'Failed to get info')
      return
    }

    const infoObj = response.data?.info
    if (infoObj && typeof infoObj === 'object') {
      tabInfoCache.value[cacheKey] = infoObj as Record<string, unknown>
    }
  } catch (err) {
    console.error('fetchTabInfo error:', err)
    setTabError(err instanceof Error ? err.message : 'Unknown error')
  } finally {
    isLoadingTab.value = false
  }
}

// 处理 Tab 切换
async function handleTabChange(tabId: InfoEnum) {
  activeTab.value = tabId
  await fetchTabInfo(tabId)
}

// 处理 Key 点击 - 读取文件并显示到 chat
async function handleKeyClick(key: string, value: unknown) {
  if (!currentStep.value) return

  loadingKey.value = key
  setTabError(null)

  try {
    let content: unknown
    let path = getPath(value)
    const infoArray = getInfoArray(value)
    const format = getFileFormat(value)

    // 如果有 path，尝试读取文件
    if (path) {
      if (!isInTauri) {
        content = `File path: ${path}\n(Readable only in Tauri environment)`
      } else {
        // 转换远程路径为本地路径
        const localPath = convertToLocalPath(path)
        console.log('localPath:', localPath)
        const fileContent = await readTextFile(localPath)

        if (format === 'json') {
          try {
            content = JSON.parse(fileContent)
          } catch {
            content = fileContent
          }
        } else {
          content = fileContent
        }
      }
    } else {
      // 没有 path，直接使用整个值作为内容
      content = value
    }

    // 构建 items 数组
    const items: Array<{ label: string; content: unknown; format: 'json' | 'csv' | 'text' }> = []

    // 添加文件内容
    items.push({
      label: path ? path.split('/').pop() || path : '[Data]',
      content,
      format
    })

    // 如果有 info 数组，添加额外的 info 信息
    if (infoArray && infoArray.length > 0) {
      items.push({
        label: 'Additional Info',
        content: infoArray.join('\n'),
        format: 'text'
      })
    }

    // 发送到 chat
    messageStore.addInfoMessage({
      title: key,
      step: currentStep.value,
      items
    })

  } catch (err) {
    console.error('handleKeyClick error:', err)
    setTabError(err instanceof Error ? err.message : 'Failed to read file')
  } finally {
    loadingKey.value = null
  }
}

// 处理 Maps 选择 - 发送图片和信息到 chat
function handleMapSelect(key: string, item: MapInfoType, blobUrl: string) {
  if (!currentStep.value) return

  // 转换路径用于显示
  const localPath = convertToLocalPath(item.path)

  // 使用传入的 blobUrl，如果没有则使用占位图
  const imageUrl = blobUrl || `https://placehold.co/400x400/1a1a2e/16a085?text=${encodeURIComponent(key)}`

  // 格式化标题
  const formattedTitle = key
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')

  // 确定分类
  const lowerKey = key.toLowerCase()
  let category = 'Other'
  if (lowerKey.includes('density')) category = 'Density Map'
  else if (lowerKey.includes('rudy')) category = 'RUDY'
  else if (lowerKey.includes('egr')) category = 'EGR Congestion'

  // 发送到 chat
  messageStore.addMapMessage({
    title: formattedTitle,
    step: currentStep.value,
    imageUrl,
    localPath,
    info: item.info || [],
    category
  })
}

// 监听 step 变化，重新获取数据
watch(currentStep, async (newStep) => {
  if (newStep) {
    // 清除缓存
    tabInfoCache.value = {}
    tabErrorCache.value = {}
    // 获取当前 tab 的数据
    await fetchTabInfo(activeTab.value)
  }
}, { immediate: true })
</script>
