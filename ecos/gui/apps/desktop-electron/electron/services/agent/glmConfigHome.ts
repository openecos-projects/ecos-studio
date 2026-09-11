import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Managed CODEX_HOME for the GLM (Zhipu) model source.
 *
 * The codex CLI always reads model/provider configuration from
 * `$CODEX_HOME/config.toml`; ECOS points CODEX_HOME here when the user selects
 * the GLM source so their interactive codex setup stays untouched. The GLM
 * API key never touches disk — it reaches the codex process through the
 * ZAI_API_KEY environment variable (see CodexDependencyService).
 */

export const GLM_MODELS: Array<{
  slug: string
  displayName: string
  description: string
}> = [
  {
    slug: 'glm-5.3',
    displayName: 'GLM-5.3',
    description: 'Zhipu flagship agentic coding model.',
  },
  {
    slug: 'glm-5.3-flash',
    displayName: 'GLM-5.3-Flash',
    description: 'Fast and affordable GLM coding model.',
  },
]

const GLM_BASE_URL = 'https://open.bigmodel.cn/api/v1'

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
  model: (typeof GLM_MODELS)[number],
  priority: number,
  contextWindow: number,
): CatalogModelEntry {
  return {
    slug: model.slug,
    display_name: model.displayName,
    description: model.description,
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
    truncation_policy: { mode: 'tokens', limit: Math.floor(contextWindow * 0.9) },
    context_window: contextWindow,
    max_context_window: contextWindow,
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

export function buildGlmModelsJson(): string {
  return JSON.stringify(
    {
      models: [
        catalogEntry(GLM_MODELS[0], 0, 1_000_000),
        catalogEntry(GLM_MODELS[1], 1, 200_000),
      ],
    },
    null,
    2,
  )
}

export function buildGlmConfigToml(configHome: string): string {
  const catalogPath = join(configHome, 'models.json')
  return [
    '# Managed by ECOS Studio. Regenerated when the GLM model source is selected.',
    'model = "glm-5.3-flash"',
    'model_provider = "ZAI"',
    'model_reasoning_effort = "high"',
    `model_catalog_json = "${catalogPath}"`,
    '',
    '# The ECOS Agent enforces a read-only sandbox and approvalPolicy=never per',
    '# turn; these process-level values stay as defence in depth.',
    'approval_policy = "never"',
    'sandbox_mode = "read-only"',
    '',
    '[model_providers.ZAI]',
    'name = "ZAI"',
    `base_url = "${GLM_BASE_URL}"`,
    'wire_api = "responses"',
    'env_key = "ZAI_API_KEY"',
    'request_max_retries = 4',
    'stream_max_retries = 6',
    'stream_idle_timeout_ms = 120000',
    '',
  ].join('\n')
}

export async function writeGlmConfigHome(configHome: string): Promise<void> {
  await mkdir(configHome, { recursive: true })
  await Promise.all([
    writeFile(join(configHome, 'config.toml'), buildGlmConfigToml(configHome), 'utf8'),
    writeFile(join(configHome, 'models.json'), buildGlmModelsJson(), 'utf8'),
  ])
}
