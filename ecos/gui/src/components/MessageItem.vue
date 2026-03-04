<template>
  <div :class="[
    'flex w-full min-w-0',
    message.role === 'user' ? 'justify-end' : 'justify-start'
  ]">
    <!-- Map 消息 - 热力图/密度图展示 -->
    <div v-if="message.type === 'map' && message.mapData"
      class="map-message-container w-full max-w-full min-w-0 rounded-xl text-sm bg-(--bg-secondary) text-(--text-primary) border border-(--border-color) overflow-hidden shadow-sm">
      <!-- 标题栏 -->
      <div
        class="flex items-center gap-2 px-4 py-3 bg-linear-to-r from-(--accent-color)/10 to-transparent border-b border-(--border-color)">
        <div class="w-8 h-8 rounded-lg bg-(--accent-color)/20 flex items-center justify-center shrink-0">
          <i class="ri-map-2-line text-(--accent-color) text-base"></i>
        </div>
        <div class="flex-1 min-w-0 overflow-hidden">
          <h3 class="font-semibold text-xs text-(--text-primary) truncate">{{ message.mapData.title }}</h3>
          <span class="text-[10px] text-(--text-secondary)">{{ message.mapData.step }}</span>
        </div>
        <span v-if="message.mapData.category"
          class="text-[10px] text-(--accent-color) bg-(--accent-color)/10 px-2 py-0.5 rounded-full shrink-0">
          {{ message.mapData.category }}
        </span>
      </div>

      <!-- 统计信息 -->
      <div v-if="message.mapData.info && message.mapData.info.length > 0 && message.mapData.info[0] !== ''"
        class="px-4 py-3 border-b border-(--border-color)/50 overflow-hidden">
        <div class="flex items-center gap-2 mb-2">
          <i class="ri-bar-chart-2-line text-(--accent-color) text-xs shrink-0"></i>
          <span class="text-[10px] font-medium text-(--text-secondary) uppercase tracking-wide">Statistics</span>
        </div>
        <div class="grid grid-cols-1 gap-1.5">
          <div v-for="(infoLine, idx) in message.mapData.info.filter(l => l)" :key="idx"
            class="flex items-center justify-between py-1.5 px-3 rounded-lg bg-(--bg-primary)/50 min-w-0 overflow-hidden">
            <span class="text-[11px] text-(--text-secondary) truncate mr-2">{{ parseInfoKey(infoLine) }}</span>
            <span class="text-[11px] font-mono font-medium text-(--accent-color) shrink-0">{{ parseInfoValue(infoLine)
            }}</span>
          </div>
        </div>
      </div>

      <!-- 图片展示 -->
      <div class="p-3 overflow-hidden">
        <div class="relative rounded-xl overflow-hidden bg-(--bg-tertiary) border border-(--border-color)/30">
          <!-- 加载状态 -->
          <div v-if="mapImageLoading"
            class="absolute inset-0 flex items-center justify-center z-10 bg-(--bg-secondary)/80">
            <div class="text-center">
              <i class="ri-loader-4-line text-2xl text-(--accent-color) animate-spin"></i>
              <p class="text-[10px] text-(--text-secondary) mt-2">Loading...</p>
            </div>
          </div>

          <!-- 图片 -->
          <img :src="message.mapData.imageUrl" :alt="message.mapData.title"
            class="map-image w-full h-auto max-h-[400px] object-contain block" @load="handleMapImageLoad"
            @error="handleMapImageError" />

          <!-- 颜色条图例 -->
          <div
            class="absolute bottom-3 right-3 flex flex-col items-end gap-1 bg-(--bg-secondary)/90 backdrop-blur-sm rounded-lg p-2 border border-(--border-color)/50">
            <div class="w-4 h-24 rounded overflow-hidden"
              style="background: linear-gradient(to bottom, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff);"></div>
            <div class="flex flex-col justify-between h-24 text-[8px] text-(--text-secondary) font-mono">
              <span>1.0</span>
              <span>0.8</span>
              <span>0.6</span>
              <span>0.4</span>
              <span>0.2</span>
            </div>
          </div>
        </div>

        <!-- 文件路径 -->
        <div class="mt-2 flex items-center gap-1.5 text-[9px] text-(--text-secondary)/60 min-w-0 overflow-hidden">
          <i class="ri-folder-line shrink-0"></i>
          <span class="truncate">{{ message.mapData.localPath }}</span>
        </div>
      </div>
    </div>

    <!-- Info 消息 -->
    <div v-else-if="message.type === 'info' && message.infoData"
      class="w-full min-w-0 p-2 rounded-lg text-sm bg-(--bg-secondary) text-(--text-primary) border border-(--border-color) overflow-hidden">
      <!-- 标题栏 -->
      <div class="flex items-center gap-2 px-3 py-2 border-b border-(--border-color)">
        <i class="ri-file-list-3-line text-(--accent-color)"></i>
        <span class="font-semibold text-xs">{{ message.infoData.title }}</span>
        <span class="text-[10px] text-(--text-secondary) bg-(--bg-primary) px-2 py-0.5 rounded">
          {{ message.infoData.step }}
        </span>
      </div>

      <!-- 数据内容 - 直接显示表格 -->
      <div v-for="(item, index) in message.infoData.items" :key="index" class="info-content overflow-hidden">
        <!-- JSON 格式 - 简单对象渲染为表格 -->
        <div v-if="item.format === 'json' && isSimpleObject(item.content)" class="overflow-auto">
          <table class="w-full text-xs">
            <tbody>
              <tr v-for="(value, key) in item.content" :key="key"
                class="border-b border-(--border-color)/30 hover:bg-(--bg-primary)/30">
                <td class="py-2 px-3 font-medium text-(--text-secondary) whitespace-nowrap w-[40%]">{{ key }}</td>
                <td class="py-2 px-3 text-(--text-primary)">{{ formatValue(value) }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- JSON 格式 - 复杂对象 -->
        <div v-else-if="item.format === 'json'" class="p-3 overflow-hidden">
          <pre
            class="text-[11px] bg-(--bg-primary) p-3 rounded whitespace-pre overflow-auto max-h-[400px] font-mono text-content-pre"><code>{{ JSON.stringify(item.content, null, 2) }}</code></pre>
        </div>

        <!-- CSV 格式 - 表格显示 -->
        <div v-else-if="item.format === 'csv'" class="overflow-auto max-h-[400px]">
          <table class="w-full text-xs border-collapse">
            <thead v-if="csvHeaders(item.content).length > 0" class="sticky top-0">
              <tr class="bg-(--bg-primary)">
                <th v-for="header in csvHeaders(item.content)" :key="header"
                  class="py-2 px-3 text-left font-medium text-(--text-secondary) border-b border-(--border-color)">
                  {{ header }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, rowIndex) in csvRows(item.content)" :key="rowIndex"
                class="border-b border-(--border-color)/30 hover:bg-(--bg-primary)/30">
                <td v-for="(cell, cellIndex) in row" :key="cellIndex" class="py-2 px-3">
                  {{ cell }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 文本格式 -->
        <div v-else class="p-3 overflow-hidden">
          <pre
            class="text-[11px] bg-(--bg-primary) p-3 rounded whitespace-pre overflow-auto max-h-[350px] font-mono text-content-pre"><code>{{ item.content }}</code></pre>
        </div>
      </div>
    </div>

    <!-- 其他消息类型 -->
    <div v-else :class="[
      'max-w-[85%] rounded-lg text-sm',
      message.role === 'user'
        ? 'bg-(--accent-color) text-(--accent-text)'
        : 'bg-(--bg-secondary) text-(--text-primary) border border-(--border-color)'
    ]">
      <!-- 图片消息 -->
      <div v-if="message.type === 'image' && message.image" class="p-2">
        <p class="text-xs opacity-90">{{ message.image.label }}:</p>
        <p v-if="message.image.description" class="text-xs opacity-90 whitespace-pre-line mb-2">{{
          message.image.description }}</p>
        <div class="rounded-lg overflow-hidden mb-2">
          <img :src="message.image.url" :alt="message.image.label" class="w-full h-auto object-contain max-h-[400px]"
            loading="lazy" @load="handleImageLoad" />
        </div>
      </div>

      <!-- 文本消息 -->
      <div v-else class="px-4 py-2">
        <!-- 加载状态 -->
        <div v-if="message.status === 'loading' && !message.content" class="flex items-center gap-2">
          <div class="loading-dots flex gap-1">
            <span class="w-2 h-2 bg-current rounded-full animate-bounce" style="animation-delay: 0ms;"></span>
            <span class="w-2 h-2 bg-current rounded-full animate-bounce" style="animation-delay: 150ms;"></span>
            <span class="w-2 h-2 bg-current rounded-full animate-bounce" style="animation-delay: 300ms;"></span>
          </div>
          <span class="text-xs opacity-70">Thinking...</span>
        </div>

        <!-- 错误状态 -->
        <div v-else-if="message.status === 'error'" class="flex items-center gap-2 text-red-500">
          <i class="ri-error-warning-line"></i>
          <span>{{ message.content || 'Failed to send message' }}</span>
        </div>

        <!-- 正常内容（Markdown 渲染） -->
        <div v-else class="markdown-body" v-html="renderedContent"></div>

        <!-- 流式加载时显示光标 -->
        <span v-if="message.status === 'loading' && message.content"
          class="inline-block w-2 h-4 bg-current animate-pulse ml-0.5"></span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import MarkdownIt from 'markdown-it'
import type { Message } from '../types'

const props = defineProps<{
  message: Message
}>()

const emit = defineEmits<{
  (e: 'img-load'): void
}>()

const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true
})

