<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="profile-manager__backdrop"
      @click.self="emit('close')"
      @keydown.esc.stop.prevent="emit('close')"
    >
      <section
        class="profile-manager"
        role="dialog"
        aria-modal="true"
        aria-label="模型配置管理"
      >
        <header class="profile-manager__header">
          <h3 class="profile-manager__title">模型配置</h3>
          <button
            type="button"
            class="profile-manager__close"
            aria-label="关闭"
            @click="emit('close')"
          >
            <i class="ri-close-line" aria-hidden="true"></i>
          </button>
        </header>

        <div class="profile-manager__body">
          <ul class="profile-manager__list" role="listbox" aria-label="配置列表">
            <li v-for="profile in state?.profiles ?? []" :key="profile.id">
              <button
                type="button"
                class="profile-manager__item"
                :class="{
                  'profile-manager__item--editing': draft?.id === profile.id,
                }"
                role="option"
                :aria-selected="draft?.id === profile.id"
                :disabled="busy"
                @click="editProfile(profile)"
              >
                <span class="profile-manager__item-name">{{ profile.name }}</span>
                <span class="profile-manager__item-url">{{
                  profile.baseUrl ?? 'OpenAI 官方'
                }}</span>
                <span class="profile-manager__item-badges">
                  <span
                    v-if="state?.apiKeyConfigured[profile.id]"
                    class="profile-manager__badge"
                    >已配置</span
                  >
                  <span
                    v-if="state?.activeProfileId === profile.id"
                    class="profile-manager__badge profile-manager__badge--active"
                    >使用中</span
                  >
                </span>
              </button>
            </li>
            <li>
              <button
                type="button"
                class="profile-manager__item profile-manager__item--add"
                :disabled="busy"
                @click="addProfile"
              >
                <i class="ri-add-line" aria-hidden="true"></i> 新增配置
              </button>
            </li>
          </ul>

          <form v-if="draft" class="profile-manager__form" @submit.prevent="save">
            <label class="profile-manager__field">
              <span>名称</span>
              <input v-model="draft.name" :disabled="busy" maxlength="64" required />
            </label>
            <label v-if="draft.id === 'codex'" class="profile-manager__toggle">
              <input
                v-model="inheritCodexConfig"
                type="checkbox"
                :disabled="busy"
                @change="useManagedEndpoint"
              />
              <span>使用现有 Codex CLI 配置</span>
            </label>
            <label v-if="!inheritCodexConfig" class="profile-manager__field">
              <span>Base URL</span>
              <input
                v-model="draft.baseUrl"
                :disabled="busy"
                aria-label="Base URL"
                placeholder="https://…"
                required
              />
            </label>
            <details v-if="!inheritCodexConfig" class="profile-manager__advanced">
              <summary>高级配置</summary>
              <label class="profile-manager__field">
                <span>接口协议</span>
                <input
                  value="responses"
                  readonly
                  aria-label="接口协议"
                  title="Codex CLI 当前仅支持 Responses API"
                />
              </label>
              <label class="profile-manager__field">
                <span>Key 环境变量</span>
                <input
                  v-model="draft.envKey"
                  :disabled="busy"
                  placeholder="如 ZAI_API_KEY"
                  required
                />
              </label>
            </details>
            <label class="profile-manager__field">
              <span>API Key</span>
              <input
                v-model="apiKey"
                type="password"
                autocomplete="off"
                spellcheck="false"
                :disabled="busy"
                :placeholder="
                  state?.apiKeyConfigured[draft.id]
                    ? '已配置（输入可更换）'
                    : '粘贴 API Key'
                "
              />
            </label>

            <fieldset
              v-if="!inheritCodexConfig"
              class="profile-manager__models"
              :disabled="busy"
            >
              <legend>模型列表</legend>
              <div
                v-for="(model, index) in draft.models"
                :key="index"
                class="profile-manager__model-row"
              >
                <input
                  v-model="model.slug"
                  placeholder="模型 slug"
                  aria-label="模型 slug"
                  required
                />
                <input
                  v-model="model.displayName"
                  placeholder="显示名"
                  aria-label="模型显示名"
                  required
                />
                <input
                  v-model.number="model.contextWindow"
                  type="number"
                  min="1024"
                  max="4000000"
                  step="1"
                  aria-label="上下文窗口（tokens）"
                  title="上下文窗口"
                  required
                />
                <button
                  type="button"
                  class="profile-manager__model-remove"
                  aria-label="删除模型"
                  :disabled="draft.models.length <= 1"
                  @click="draft.models.splice(index, 1)"
                >
                  <i class="ri-subtract-line" aria-hidden="true"></i>
                </button>
              </div>
              <button
                type="button"
                class="profile-manager__model-add"
                :disabled="draft.models.length >= 32"
                @click="
                  draft.models.push({ slug: '', displayName: '', contextWindow: 200000 })
                "
              >
                <i class="ri-add-line" aria-hidden="true"></i> 添加模型
              </button>
            </fieldset>

            <label v-if="!inheritCodexConfig" class="profile-manager__field">
              <span>默认模型</span>
              <select v-model="draft.defaultModel" :disabled="busy" aria-label="默认模型">
                <option
                  v-for="model in draft.models"
                  :key="model.slug"
                  :value="model.slug.trim()"
                >
                  {{ model.displayName || model.slug }}
                </option>
              </select>
            </label>

            <p v-if="error" class="profile-manager__error" role="alert">{{ error }}</p>

            <div class="profile-manager__actions">
              <button
                type="submit"
                class="profile-manager__action profile-manager__action--primary"
                :disabled="busy"
              >
                保存
              </button>
              <button
                type="button"
                class="profile-manager__action profile-manager__action--key"
                :disabled="busy || !apiKey.trim() || !isExisting"
                @click="saveKey"
              >
                仅保存 Key 并使用
              </button>
              <button
                v-if="draft.builtIn"
                type="button"
                class="profile-manager__action"
                aria-label="恢复默认配置"
                :disabled="busy"
                @click="emit('delete', draft.id)"
              >
                <i class="ri-restart-line" aria-hidden="true"></i>
                恢复默认
              </button>
              <button
                v-if="!draft.builtIn && isExisting"
                type="button"
                class="profile-manager__action profile-manager__action--danger"
                :disabled="busy"
                @click="emit('delete', draft.id)"
              >
                删除
              </button>
              <button
                v-if="state?.activeProfileId !== draft.id"
                type="button"
                class="profile-manager__action"
                :disabled="busy || !isExisting"
                @click="emit('select', draft.id)"
              >
                设为当前
              </button>
            </div>
          </form>
          <p v-else class="profile-manager__empty">选择一个配置进行编辑，或新增配置。</p>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type {
  DesktopModelProfile,
  DesktopModelProfileState,
  DesktopModelProfileWireApi,
} from '@ecos-studio/shared'

