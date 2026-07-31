import { access as fsAccess } from 'node:fs/promises'
import { execFile as execFileCallback } from 'node:child_process'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const execFilePromise = promisify(execFileCallback)
const guiRoot = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const REQUIRED_NATIVE_RESOURCES = ['ecc', 'chip-viewer-native']

function createCheck(name, status, message, detail) {
  return {
    detail,
    message,
    name,
    status,
  }
}

function readFirstLine(value) {
  return (
    String(value ?? '')
      .trim()
      .split(/\r?\n/)[0] ?? ''
  )
}

async function checkCommand(
  execFile,
  command,
  args,
  name,
  missingStatus,
  missingMessage,
) {
  try {
    const result = await execFile(command, args)
    const version = readFirstLine(result.stdout || result.stderr)
    return createCheck(name, 'ok', version || `${command} is available`)
  } catch (error) {
    return createCheck(name, missingStatus, missingMessage, error.message)
  }
}

async function checkPath(access, path, name, missingMessage) {
  try {
    await access(path)
    return createCheck(name, 'ok', path)
  } catch (error) {
    return createCheck(name, 'error', missingMessage, error.message)
  }
}

async function checkNativeResources(access, cwd) {
  const missing = []

  for (const binary of REQUIRED_NATIVE_RESOURCES) {
    const path = join(cwd, 'apps/desktop-electron/resources/binaries', binary)
    try {
      await access(path)
    } catch {
      missing.push(binary)
    }
  }

  if (missing.length > 0) {
    return createCheck(
      'native resources',
      'error',
      `Missing native resources: ${missing.join(', ')}`,
    )
  }

  return createCheck('native resources', 'ok', REQUIRED_NATIVE_RESOURCES.join(', '))
}

function summarizeChecks(checks) {
  const summaryKeyByStatus = {
    error: 'errors',
    ok: 'ok',
    warning: 'warnings',
  }

  return checks.reduce(
    (summary, check) => {
      summary[summaryKeyByStatus[check.status]] += 1
      return summary
    },
    { errors: 0, ok: 0, warnings: 0 },
  )
}

export async function runGuiDoctor(options = {}) {
  const access = options.access ?? fsAccess
  const cwd = options.cwd ?? guiRoot
  const execFile = options.execFile ?? execFilePromise
  const versions = options.versions ?? process.versions

  const checks = [
    createCheck('Node.js', 'ok', `Node.js ${versions.node}`),
    await checkCommand(
      execFile,
      'pnpm',
      ['--version'],
      'pnpm',
      'error',
      'pnpm is not available on PATH',
    ),
    await checkPath(
      access,
      join(cwd, 'node_modules/.modules.yaml'),
      'pnpm install',
      'pnpm dependencies are not installed; run pnpm install in ecos/gui',
    ),
    await checkCommand(
      execFile,
      'ecc',
      ['--version'],
      'ECC CLI',
      'warning',
      'ecc CLI is not available on PATH',
    ),
    await checkNativeResources(access, cwd),
    await checkCommand(
      execFile,
      'nix',
      ['--version'],
      'Nix',
      'warning',
      'nix is not available on PATH',
    ),
  ]

  return {
    checks,
    summary: summarizeChecks(checks),
  }
}

export function formatDoctorReport(report) {
  const symbolByStatus = {
    error: 'x',
    ok: 'ok',
    warning: 'warn',
  }

  const lines = ['ECOS GUI doctor']
  for (const check of report.checks) {
    lines.push(`[${symbolByStatus[check.status]}] ${check.name}: ${check.message}`)
    if (check.detail) {
      lines.push(`    ${check.detail}`)
    }
  }
  lines.push(
    `Summary: ${report.summary.ok} ok, ${report.summary.warnings} warnings, ${report.summary.errors} errors`,
  )

  return lines.join('\n')
}

const isCli = process.argv[1] === fileURLToPath(import.meta.url)

if (isCli) {
  runGuiDoctor()
    .then((report) => {
      console.log(formatDoctorReport(report))
      if (report.summary.errors > 0) {
        process.exitCode = 1
      }
    })
    .catch((error) => {
      console.error(error)
      process.exitCode = 1
    })
}
