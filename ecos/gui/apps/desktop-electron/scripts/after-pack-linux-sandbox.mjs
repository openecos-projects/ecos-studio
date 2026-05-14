import { chmod, rename, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export function createLinuxSandboxWrapper(binaryName) {
  return `#!/bin/sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
HELPER="$SCRIPT_DIR/chrome-sandbox"
BINARY="$SCRIPT_DIR/${binaryName}"

if [ -r "$HELPER" ]; then
  helper_uid="$(stat -c '%u' "$HELPER" 2>/dev/null || printf '')"
  helper_mode="$(stat -c '%a' "$HELPER" 2>/dev/null || printf '')"
  if [ "$helper_uid" = "0" ] && [ "$helper_mode" = "4755" ]; then
    exec "$BINARY" "$@"
  fi
fi

exec "$BINARY" --no-sandbox "$@"
`
}

function resolveExecutableName(packager) {
  if (typeof packager.executableName === 'string' && packager.executableName.length > 0) {
    return packager.executableName
  }

  return packager.appInfo.productFilename
}

export default async function afterPackLinuxSandbox(context) {
  if (context.electronPlatformName !== 'linux') {
    return
  }

  const executableName = resolveExecutableName(context.packager)
  const executablePath = join(context.appOutDir, executableName)
  const wrappedBinaryName = `${executableName}-bin`
  const wrappedBinaryPath = join(context.appOutDir, wrappedBinaryName)

  try {
    await stat(wrappedBinaryPath)
    return
  } catch {
    // Continue when the wrapper has not been applied yet.
  }

  await rename(executablePath, wrappedBinaryPath)
  await writeFile(executablePath, createLinuxSandboxWrapper(wrappedBinaryName), 'utf8')
  await chmod(executablePath, 0o755)
}
