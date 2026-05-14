import { resolveProjectFileAbsolutePath } from '@ecos-studio/shared'
import { isTauri } from '@/composables/useTauri'
import { getDesktopApi } from '@/platform/desktop'

/** 与 `runLayoutTileGeneration` 使用同一解析规则，供 single-flight 键与调用方复用 */
export async function resolveLayoutJsonAbsolutePath(
  projectPath: string,
  layoutJsonRelative: string,
): Promise<string> {
  return resolveProjectFileAbsolutePath(projectPath, layoutJsonRelative)
}

/** 逻辑任务键：同键并发应合并为 single-flight（路径已解析为绝对路径） */
export function buildLayoutTileJobKey(
  projectPath: string,
  stepKey: string,
  layoutJsonAbsolute: string,
): string {
  return `${projectPath}\0${stepKey}\0${layoutJsonAbsolute}`
}

/** 从 get_info layout 的 info 对象中取出布局 JSON 相对路径 */
export function pickLayoutJsonPath(info: unknown): string | null {
  if (!info || typeof info !== 'object') return null
  const o = info as Record<string, unknown>
  for (const k of ['json', 'info', 'infoJson', 'layoutJson']) {
    const v = o[k]
    if (typeof v === 'string' && v.trim().length) return v.trim()
  }
  return null
}

/** 从 get_info(layout) 的 info 中取出 DRC JSON 相对路径（可选） */
export function pickDrcJsonPath(info: unknown): string | null {
  if (!info || typeof info !== 'object') return null
  const o = info as Record<string, unknown>
  for (const k of ['drcJson', 'drcStep', 'drc_step', 'drc']) {
    const v = o[k]
    if (typeof v === 'string' && v.trim().length) return v.trim()
  }
  return null
}

/**
 * 默认 DRC 路径（无 get_info 显式字段时使用）：
 * - 布局在 `…/output/` 下时，约定 DRC 在同级 `…/feature/drc.step.json`（与输出目录分离）。
 * - 否则与布局 JSON 同目录，例如 `feature/foo.json` → `feature/drc.step.json`。
 */
export function deriveDrcStepPathFromLayoutJsonRelative(layoutJsonRelative: string): string | null {
  const t = layoutJsonRelative.trim()
  if (!t) return null
  const lastSlash = Math.max(t.lastIndexOf('/'), t.lastIndexOf('\\'))
  let parent = lastSlash >= 0 ? t.slice(0, lastSlash + 1) : ''
  if (/\/output\/$/i.test(parent) || /^output\/$/i.test(parent)) {
    parent = parent
      .replace(/\/output\/$/i, '/feature/')
      .replace(/^output\/$/i, 'feature/')
  }
  return parent + 'drc.step.json'
}

/** 通过桌面桥接请求主进程生成/复用布局瓦片包，并返回 TileManager 需要的 bundle 根信息。 */
export async function runLayoutTileGeneration(params: {
  projectPath: string
  layoutJsonRelative: string
  /** 与路由阶段一致，用于 `.ecos/tile-cache/layout/<stepKey>/` */
  stepKey: string
}): Promise<{ baseUrl: string; outDir: string; fromCache: boolean }> {
  if (!isTauri()) {
    throw new Error('瓦片生成仅可在 ECOS Studio 桌面应用中使用。')
  }

  return await getDesktopApi().tiles.generate(params)
}

export async function getLayoutTileGenerationStatus(params: {
  projectPath: string
  layoutJsonRelative: string
  /** 与路由阶段一致，用于 `.ecos/tile-cache/layout/<stepKey>/` */
  stepKey: string
}): Promise<{ baseUrl: string; outDir: string; fromCache: boolean }> {
  if (!isTauri()) {
    throw new Error('瓦片生成仅可在 ECOS Studio 桌面应用中使用。')
  }

  return await getDesktopApi().tiles.getStatus(params)
}