const props = defineProps<{
  open: boolean
  state: DesktopModelProfileState | null
  busy?: boolean
  error?: string
}>()

const emit = defineEmits<{
  close: []
  select: [profileId: string]
  save: [profile: DesktopModelProfile, apiKey?: string]
  delete: [profileId: string]
  'set-api-key': [profileId: string, apiKey: string]
}>()

interface ProfileDraft {
  id: string
  name: string
  baseUrl: string
  wireApi: DesktopModelProfileWireApi
  envKey: string
  models: DesktopModelProfile['models']
  defaultModel: string
  builtIn: boolean
}

const draft = ref<ProfileDraft | null>(null)
const apiKey = ref('')
const inheritCodexConfig = ref(false)

const isExisting = computed(
  () =>
    draft.value !== null &&
    (props.state?.profiles.some((profile) => profile.id === draft.value?.id) ?? false),
)

watch(
  () => [props.open, props.state] as const,
  ([open, state]) => {
    if (!open) {
      draft.value = null
      apiKey.value = ''
      return
    }
    const selected =
      state?.profiles.find(
        (profile) => profile.id === (draft.value?.id ?? state.activeProfileId),
      ) ?? state?.profiles.find((profile) => profile.id === state.activeProfileId)
    if (selected) editProfile(selected)
  },
  { immediate: true },
)

