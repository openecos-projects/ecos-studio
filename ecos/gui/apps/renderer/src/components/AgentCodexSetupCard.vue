<template>
  <section class="codex-setup" aria-label="Codex CLI 就绪">
    <div class="codex-setup__header">
      <div class="codex-setup__heading min-w-0 flex-1">
        <h3 class="codex-setup__title">需要 Codex CLI</h3>
        <p class="codex-setup__message selectable">
          {{ status.message || defaultMessage }}
        </p>
      </div>
      <span class="codex-setup__state" role="status">{{ stateLabel }}</span>
    </div>

    <dl v-if="status.binPath || status.version" class="codex-setup__meta selectable">
      <div v-if="status.version" class="codex-setup__meta-row">
        <dt>版本</dt>
        <dd>{{ status.version }}</dd>
      </div>
      <div v-if="status.binPath" class="codex-setup__meta-row">
        <dt>路径</dt>
        <dd class="break-all">{{ status.binPath }}</dd>
      </div>
    </dl>

    <div class="codex-setup__source" role="radiogroup" aria-label="模型来源">
      <span class="codex-setup__source-label">模型来源</span>
      <div class="codex-setup__source-options">
        <button
          v-for="profile in profiles"
          :key="profile.id"
          type="button"
          class="codex-setup__source-option"
          role="radio"
          :aria-checked="activeProfileId === profile.id"
          :class="{
            'codex-setup__source-option--active': activeProfileId === profile.id,
          }"
          :disabled="busy"
          @click="emit('select-profile', profile.id)"
        >
          {{ profile.name }}
        </button>
      </div>
      <button
        type="button"
        class="codex-setup__manage"
        :disabled="busy"
        @click="emit('manage')"
      >
        管理…
      </button>
    </div>

    <form class="codex-setup__key-form" @submit.prevent="submitKey">
      <label class="codex-setup__key-label" for="codex-setup-api-key">
        {{ activeProfile?.name ?? 'Codex' }} API Key
      </label>
      <input
        id="codex-setup-api-key"
        v-model="apiKey"
        type="password"
        class="codex-setup__key-input"
        autocomplete="off"
        spellcheck="false"
        :placeholder="keyConfigured ? '已配置（输入可更换）' : '粘贴 API Key'"
      />
      <button
        type="submit"
        class="codex-setup__action codex-setup__action--primary"
        :disabled="busy || !apiKey.trim()"
      >
        保存并使用
      </button>
    </form>

    <div
      v-if="status.state === 'installing' || status.progressMessage"
      class="codex-setup__progress"
      role="status"
      aria-live="polite"
    >
      <div class="codex-setup__progress-bar" aria-hidden="true">
        <span
          class="codex-setup__progress-fill"
          :style="{ width: `${Math.round((status.progressRatio ?? 0) * 100)}%` }"
        />
      </div>
      <p class="codex-setup__progress-text">
        {{ status.progressMessage || '正在安装…' }}
      </p>
    </div>

    <div class="codex-setup__actions">
      <button
        v-if="showInstall"
        type="button"
        class="codex-setup__action codex-setup__action--primary"
        :disabled="busy"
        @click="emit('install')"
      >
        一键安装
      </button>
      <button
        type="button"
        class="codex-setup__action"
        :disabled="busy"
        @click="emit('recheck')"
      >
        重新检测
      </button>
      <button
        v-if="activeProfile?.baseUrl === null"
        type="button"
        class="codex-setup__action"
        :disabled="busy"
        @click="emit('pick-bin')"
      >
        选择本地 codex
      </button>
      <button
        v-if="status.state === 'ready'"
        type="button"
        class="codex-setup__action codex-setup__action--primary"
        :disabled="busy"
        @click="emit('retry')"
      >
        继续使用 Agent
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type {
  DesktopCodexDependencyStatus,
  DesktopModelProfile,
} from '@ecos-studio/shared'

const props = defineProps<{
  busy?: boolean
  status: DesktopCodexDependencyStatus
  profiles?: DesktopModelProfile[]
  apiKeyConfigured?: Record<string, boolean>
}>()

const emit = defineEmits<{
  install: []
  'pick-bin': []
  recheck: []
  retry: []
  'select-profile': [profileId: string]
  'set-api-key': [profileId: string, apiKey: string]
  manage: []
}>()

const defaultMessage = 'ECOS Agent 依赖 Codex CLI 生成建议。请先完成安装与配置。'

const apiKey = ref('')

const activeProfileId = computed(
  () => props.status.activeProfileId ?? props.profiles?.[0]?.id ?? 'codex',
)

const activeProfile = computed(() =>
  props.profiles?.find((profile) => profile.id === activeProfileId.value),
)

const keyConfigured = computed(
  () =>
    props.apiKeyConfigured?.[activeProfileId.value] === true ||
    props.status.apiKeyConfigured === true,
)

function submitKey(): void {
  const key = apiKey.value.trim()
  if (!key) return
  emit('set-api-key', activeProfileId.value, key)
}

const stateLabel = computed(() => {
  switch (props.status.state) {
    case 'missing':
      return '未安装'
    case 'installing':
      return '安装中'
    case 'needs_api_key':
      return '待配置'
    case 'ready':
      return '已就绪'
    case 'error':
      return '异常'
    default:
      return props.status.state
  }
})

