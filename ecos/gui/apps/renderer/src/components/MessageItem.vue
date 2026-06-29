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
        <button type="button" class="info-report-header-fs-btn info-report-header-fs-btn--sm shrink-0" title="查阅"
          aria-label="查阅" @click.stop="openImageLightbox(message.mapData.title, message.mapData.imageUrl)">
          <i class="ri-fullscreen-fill"></i>
        </button>
        <button type="button" class="info-report-header-close-btn info-report-header-close-btn--sm shrink-0"
          title="关闭" aria-label="关闭" @click.stop="emit('close')">
          <i class="ri-close-line"></i>
        </button>
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
            class="map-image w-full min-w-0 h-auto max-h-[400px] max-w-full object-contain block" @load="handleMapImageLoad"
            @error="handleMapImageError" />

          <!-- 颜色条图例 -->
          <div
            class="absolute bottom-3 right-3 flex flex-col items-end gap-1 bg-(--bg-secondary)/90 rounded-lg p-2 border border-(--border-color)/50">
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
      <!-- 标题栏（全屏查阅在右上角） -->
      <div class="flex items-center gap-2 px-3 py-2 border-b border-(--border-color)">
        <div class="flex items-center gap-2 min-w-0 flex-1">
          <i class="ri-file-list-3-line text-(--accent-color) shrink-0"></i>
          <span class="font-semibold text-xs truncate">{{ message.infoData.title }}</span>
          <span class="text-[10px] text-(--text-secondary) bg-(--bg-primary) px-2 py-0.5 rounded shrink-0">
            {{ message.infoData.step }}
          </span>
        </div>
        <button v-if="showFullscreenReportButton" type="button" class="info-report-header-fs-btn" title="查阅"
          aria-label="查阅" @click.stop="openHeaderReportLightbox">
          <i class="ri-fullscreen-fill"></i>
        </button>
        <button type="button" class="info-report-header-close-btn" title="关闭" aria-label="关闭"
          @click.stop="emit('close')">
          <i class="ri-close-line"></i>
        </button>
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
            class="nested-report-scroll text-[11px] bg-(--bg-primary) p-3 rounded whitespace-pre overflow-auto max-h-[400px] font-mono text-content-pre"
            @wheel="onNestedReportWheel"><code>{{ JSON.stringify(item.content, null, 2) }}</code></pre>
        </div>

        <!-- CSV 格式 - 表格显示 -->
        <div v-else-if="item.format === 'csv'" class="nested-report-scroll overflow-auto max-h-[400px]"
          @wheel="onNestedReportWheel">
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

        <!-- HTML 报告：嵌入区缩小字号；全屏查阅见标题栏按钮 -->
        <div v-else-if="item.format === 'html'" class="p-3 overflow-hidden">
          <div class="rounded-lg overflow-hidden bg-(--bg-primary) border border-(--border-color)/30 max-h-[350px]">
            <div class="nested-report-scroll info-html-embed markdown-body info-html-embed--compact overflow-auto max-h-[350px] p-3"
              @wheel="onNestedReportWheel"
              v-html="coerceHtmlString(item.content)"></div>
          </div>
        </div>

        <!-- 文本格式：嵌入区缩小字号；全屏查阅见标题栏按钮 -->
        <div v-else class="p-3 overflow-hidden">
          <div class="rounded-lg overflow-hidden bg-(--bg-primary) border border-(--border-color)/30 max-h-[350px]">
            <pre
              class="nested-report-scroll info-text-embed-compact bg-(--bg-primary) p-3 rounded-none whitespace-pre overflow-auto max-h-[350px] font-mono text-content-pre"
              @wheel="onNestedReportWheel"><code>{{ item.content }}</code></pre>
          </div>
        </div>
      </div>
    </div>

    <!-- 其他消息类型 -->
    <div v-else :class="[
      'message-bubble group relative max-w-[85%] rounded-lg text-sm',
      message.role === 'user'
        ? 'bg-(--accent-color) text-(--accent-text)'
        : 'bg-(--bg-secondary) text-(--text-primary) border border-(--border-color)'
    ]">
      <button type="button" class="message-close-btn" title="删除" aria-label="删除"
        @click.stop="emit('close')">
        <i class="ri-close-line"></i>
      </button>

      <!-- 图片消息 -->
      <div v-if="message.type === 'image' && message.image" class="p-2">
        <p class="text-xs opacity-90">{{ message.image.label }}:</p>
        <p v-if="message.image.description" class="text-xs opacity-90 whitespace-pre-line mb-2">{{
          message.image.description }}</p>
        <div class="relative rounded-lg overflow-hidden mb-2 min-w-0 max-w-full group">
          <img :src="message.image.url" :alt="message.image.label"
            class="w-full min-w-0 max-w-full h-auto object-contain max-h-[400px]" loading="lazy"
            @load="handleImageLoad" />
          <button type="button" class="image-fs-overlay-btn" title="查阅" aria-label="查阅"
            @click.stop="openImageLightbox(message.image.label || 'Image', message.image.url)">
            <i class="ri-fullscreen-fill"></i>
          </button>
          <button type="button" class="image-close-overlay-btn" title="关闭" aria-label="关闭"
            @click.stop="emit('close')">
            <i class="ri-close-line"></i>
          </button>
        </div>
      </div>

      <!-- 文本消息 -->
      <div v-else class="px-4 py-2 pr-8">
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

    <!-- 全屏查阅 Lightbox：HTML / JSON / 纯文本 / 图片（对所有消息类型通用） -->
    <Teleport to="body">
      <Transition name="lightbox">
        <div v-if="reportLightbox.visible" class="info-html-lightbox-overlay" tabindex="-1"
          @click="closeReportLightbox">
          <div class="info-html-lightbox-content" @click.stop>
            <div class="info-html-lightbox-header">
              <span class="info-html-lightbox-title">{{ reportLightbox.title }}</span>
              <button type="button" class="info-html-lightbox-close" aria-label="关闭" @click="closeReportLightbox">
                <i class="ri-close-line"></i>
              </button>
            </div>
            <div class="info-html-lightbox-body"
              :class="{ 'info-html-lightbox-body--image': reportLightbox.mode === 'image' }">
              <div v-if="reportLightbox.mode === 'image'" class="info-image-lightbox-wrapper">
                <img :src="reportLightbox.body" :alt="reportLightbox.title" class="info-image-lightbox-img" />
              </div>
              <div v-else-if="reportLightbox.mode === 'html'" class="info-html-lightbox-inner markdown-body"
                v-html="reportLightbox.body"></div>
              <pre v-else class="info-report-lightbox-pre"><code>{{ reportLightbox.body }}</code></pre>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import MarkdownIt from 'markdown-it'