watch(
  () => draft.value?.models.map((model) => model.slug.trim()) ?? [],
  (slugs) => {
    if (draft.value && !slugs.includes(draft.value.defaultModel)) {
      draft.value.defaultModel = slugs[0] ?? ''
    }
  },
)

function editProfile(profile: DesktopModelProfile): void {
  draft.value = {
    id: profile.id,
    name: profile.name,
    baseUrl: profile.baseUrl ?? '',
    wireApi: profile.wireApi,
    envKey: profile.envKey,
    models: profile.models.map((model) => ({ ...model })),
    defaultModel: profile.defaultModel,
    builtIn: profile.builtIn,
  }
  inheritCodexConfig.value = profile.id === 'codex' && profile.baseUrl === null
  apiKey.value = ''
}

function addProfile(): void {
  draft.value = {
    id: crypto.randomUUID(),
    name: '',
    baseUrl: '',
    wireApi: 'responses',
    envKey: 'ECOS_MODEL_API_KEY',
    models: [{ slug: '', displayName: '', contextWindow: 200_000 }],
    defaultModel: '',
    builtIn: false,
  }
  inheritCodexConfig.value = false
  apiKey.value = ''
}

function useManagedEndpoint(): void {
  if (inheritCodexConfig.value || !draft.value) return
  draft.value.baseUrl ||= 'https://api.openai.com/v1'
  if (!draft.value.models.length) {
    draft.value.models.push({ slug: '', displayName: '', contextWindow: 200_000 })
  }
}

function save(): void {
  const value = draft.value
  if (!value || props.busy) return
  emit(
    'save',
    {
      id: value.id,
      name: value.name.trim(),
      baseUrl: inheritCodexConfig.value ? null : value.baseUrl.trim(),
      wireApi: 'responses',
      envKey: inheritCodexConfig.value ? 'OPENAI_API_KEY' : value.envKey.trim(),
      models: inheritCodexConfig.value
        ? []
        : value.models.map((model) => ({
            slug: model.slug.trim(),
            displayName: model.displayName.trim(),
            contextWindow: model.contextWindow,
          })),
      defaultModel: inheritCodexConfig.value
        ? ''
        : value.defaultModel.trim() || value.models[0]?.slug.trim() || '',
      builtIn: value.builtIn,
    },
    apiKey.value.trim() || undefined,
  )
}

function saveKey(): void {
  const value = draft.value
  const key = apiKey.value.trim()
  if (!value || !key || props.busy || !isExisting.value) return
  emit('set-api-key', value.id, key)
}
</script>

<style scoped>
.profile-manager__backdrop {
  position: fixed;
  inset: 0;
  z-index: 1100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  background: color-mix(in srgb, var(--text-primary) 32%, transparent);
}

.profile-manager {
  display: flex;
  flex-direction: column;
  width: min(60rem, 100%);
  max-height: min(44rem, 100%);
  border: 1px solid var(--border-color);
  border-radius: 0.875rem;
  background: var(--bg-secondary);
  box-shadow: 0 1.5rem 3rem color-mix(in srgb, var(--text-primary) 24%, transparent);
}

.profile-manager__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--border-color);
}

.profile-manager__title {
  margin: 0;
  color: var(--text-primary);
  font-size: 0.875rem;
  font-weight: 600;
}

.profile-manager__close {
  border: 0;
  background: transparent;
  color: var(--text-secondary);
  font-size: 1rem;
  cursor: pointer;
}

.profile-manager__close:hover {
  color: var(--text-primary);
}

.profile-manager__body {
  display: grid;
  grid-template-columns: minmax(12rem, 14rem) minmax(0, 1fr);
  gap: 0.75rem;
  min-height: 0;
  padding: 0.75rem 1rem 1rem;
  overflow: auto;
}

.profile-manager__list {
  display: grid;
  gap: 0.25rem;
  align-content: start;
  margin: 0;
  padding: 0;
  list-style: none;
}

.profile-manager__item {
  display: grid;
  width: 100%;
  gap: 0.1rem;
  padding: 0.45rem 0.55rem;
  border: 1px solid var(--border-color);
  border-radius: 0.5rem;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 0.75rem;
  text-align: left;
  cursor: pointer;
}

