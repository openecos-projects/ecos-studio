import { readFile } from 'node:fs/promises'

export async function parseDesignFiles(
  rtlPath: string,
  sdcPath?: string,
): Promise<{ clock?: string; topModule?: string }> {
  const result: { clock?: string; topModule?: string } = {}
  try {
    const source = (await readFile(rtlPath, 'utf8')).slice(0, 2 * 1024 * 1024)
    const modules = [...source.matchAll(/\bmodule\s+([A-Za-z_][A-Za-z0-9_$]*)\b/g)].map(
      (match) => match[1]!,
    )
    const instantiated = new Set(
      modules.filter((name) =>
        new RegExp(
          `\\b${escapeRegExp(name)}\\b\\s+(?:#\\s*\\([^;]*?\\)\\s*)?[A-Za-z_][A-Za-z0-9_$]*\\s*\\(`,
        ).test(source),
      ),
    )
    const topModules = modules.filter((name) => !instantiated.has(name))
    result.topModule =
      topModules.length === 1
        ? topModules[0]
        : topModules.find((name) => /(?:^|_)top$/i.test(name))
  } catch {
    // A stale or unreadable candidate is still useful as a path recommendation.
  }
  if (sdcPath) {
    try {
      const source = (await readFile(sdcPath, 'utf8')).slice(0, 512 * 1024)
      result.clock =
        /\bcreate_clock\b[^\n;]*\bget_ports\s+(?:\{)?([A-Za-z_][A-Za-z0-9_$]*)/.exec(
          source,
        )?.[1]
    } catch {
      // Keep the candidate without inferred clock metadata.
    }
  }
  return result
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