const showInstall = computed(
  () =>
    props.status.platformSupportsInstall &&
    (props.status.state === 'missing' ||
      props.status.state === 'error' ||
      props.status.state === 'installing'),
)
</script>

<style scoped>
.codex-setup {
  width: 100%;
  max-width: 28rem;
  margin: 0 auto;
  padding: 0.875rem 1rem;
  border: 1px solid var(--border-color);
  border-radius: 0.625rem;
  background: var(--bg-secondary);
}

.codex-setup__header {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
}

.codex-setup__title {
  margin: 0;
  color: var(--text-primary);
  font-size: 0.875rem;
  font-weight: 600;
  line-height: 1.35;
}

.codex-setup__message {
  margin: 0.35rem 0 0;
  color: var(--text-secondary);
  font-size: 0.75rem;
  line-height: 1.5;
}

.codex-setup__state {
  flex-shrink: 0;
  padding: 0.15rem 0.45rem;
  border: 1px solid var(--border-color);
  border-radius: 999px;
  color: var(--text-secondary);
  font-size: 0.6875rem;
  font-weight: 500;
  line-height: 1.3;
  white-space: nowrap;
}

.codex-setup__meta {
  display: grid;
  gap: 0.35rem;
  margin: 0.75rem 0 0;
}

.codex-setup__meta-row {
  display: grid;
  grid-template-columns: 2.5rem minmax(0, 1fr);
  gap: 0.5rem;
  margin: 0;
  font-size: 0.6875rem;
  line-height: 1.4;
}

.codex-setup__meta-row dt {
  margin: 0;
  color: var(--text-secondary);
  font-weight: 500;
}

.codex-setup__meta-row dd {
  margin: 0;
  color: var(--text-primary);
}

.codex-setup__source {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.75rem;
}

.codex-setup__source-label {
  flex-shrink: 0;
  color: var(--text-secondary);
  font-size: 0.6875rem;
  font-weight: 500;
}

.codex-setup__source-options {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.25rem;
  flex: 1;
  padding: 0.125rem;
  border: 1px solid var(--border-color);
  border-radius: 0.5rem;
  background: var(--bg-primary);
}

.codex-setup__source-option {
  padding: 0.3rem 0.4rem;
  border: none;
  border-radius: 0.375rem;
  background: transparent;
  color: var(--text-secondary);
  font-size: 0.6875rem;
  font-weight: 500;
  line-height: 1.3;
  white-space: nowrap;
}

.codex-setup__source-option--active {
  background: color-mix(in srgb, var(--accent-color) 14%, var(--bg-primary));
  color: var(--text-primary);
}

.codex-setup__source-option:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.codex-setup__manage {
  flex-shrink: 0;
  padding: 0.3rem 0.5rem;
  border: none;
  border-radius: 0.375rem;
  background: transparent;
  color: var(--text-secondary);
  font-size: 0.6875rem;
  font-weight: 500;
  line-height: 1.3;
  white-space: nowrap;
  cursor: pointer;
}

.codex-setup__manage:hover:not(:disabled) {
  background: color-mix(in srgb, var(--bg-secondary) 75%, transparent);
  color: var(--text-primary);
}

.codex-setup__manage:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.codex-setup__key-form {
  display: grid;
  gap: 0.35rem;
  margin-top: 0.75rem;
}

.codex-setup__key-label {
  color: var(--text-secondary);
  font-size: 0.6875rem;
  font-weight: 500;
}

.codex-setup__key-input {
  width: 100%;
  padding: 0.4rem 0.55rem;
  border: 1px solid var(--border-color);
  border-radius: 0.5rem;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 0.75rem;
  line-height: 1.3;
}

.codex-setup__key-input:focus {
  outline: none;
  border-color: color-mix(in srgb, var(--accent-color) 45%, var(--border-color));
}

.codex-setup__progress {
  margin-top: 0.75rem;
}

.codex-setup__progress-bar {
  height: 0.25rem;
  overflow: hidden;
  border-radius: 999px;
  background: color-mix(in srgb, var(--border-color) 80%, transparent);
}

.codex-setup__progress-fill {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--accent-color);
  transition: width 160ms ease;
}

.codex-setup__progress-text {
  margin: 0.35rem 0 0;
  color: var(--text-secondary);
  font-size: 0.6875rem;
  line-height: 1.4;
}

.codex-setup__actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.5rem;
  margin-top: 0.875rem;
}

.codex-setup__action {
  min-height: 2.125rem;
  padding: 0.4rem 0.65rem;
  border: 1px solid var(--border-color);
  border-radius: 0.5rem;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 0.75rem;
  font-weight: 500;
  line-height: 1.3;
  text-align: center;
}

.codex-setup__action:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.codex-setup__action--primary {
  border-color: color-mix(in srgb, var(--accent-color) 45%, var(--border-color));
  background: color-mix(in srgb, var(--accent-color) 12%, var(--bg-primary));
  color: var(--text-primary);
}

.codex-setup__action:not(:disabled):hover {
  border-color: color-mix(in srgb, var(--accent-color) 35%, var(--border-color));
}
</style>