import type { Message } from '../types'
import { sanitizeHtml } from '@/utils/sanitizeHtml'

const props = defineProps<{
  message: Message
}>()

const emit = defineEmits<{
  (e: 'img-load'): void
  (e: 'close'): void
}>()

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true
})

const defaultLinkOpen =
  md.renderer.rules.link_open ??
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))

md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  tokens[idx]?.attrSet('target', '_blank')
  tokens[idx]?.attrSet('rel', 'noopener noreferrer')
  return defaultLinkOpen(tokens, idx, options, env, self)
}

const renderedContent = computed(() => {
  return sanitizeHtml(md.render(props.message.content))
})

const handleImageLoad = () => {
  emit('img-load')
}

// Map 图片加载状态
const mapImageLoading = ref(true)

/** 报告全屏查阅：HTML / JSON / 纯文本（与 HomeView 图表 lightbox 行为一致） */
const reportLightbox = ref<{
  visible: boolean
  title: string
  mode: 'html' | 'text' | 'json' | 'image'
  body: string
}>({
  visible: false,
  title: '',
  mode: 'text',
  body: '',
})

function coerceReportBody(content: unknown): string {
  return typeof content === 'string' ? content : String(content ?? '')
}

function formatJsonForLightbox(content: unknown): string {
  try {
    return JSON.stringify(content, null, 2)
  } catch {
    return coerceReportBody(content)
  }
}

function openReportLightbox(title: string, content: unknown, mode: 'html' | 'text' | 'json') {
  const rawBody = mode === 'json' ? formatJsonForLightbox(content) : coerceReportBody(content)
  const body = mode === 'html' ? sanitizeHtml(rawBody) : rawBody
  reportLightbox.value = {
    visible: true,
    title: title || 'Report',
    mode,
    body,
  }
}

