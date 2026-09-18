import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { DesktopModelProfile } from '@ecos-studio/shared'

/**
 * Managed CODEX_HOME generation for model profiles.
 *
 * The codex CLI always reads model/provider configuration from
 * `$CODEX_HOME/config.toml`; ECOS points CODEX_HOME at a per-profile managed
 * directory when the user selects a profile with a custom base URL, so their
 * interactive codex setup stays untouched. Saved keys live in Studio settings,
 * not this config; they reach the codex process through the profile's env var (see
 * CodexDependencyService).
 */

export const BUILTIN_MODEL_PROFILES: DesktopModelProfile[] = [
  {
    id: 'codex',
    name: 'Codex（GPT）',
    baseUrl: null,
    wireApi: 'responses',
    envKey: 'OPENAI_API_KEY',
    models: [],
    defaultModel: '',
    builtIn: true,
  },
  {
    id: 'glm',
    name: 'GLM（智谱）',
    baseUrl: 'https://open.bigmodel.cn/api/v1',
    wireApi: 'responses',
    envKey: 'ZAI_API_KEY',
    models: [
      {
        slug: 'glm-5.3',
        displayName: 'GLM-5.3',
        contextWindow: 1_000_000,
      },
      {
        slug: 'glm-5.3-flash',
        displayName: 'GLM-5.3-Flash',
        contextWindow: 200_000,
      },
    ],
    defaultModel: 'glm-5.3-flash',
    builtIn: true,
  },
  {
    id: 'kimi',
    name: 'Kimi（月之暗面）',
    baseUrl: 'https://api.moonshot.cn/v1',
    wireApi: 'responses',
    envKey: 'MOONSHOT_API_KEY',
    models: [
      {
        slug: 'kimi-k3',
        displayName: 'Kimi K3',
        contextWindow: 1_000_000,
      },
      {
        slug: 'kimi-k2.7-code-highspeed',
        displayName: 'Kimi K2.7 Code Highspeed',
        contextWindow: 262_144,
      },
      {
        slug: 'kimi-k2.6',
        displayName: 'Kimi K2.6',
        contextWindow: 262_144,
      },
    ],
    defaultModel: 'kimi-k3',
    builtIn: true,
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    wireApi: 'responses',
    envKey: 'DEEPSEEK_API_KEY',
    models: [
      {
        slug: 'deepseek-flash',
        displayName: 'DeepSeek V4.1 Flash',
        contextWindow: 1_000_000,
      },
      {
        slug: 'deepseek-v4-pro',
        displayName: 'DeepSeek V4 Pro',
        contextWindow: 1_000_000,
      },
    ],
    defaultModel: 'deepseek-flash',
    builtIn: true,
  },
  {
    id: 'sub2api',
    name: 'Sub2API（测试）',
    baseUrl: 'https://api.wallvps.fun/v1',
    wireApi: 'responses',
    envKey: 'SUB2API_API_KEY',
    models: [
      {
        slug: 'kimi-for-coding',
        displayName: 'kimi-for-coding',
        // ponytail: conservative test window; use gateway metadata if a larger window is needed.
        contextWindow: 200_000,
      },
    ],
    defaultModel: 'kimi-for-coding',
    builtIn: true,
  },
]

interface CatalogModelEntry {
  slug: string
  display_name: string
  description: string
  default_reasoning_level: string
  supported_reasoning_levels: Array<{ effort: string; description: string }>
  shell_type: string
  visibility: string
  supported_in_api: boolean
  priority: number
  support_verbosity: boolean
  default_verbosity: null
  apply_patch_tool_type: null
  web_search_tool_type: string
  truncation_policy: { mode: string; limit: number }
  context_window: number
  max_context_window: number
  auto_compact_token_limit: null
  comp_hash: null
  experimental_supported_tools: string[]
  input_modalities: string[]
  upgrade: null
  availability_nux: null
  default_service_tier: null
  base_instructions: string
}

const BASE_INSTRUCTIONS =
  'You are Codex, a coding agent. You collaborate with the user in a shared ' +
  'workspace, read files, and answer precisely. Follow user instructions and ' +
  'project AGENTS.md guidance.'

function catalogEntry(
  model: DesktopModelProfile['models'][number],
  priority: number,
): CatalogModelEntry {
  return {
    slug: model.slug,
    display_name: model.displayName,
    description: model.displayName,
    default_reasoning_level: 'high',
    supported_reasoning_levels: [
      { effort: 'low', description: 'Fast responses with lighter reasoning' },
      { effort: 'medium', description: 'Balances speed and reasoning depth' },
      { effort: 'high', description: 'Greater reasoning depth for complex problems' },
      ...(priority === 0
        ? [
            {
              effort: 'max',
              description: 'Maximum reasoning depth for the hardest problems',
            },
          ]
        : []),
    ],
    shell_type: 'shell_command',
    visibility: 'list',
    supported_in_api: true,
    priority,
    support_verbosity: false,
    default_verbosity: null,
    apply_patch_tool_type: null,
    web_search_tool_type: 'text',
    truncation_policy: { mode: 'tokens', limit: Math.floor(model.contextWindow * 0.9) },
    context_window: model.contextWindow,
    max_context_window: model.contextWindow,
    auto_compact_token_limit: null,
    comp_hash: null,
    experimental_supported_tools: [],
    input_modalities: ['text'],
    upgrade: null,
    availability_nux: null,
    default_service_tier: null,
    base_instructions: BASE_INSTRUCTIONS,
  }
}

export function buildProfileModelsJson(profile: DesktopModelProfile): string {
  return JSON.stringify(
    {
      models: profile.models.map((model, index) => catalogEntry(model, index)),
    },
    null,
    2,
  )
}

function tomlString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export function buildProfileConfigToml(
  profile: DesktopModelProfile,
  configHome: string,
): string {
  const catalogPath = join(configHome, 'models.json')
  const providerKey =
    profile.id === 'sub2api'
      ? 'sub2api'
      : profile.id.toUpperCase().replace(/[^A-Z0-9_]/g, '_')
  return [
    `# Managed by ECOS Studio. Regenerated when the "${tomlString(profile.name)}" profile is selected.`,
    `model = "${tomlString(profile.defaultModel)}"`,
    `model_provider = "${providerKey}"`,
    'model_reasoning_effort = "high"',
    `model_catalog_json = "${tomlString(catalogPath)}"`,
    '',
    '# The ECOS Agent enforces a read-only sandbox and approvalPolicy=never per',
    '# turn; these process-level values stay as defence in depth.',
    'approval_policy = "never"',
    'sandbox_mode = "read-only"',
    '',
    `[model_providers.${providerKey}]`,
    `name = "${tomlString(profile.name)}"`,
    `base_url = "${tomlString(profile.baseUrl ?? '')}"`,
    `wire_api = "${profile.wireApi}"`,
    `env_key = "${profile.envKey}"`,
    'request_max_retries = 4',
    'stream_max_retries = 6',
    'stream_idle_timeout_ms = 120000',
    '',
  ].join('\n')
}

export async function writeProfileConfigHome(
  configHome: string,
  profile: DesktopModelProfile,
): Promise<void> {
  await mkdir(configHome, { recursive: true })
  await Promise.all([
    writeFile(
      join(configHome, 'config.toml'),
      buildProfileConfigToml(profile, configHome),
      'utf8',
    ),
    writeFile(join(configHome, 'models.json'), buildProfileModelsJson(profile), 'utf8'),
  ])
}