.profile-manager__item--editing {
  border-color: color-mix(in srgb, var(--accent-color) 45%, var(--border-color));
  background: color-mix(in srgb, var(--accent-color) 10%, var(--bg-primary));
}

.profile-manager__item-name {
  font-weight: 600;
  line-height: 1.3;
}

.profile-manager__item-url {
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 0.6875rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.profile-manager__item-badges {
  display: flex;
  gap: 0.25rem;
  margin-top: 0.15rem;
}

.profile-manager__badge {
  padding: 0.05rem 0.35rem;
  border: 1px solid var(--border-color);
  border-radius: 999px;
  color: var(--text-secondary);
  font-size: 0.625rem;
  line-height: 1.3;
}

.profile-manager__badge--active {
  border-color: color-mix(in srgb, var(--accent-color) 45%, var(--border-color));
  color: var(--text-primary);
}

.profile-manager__item--add {
  place-items: center;
  color: var(--text-secondary);
}

.profile-manager__form {
  display: grid;
  gap: 0.55rem;
  align-content: start;
}

.profile-manager__field {
  display: grid;
  gap: 0.2rem;
  color: var(--text-secondary);
  font-size: 0.6875rem;
  font-weight: 500;
}

.profile-manager__toggle {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  color: var(--text-secondary);
  font-size: 0.75rem;
}

.profile-manager__advanced summary {
  color: var(--text-secondary);
  font-size: 0.6875rem;
  cursor: pointer;
}

.profile-manager__advanced .profile-manager__field {
  margin-top: 0.4rem;
}

.profile-manager__field input,
.profile-manager__field select,
.profile-manager__model-row input {
  width: 100%;
  padding: 0.4rem 0.55rem;
  border: 1px solid var(--border-color);
  border-radius: 0.5rem;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 0.75rem;
  line-height: 1.3;
}

.profile-manager__field input:focus,
.profile-manager__field select:focus,
.profile-manager__model-row input:focus {
  outline: none;
  border-color: color-mix(in srgb, var(--accent-color) 45%, var(--border-color));
}

.profile-manager__models {
  display: grid;
  gap: 0.35rem;
  margin: 0;
  padding: 0.5rem;
  border: 1px solid var(--border-color);
  border-radius: 0.5rem;
}

.profile-manager__models legend {
  padding: 0 0.25rem;
  color: var(--text-secondary);
  font-size: 0.6875rem;
  font-weight: 500;
}

.profile-manager__model-row {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr) 5.5rem 1.75rem;
  gap: 0.35rem;
}

.profile-manager__model-remove,
.profile-manager__model-add {
  border: 0;
  border-radius: 0.375rem;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.profile-manager__model-remove:hover:not(:disabled),
.profile-manager__model-add:hover {
  color: var(--text-primary);
  background: color-mix(in srgb, var(--bg-secondary) 75%, transparent);
}

.profile-manager__model-remove:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.profile-manager__model-add {
  justify-self: start;
  padding: 0.25rem 0.45rem;
  font-size: 0.6875rem;
}

.profile-manager__error {
  margin: 0;
  color: var(--danger-color);
  font-size: 0.6875rem;
  line-height: 1.4;
}

.profile-manager__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.profile-manager__action {
  min-height: 2rem;
  padding: 0.35rem 0.65rem;
  border: 1px solid var(--border-color);
  border-radius: 0.5rem;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 0.75rem;
  font-weight: 500;
  line-height: 1.3;
}

.profile-manager__action:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.profile-manager__item:disabled {
  cursor: wait;
}

.profile-manager__action--primary {
  border-color: color-mix(in srgb, var(--accent-color) 45%, var(--border-color));
  background: color-mix(in srgb, var(--accent-color) 12%, var(--bg-primary));
}

.profile-manager__action--danger {
  color: var(--danger-color);
}

.profile-manager__empty {
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.75rem;
}

@media (max-width: 640px) {
  .profile-manager__body {
    grid-template-columns: minmax(0, 1fr);
  }

  .profile-manager__model-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .profile-manager__model-remove {
    justify-self: end;
    width: 1.75rem;
  }
}
</style>