function closeReportLightbox() {
  reportLightbox.value.visible = false
}

function onDocumentKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && reportLightbox.value.visible) {
    closeReportLightbox()
    e.preventDefault()
    e.stopPropagation()
  }
}

onMounted(() => {
  document.addEventListener('keydown', onDocumentKeydown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', onDocumentKeydown)
})

function onNestedReportWheel(e: WheelEvent) {
  const el = e.currentTarget as HTMLElement | null
  if (!el) return
  const canScroll = el.scrollHeight > el.clientHeight
  if (!canScroll) return

  const atTop = el.scrollTop <= 0
  const atBottom = Math.ceil(el.scrollTop + el.clientHeight) >= el.scrollHeight
  const scrollingUp = e.deltaY < 0
  const scrollingDown = e.deltaY > 0

  if ((scrollingUp && atTop) || (scrollingDown && atBottom)) {
    e.preventDefault()
    el.closest('.custom-scrollbar')?.scrollBy({ top: e.deltaY })
  }
}

function openImageLightbox(title: string, url: string) {
  if (!url) return
  reportLightbox.value = {
    visible: true,
    title: title || 'Image',
    mode: 'image',
    body: url,
  }
}

function coerceHtmlString(content: unknown): string {
  return sanitizeHtml(coerceReportBody(content))
}

/** 标题栏全屏按钮：存在 HTML / JSON / 纯文本等可全屏内容时显示 */
const showFullscreenReportButton = computed(() => {
  if (props.message.type !== 'info' || !props.message.infoData?.items?.length) return false
  return props.message.infoData.items.some(
    i => i.format === 'html' || i.format === 'text' || i.format === 'json'
  )
})

/** 优先 HTML → JSON → 纯文本（多段 items 时与 ThumbnailGallery 行为一致） */
function openHeaderReportLightbox() {
  const items = props.message.infoData?.items
  if (!items?.length) return
  const htmlItem = items.find(i => i.format === 'html')
  if (htmlItem) {
    openReportLightbox(htmlItem.label, htmlItem.content, 'html')
    return
  }
  const jsonItem = items.find(i => i.format === 'json')
  if (jsonItem) {
    openReportLightbox(jsonItem.label, jsonItem.content, 'json')
    return
  }
  const textItem = items.find(i => i.format === 'text')
  if (textItem) {
    openReportLightbox(textItem.label, textItem.content, 'text')
  }
}

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
  /* 替换元素在 flex 子树中默认 min-width:auto，会按固有宽度参与 min-content，撑开整列 */
  min-width: 0;
  max-width: 100%;
  display: block;
}

.message-close-btn {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 2;
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 5px;
  background: rgba(0, 0, 0, 0.18);
  color: currentColor;
  cursor: pointer;
  font-size: 12px;
  opacity: 0;
  transform: translateY(-2px);
  transition: opacity 0.15s ease, transform 0.15s ease, background-color 0.15s ease;
}

.message-bubble:hover .message-close-btn,
.message-close-btn:focus-visible {
  opacity: 0.72;
  transform: translateY(0);
}

.message-close-btn:hover {
  opacity: 1;
  background: rgba(239, 68, 68, 0.18);
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

/* 纯文本报告嵌入：缩小字号 */
.info-text-embed-compact {
  font-size: 10px;
  line-height: 1.45;
  color: var(--text-primary);
}

.info-text-embed-compact code {
  font-size: inherit;
}

/* Lightbox 内纯文本报告：18px 等宽 */
.info-report-lightbox-pre {
  margin: 0;
  padding: 0;
  font-size: 18px;
  line-height: 1.45;
  white-space: pre;
  word-break: normal;
  overflow-wrap: normal;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace;
  color: var(--text-primary);
}

.info-report-lightbox-pre code {
  font-size: inherit;
  font-family: inherit;
}

/* HTML 报告嵌入：缩小字号（相对原 11px 纯文本略小） */
.info-html-embed--compact {
  font-size: 10px;
  line-height: 1.45;
  color: var(--text-primary);
}

.info-html-embed--compact :deep(pre),
.info-html-embed--compact :deep(code) {
  font-size: inherit;
}

.info-html-embed--compact :deep(h1) {
  font-size: 1.35em;
  font-weight: 700;
}

.info-html-embed--compact :deep(h2) {
  font-size: 1.2em;
  font-weight: 600;
}

.info-html-embed--compact :deep(h3) {
  font-size: 1.1em;
  font-weight: 600;
}

/* Info 卡片标题栏：查阅 / 关闭（与内嵌报告区分离，避免挡内容） */
.info-report-header-fs-btn,
.info-report-header-close-btn {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-primary);
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 16px;
}