const renderedContent = computed(() => {
  return md.render(props.message.content)
})

const handleImageLoad = () => {
  emit('img-load')
}

// Map 图片加载状态
const mapImageLoading = ref(true)

function handleMapImageLoad() {
  mapImageLoading.value = false
  emit('img-load')
}

function handleMapImageError() {
  mapImageLoading.value = false
}

// 解析 info 行的 key（冒号前的部分）
function parseInfoKey(line: string): string {
  if (!line) return ''
  const colonIndex = line.indexOf(':')
  if (colonIndex === -1) return line
  return line.slice(0, colonIndex).trim()
}

// 解析 info 行的 value（冒号后的部分）
function parseInfoValue(line: string): string {
  if (!line) return ''
  const colonIndex = line.indexOf(':')
  if (colonIndex === -1) return ''
  const value = line.slice(colonIndex + 1).trim()
  // 尝试格式化数字
  const num = parseFloat(value)
  if (!isNaN(num)) {
    if (Math.abs(num) < 0.001 || Math.abs(num) > 10000) {
      return num.toExponential(3)
    }
    return num.toFixed(4)
  }
  return value
}

// 检查是否为简单对象（一层嵌套，可以用表格展示）
function isSimpleObject(obj: any): boolean {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    return false
  }
  return Object.values(obj).every(v =>
    typeof v !== 'object' || v === null
  )
}

