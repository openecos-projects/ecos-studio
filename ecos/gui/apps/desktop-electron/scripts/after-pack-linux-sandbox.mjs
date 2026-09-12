import { chmod, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'

const execFileAsync = promisify(execFile)

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

# Disable the sandbox via the environment, not a prepended --no-sandbox
# switch: an injected switch would shift user arguments and break argv-based
# dispatch such as the --cli pass-through.
ELECTRON_DISABLE_SANDBOX=1
export ELECTRON_DISABLE_SANDBOX
exec "$BINARY" "$@"
`
}

export async function validatePackagedAgent(appOutDir) {
  const agentDirectory = join(appOutDir, 'resources', 'agent')
  const agentPath = join(agentDirectory, 'ecos-agent')
  const manifestPath = join(agentDirectory, 'agent-provider.json')
  try {
    const agent = await stat(agentPath)
    if (!agent.isFile() || (agent.mode & 0o111) === 0) {
      throw new Error('not an executable file')
    }
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    if (
      manifest.command !== './ecos-agent' ||
      manifest.providerId !== 'ecos_agent' ||
      manifest.protocolVersion !== 1
    ) {
      throw new Error('agent manifest does not match the bundled provider')
    }
    await execFileAsync(agentPath, ['--version'], { timeout: 10_000 })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Packaged ECOS Agent validation failed at ${agentDirectory}: ${reason}`,
    )
  }
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
  } catch {
    // Continue when the wrapper has not been applied yet.
    await rename(executablePath, wrappedBinaryPath)
    await writeFile(executablePath, createLinuxSandboxWrapper(wrappedBinaryName), 'utf8')
    await chmod(executablePath, 0o755)
  }

  // ECC is deliberately not packaged (slim build): it is acquired from the
  // registry on first run, so only the bundled Agent is validated here.
  await validatePackagedAgent(context.appOutDir)
}
