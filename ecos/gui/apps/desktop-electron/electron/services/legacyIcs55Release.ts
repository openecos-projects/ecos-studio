import { lstat, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

// Early registry archives predate ECC's VERSION marker. Only adapt a staged,
// checksum-verified download; an imported directory belongs to the user.
export async function prepareLegacyIcs55Release(
  root: string,
  version: string,
): Promise<void> {
  const missing = (error: NodeJS.ErrnoException): null => {
    if (error.code !== 'ENOENT') throw error
    return null
  }
  const marker = join(root, 'VERSION')
  if (await lstat(marker).catch(missing)) return
  const descriptor = await readFile(join(root, 'ecc-pdk.json'), 'utf8').catch(missing)
  if (descriptor === null) return
  const legacy = JSON.parse(descriptor)
  const major = /^v([12])(?:[.-]|$)/.exec(legacy?.release)?.[1]
  if (legacy?.family_id !== 'ics55' || !major || !version.startsWith(`${major}.`)) {
    throw new Error(`Legacy ICS55 PDK release does not match registry version ${version}`)
  }
  await writeFile(marker, `ics55-v${major}\n`, { flag: 'wx' })
}