// 格式化值显示
function formatValue(value: any): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (typeof value === 'object') return JSON.stringify(value)
  if (typeof value === 'number') {
    // 科学计数法格式化
    if (Math.abs(value) < 0.001 || Math.abs(value) > 10000) {
      return value.toExponential(3)
    }
    return value.toLocaleString()
  }
  return String(value)
}

// 解析 CSV 获取表头
function csvHeaders(content: string): string[] {
  if (typeof content !== 'string') return []
  const lines = content.trim().split('\n')
  if (lines.length === 0) return []
  return lines[0].split(',').map(h => h.trim())
}

// 解析 CSV 获取数据行
function csvRows(content: string): string[][] {
  if (typeof content !== 'string') return []
  const lines = content.trim().split('\n')
  if (lines.length <= 1) return []
  return lines.slice(1).map(line =>
    line.split(',').map(cell => cell.trim())
  )
}
</script>

<style scoped>
.markdown-body {
  line-height: 1.6;
  word-break: break-word;
}

.markdown-body :deep(p) {
  margin-bottom: 0.5rem;
}

.markdown-body :deep(p:last-child) {
  margin-bottom: 0;
}

.markdown-body :deep(code) {
  background-color: rgba(0, 0, 0, 0.1);
  padding: 0.2rem 0.4rem;
  border-radius: 4px;
  font-family: monospace;
}

.markdown-body :deep(pre) {
  background-color: var(--bg-secondary);
  padding: 1rem;
  border-radius: 8px;
  overflow-x: auto;
  margin: 0.5rem 0;
  border: 1px solid var(--border-color);
}

.markdown-body :deep(pre code) {
  background-color: transparent;
  padding: 0;
  display: block;
}

.markdown-body :deep(ul) {
  list-style-type: disc;
  padding-left: 1.5rem;
  margin-bottom: 0.5rem;
}

.markdown-body :deep(ol) {
  list-style-type: decimal;
  padding-left: 1.5rem;
  margin-bottom: 0.5rem;
}

.markdown-body :deep(li) {
  margin-bottom: 0.25rem;
}

.markdown-body :deep(a) {
  color: var(--accent-color);
  text-decoration: underline;
}

.markdown-body :deep(h1) {
  font-size: 1.5rem;
  font-weight: 700;
}

.markdown-body :deep(h2) {
  font-size: 1.25rem;
  font-weight: 600;
}

.markdown-body :deep(h3) {
  font-size: 1.1rem;
  font-weight: 600;
}

.markdown-body :deep(strong) {
  font-weight: 600;
}

.markdown-body :deep(em) {
  font-style: italic;
}

.markdown-body :deep(u) {
  text-decoration: underline;
}

.markdown-body :deep(blockquote) {
  border-left: 4px solid var(--accent-color);
  padding-left: 1rem;
  color: var(--text-secondary);
  font-style: italic;
  margin: 1rem 0;
  background-color: var(--bg-secondary);
  padding-top: 0.5rem;
  padding-bottom: 0.5rem;
  border-radius: 0 4px 4px 0;
}

/* 文本内容预格式化样式 - 防止撑开父容器 */
.text-content-pre {
  display: block;
  width: 0;
  min-width: 100%;
  max-width: 100%;
  box-sizing: border-box;
}

.info-content {
  min-width: 0;
  max-width: 100%;
  width: 100%;
}

/* 确保 pre 和 code 元素不会撑开容器 */
.info-content pre {
  width: 0;
  min-width: 100%;
}

.info-content pre code {
  display: block;
}

/* Map 消息容器 - 严格限制宽度防止撑开父容器 */
.map-message-container {
  contain: layout style paint;
  max-width: 100%;
  box-sizing: border-box;
}

.map-image {
  max-width: 100%;
  display: block;
}

/* 加载动画 */
.loading-dots span {
  animation: bounce 1s infinite;
}

@keyframes bounce {

  0%,
  80%,
  100% {
    transform: translateY(0);
  }

  40% {
    transform: translateY(-6px);
  }
}
</style>