.info-report-header-fs-btn:hover,
.info-report-header-close-btn:hover {
  background: var(--bg-secondary);
}

.info-report-header-fs-btn:hover {
  color: var(--accent-color);
}

.info-report-header-close-btn:hover {
  color: #ef4444;
}

/* Map 标题栏更紧凑的尺寸 */
.info-report-header-fs-btn--sm,
.info-report-header-close-btn--sm {
  width: 24px;
  height: 24px;
  font-size: 13px;
  border-radius: 5px;
}

/* 图片消息：右上角浮动操作按钮 */
.image-fs-overlay-btn,
.image-close-overlay-btn {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  cursor: pointer;
  font-size: 14px;
  opacity: 0;
  transform: translateY(-2px);
  transition: opacity 0.15s ease, transform 0.15s ease, background-color 0.15s ease;
}

.image-close-overlay-btn {
  right: 40px;
}

.group:hover .image-fs-overlay-btn,
.group:hover .image-close-overlay-btn,
.image-fs-overlay-btn:focus-visible,
.image-close-overlay-btn:focus-visible {
  opacity: 1;
  transform: translateY(0);
}

.image-fs-overlay-btn:hover,
.image-close-overlay-btn:hover {
  background: rgba(0, 0, 0, 0.75);
}

.image-close-overlay-btn:hover {
  color: #fecaca;
}

/* HTML 报告查阅 Lightbox（与 HomeView 图表预览一致） */
.info-html-lightbox-overlay {
  position: fixed;
  inset: 0;
  z-index: 20000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(0, 0, 0, 0.72);
  box-sizing: border-box;
}

.info-html-lightbox-content {
  width: min(98vw, 1760px);
  max-height: min(92vh, 960px);
  display: flex;
  flex-direction: column;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  overflow: hidden;
  box-shadow: 0 24px 48px rgba(0, 0, 0, 0.35);
}

.info-html-lightbox-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

.info-html-lightbox-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.info-html-lightbox-close {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.info-html-lightbox-close:hover {
  background: var(--bg-primary);
  color: var(--text-primary);
}

.info-html-lightbox-body {
  flex: 1;
  min-height: 0;
  padding: 12px;
  background: var(--bg-primary);
  overflow: auto;
}

/* 图片模式：居中展示，背景更暗 */
.info-html-lightbox-body--image {
  padding: 0;
  background: #0b0b0f;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: auto;
}

.info-image-lightbox-wrapper {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  box-sizing: border-box;
}

.info-image-lightbox-img {
  /* 显式以视口单位限制尺寸，避免依赖父级 height:100%（父级仅有 max-height 时会失效） */
  max-width: min(96vw, 1720px);
  max-height: min(calc(92vh - 52px), 900px);
  width: auto;
  height: auto;
  object-fit: contain;
  display: block;
  user-select: none;
  -webkit-user-drag: none;
}

.info-html-lightbox-inner {
  font-size: 18px;
  line-height: 1.5;
  color: var(--text-primary);
}

.info-html-lightbox-inner :deep(pre) {
  font-size: inherit;
}

.lightbox-enter-active,
.lightbox-leave-active {
  transition: opacity 0.2s ease;
}

.lightbox-enter-from,
.lightbox-leave-to {
  opacity: 0;
}

.lightbox-enter-active .info-html-lightbox-content,
.lightbox-leave-active .info-html-lightbox-content {
  transition: transform 0.2s ease;
}

.lightbox-enter-from .info-html-lightbox-content,
.lightbox-leave-to .info-html-lightbox-content {
  transform: scale(0.96);
}
</style>
