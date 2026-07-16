#!/usr/bin/env node
import { spawn as spawnCallback } from 'node:child_process'
import { stat as statCallback } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const defaultGuiRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const defaultRepoRoot = resolve(defaultGuiRoot, '../..')
const supportedExtensions = new Set([
  '.cjs',
  '.css',
  '.html',
  '.js',
  '.json',
  '.jsonc',
  '.md',
  '.mjs',
  '.ts',
  '.tsx',
  '.vue',
  '.yaml',
  '.yml',
])

function hasSupportedExtension(path) {
  return [...supportedExtensions].some((extension) => path.endsWith(extension))
}

function isInside(parent, child) {
  const relativePath = relative(parent, child)
  return (
    relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))
  )
}

async function isExistingFile(path, stat) {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

function dedupe(paths) {
  return [...new Set(paths)]
}

function resolveStagedPath(stagedFile, { guiRoot, repoRoot }) {
  if (isAbsolute(stagedFile)) {
    return resolve(stagedFile)
  }

  const repoRelativePath = resolve(repoRoot, stagedFile)
  if (isInside(guiRoot, repoRelativePath)) {
    return repoRelativePath
  }

  return resolve(guiRoot, stagedFile)
}

export async function collectFormatTargets(stagedFiles, options = {}) {
  const guiRoot = options.guiRoot ?? defaultGuiRoot
  const repoRoot = options.repoRoot ?? defaultRepoRoot
  const stat = options.stat ?? statCallback
  const targets = new Set()

  for (const stagedFile of dedupe(stagedFiles)) {
    if (!stagedFile || !hasSupportedExtension(stagedFile)) {
      continue
    }

    const absolutePath = resolveStagedPath(stagedFile, { guiRoot, repoRoot })

    if (!isInside(guiRoot, absolutePath) || !(await isExistingFile(absolutePath, stat))) {
      continue
    }

    targets.add(relative(guiRoot, absolutePath).split(sep).join('/'))
  }

  return [...targets]
}

function spawn(command, args, options) {
  return new Promise((resolveExitCode) => {
    const child = spawnCallback(command, args, options)

    child.on('error', () => {
      resolveExitCode(1)
    })
    child.on('close', (code) => {
      resolveExitCode(code ?? 1)
    })
  })
}

export async function runStagedFormatter(stagedFiles, options = {}) {
  const guiRoot = options.guiRoot ?? defaultGuiRoot
  const log = options.log ?? console.log
  const runCommand = options.spawn ?? spawn
  const targets = await collectFormatTargets(stagedFiles, {
    guiRoot,
    repoRoot: options.repoRoot ?? defaultRepoRoot,
    stat: options.stat ?? statCallback,
  })

  if (targets.length === 0) {
    log('No staged GUI files need oxfmt.')
    return 0
  }

  return runCommand('oxfmt', ['--check', ...targets], {
    cwd: guiRoot,
    stdio: 'inherit',
  })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await runStagedFormatter(process.argv.slice(2))
}
