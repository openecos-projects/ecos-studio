/** Test double for the ECC process; resource-manager tests exercise lifecycle, not parsing. */
import { access } from 'node:fs/promises'
import { join } from 'node:path'
import type { PdkConfigureRequest } from '@ecos-studio/shared'

export async function fixturePdkConfiguration(
  request: PdkConfigureRequest,
): Promise<Record<string, unknown>> {
  if (request.action === 'resolve') return { content_digest: 'a'.repeat(64) }
  const root = request.root ?? ''
  const entries = [
    ['tech', 'prtech/techLEF/N551P6M_ecos.lef'],
    ...['HVT', 'LVT', 'SVT'].flatMap((vt) => [
      ['lef', `IP/STD_cell/ICsprout55_SC9T_BASIC_${vt}/lef/ICsprout55_9T${vt}_basic.lef`],
      [
        'liberty',
        `IP/STD_cell/ICsprout55_SC9T_BASIC_${vt}/liberty/ICsprout55_9T${vt}_ss_v1p08_125c_basic_nldm.lib`,
      ],
    ]),
  ]
  const resources = Object.fromEntries(
    entries.map(([role, path], index) => [index, { role, path: join(root, path!) }]),
  )
  if (request.action === 'show') return { resolved_resources: resources }
  const missing = await Promise.all(
    entries.map(async ([, path]) => {
      try {
        await access(join(root, path!))
        return null
      } catch {
        return { code: 'resource_missing', resource: path }
      }
    }),
  )
  return { diagnostics: missing.filter(Boolean) }
}
