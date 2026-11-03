import { execFileSync } from 'node:child_process'
import { copyFile, mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Page } from 'playwright-core'
import { launchE2EApp, resolveOutDir } from './support/launch'
import { waitToolchainReady } from './support/journey'

const runRealAgent = process.env.ECOS_E2E_REAL_AGENT === '1'

describe.runIf(runRealAgent)('product e2e: real Agent home options', () => {
  it('runs Quick Start through workspace creation and stops before the flow', async () => {
    const outDir = await resolveOutDir('agent-quick-start-before-flow')
    const launched = await launchAgentApp(outDir)
    try {
      await waitToolchainReady(launched.page)
      await installMpc(launched.page)
      await launched.page.getByRole('button', { name: 'ECOS Agent', exact: true }).click()
      await launched.page.getByRole('dialog', { name: 'ECOS Agent' }).waitFor()
      await clickChoice(
        launched.page,
        'Get started',
        'Quick Start: run the built-in GCD RTL-to-GDS example',
      )
      await launched.page.getByRole('button', { name: 'Stop Quick Start' }).waitFor({
        state: 'visible',
        timeout: 30_000,
      })
      const quickStartRoot = await launched.page.evaluate(async () => {
        const root = await window.ecosDesktop.app.getQuickStartRoot?.()
        if (!root) throw new Error('Quick Start root is unavailable.')
        return root
      })
      const workspace = await waitForQuickStartWorkspace(quickStartRoot, launched.page)
      await launched.page.getByRole('button', { name: 'Stop Quick Start' }).click()
      await expect
        .poll(() => launched.page.locator('body').innerText(), { timeout: 30_000 })
        .toContain('Quick Start 已停止。')
      const record = await readFile(
        join(workspace.workspacePath, 'quick_start_run.json'),
        'utf8',
      )
        .then((content) => JSON.parse(content) as { flow?: unknown; status?: string })
        .catch(() => null)
      // The E2E stops Quick Start as soon as the registered workspace exists,
      // before the optional flow phase. A receipt may not have been written yet.
      expect(record?.status).not.toBe('flow_running')
      expect(record?.flow).toBeUndefined()
      const manifest = JSON.parse(
        await readFile(join(workspace.projectRoot, 'project.json'), 'utf8'),
      ) as {
        project_id?: string
      }
      expect(manifest.project_id).toMatch(/^proj_/)
      await expect(
        readFile(join(workspace.projectRoot, 'rtl', 'gcd.v'), 'utf8'),
      ).resolves.toContain('module gcd')
      await expect(
        readFile(join(workspace.workspacePath, 'home', 'params.toml'), 'utf8'),
      ).resolves.toContain('[design]')
      await captureUi(launched.page, outDir, 'quick-start-stopped')
      expect.hasAssertions()
    } catch (error) {
      await captureFailure(launched.page, launched.logs, outDir, error)
      throw error
    } finally {
      await launched.close()
    }
  }, 300_000)

  it('shows optimization authorization for a completed workspace and cancels before execution', async () => {
    const outDir = await resolveOutDir('agent-optimize-before-execution')
    const workspace = join(outDir, 'work', 'completed-workspace')
    await createCompletedWorkspaceFixture(workspace)
    const launched = await launchAgentApp(outDir)
    try {
      await waitToolchainReady(launched.page)
      await launched.page.getByRole('button', { name: 'ECOS Agent', exact: true }).click()
      await launched.page.getByRole('dialog', { name: 'ECOS Agent' }).waitFor()
      await clickChoice(launched.page, 'Get started', 'Optimize a completed design')
      await expect
        .poll(() => launched.page.locator('body').innerText(), { timeout: 60_000 })
        .toContain('baseline workspace completed through Harden')
      await sendMessage(launched.page, workspace)
      await expect
        .poll(() => launched.page.locator('body').innerText(), { timeout: 60_000 })
        .toContain('Describe the optimization goal')
      await sendMessage(
        launched.page,
        'Reduce routed wirelength while preserving timing closure and signoff.',
      )
      await expect
        .poll(() => launched.page.locator('body').innerText(), { timeout: 180_000 })
        .toContain('Start a bounded, pausable, replayable optimization episode')
      await expect
        .poll(() => launched.page.locator('body').innerText(), { timeout: 30_000 })
        .toContain(workspace)
      await clickChoice(launched.page, 'Confirm execution', 'Cancel')
      await expect
        .poll(() => launched.page.locator('body').innerText(), { timeout: 30_000 })
        .toContain('Cancelled; no workspace was created and ECC was not executed.')
      await expect(readdir(join(workspace, '.agent', 'candidates'))).rejects.toThrow(
        /ENOENT/,
      )
      await captureUi(launched.page, outDir, 'optimization-cancelled')
      expect.hasAssertions()
    } catch (error) {
      await captureFailure(launched.page, launched.logs, outDir, error)
      throw error
    } finally {
      await launched.close()
    }
  }, 300_000)

  it('keeps the model settings menu visible in the narrow home Agent panel', async () => {
    const outDir = await resolveOutDir('agent-model-settings-narrow')
    const launched = await launchAgentApp(outDir)
    try {
      await waitToolchainReady(launched.page)
      await launched.page.getByRole('button', { name: 'ECOS Agent', exact: true }).click()
      await launched.page.getByRole('dialog', { name: 'ECOS Agent' }).waitFor()
      const trigger = launched.page.locator('.model-settings__trigger')
      await trigger.waitFor({ state: 'visible', timeout: 60_000 })
      await trigger.click()
      const popover = launched.page.locator('.model-settings__popover')
      await popover.waitFor({ state: 'visible' })

      const layout = await launched.page.evaluate(() => {
        const element = document.querySelector<HTMLElement>('.model-settings__popover')
        if (!element) throw new Error('Model settings popover is missing.')
        const rect = element.getBoundingClientRect()
        const point = document.elementFromPoint(rect.left + 16, rect.top + 24)
        return {
          insideClippedPanel: Boolean(element.closest('.agent-chat')),
          left: rect.left,
          right: rect.right,
          viewportWidth: window.innerWidth,
          visibleAtLeftEdge: element.contains(point),
          sourceOptionCount: element.querySelectorAll('.model-settings__source-option')
            .length,
        }
      })

      expect(layout.insideClippedPanel).toBe(false)
      expect(layout.left).toBeGreaterThanOrEqual(0)
      expect(layout.right).toBeLessThanOrEqual(layout.viewportWidth)
      expect(layout.visibleAtLeftEdge).toBe(true)
      expect(layout.sourceOptionCount).toBeGreaterThan(0)
      await captureUi(launched.page, outDir, 'model-settings-narrow')
      expect.hasAssertions()
    } catch (error) {
      await captureFailure(launched.page, launched.logs, outDir, error)
      throw error
    } finally {
      await launched.close()
    }
  }, 60_000)
})

async function launchAgentApp(outDir: string): Promise<{
  page: Page
  logs: string[]
  close: () => Promise<void>
}> {
  const codexBin = execFileSync('which', ['codex'], { encoding: 'utf8' }).trim()
  const hostSettings = join(
    process.env.XDG_CONFIG_HOME || join(homedir(), '.config'),
    '@ecos-studio',
    'desktop-electron',
    'settings.json',
  )
  const isolatedSettings = join(
    outDir,
    'xdg',
    'config',
    '@ecos-studio',
    'desktop-electron',
    'settings.json',
  )
  await mkdir(dirname(isolatedSettings), { recursive: true })
  await copyFile(hostSettings, isolatedSettings)
  const launched = await launchE2EApp(outDir, {
    adjustEnv: (env) => {
      env.CODEX_HOME = process.env.CODEX_HOME || join(homedir(), '.codex')
      env.ECOS_AGENT_CODEX_BIN = process.env.ECOS_AGENT_CODEX_BIN || codexBin
    },
  })
  const logs: string[] = []
  launched.app.process().stdout?.on('data', (chunk) => logs.push(String(chunk)))
  launched.app.process().stderr?.on('data', (chunk) => logs.push(String(chunk)))
  launched.page.on('console', (message) =>
    logs.push(`[renderer:${message.type()}] ${message.text()}\n`),
  )
  return {
    page: launched.page,
    logs,
    close: async () => {
      await launched.close()
      await unlink(isolatedSettings).catch(() => undefined)
    },
  }
}

async function installMpc(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await window.ecosDesktop.resources.install({
      resourceId: 'mpc:mpc-frame',
      version: '0.1.0',
    })
  })
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const response = await window.ecosDesktop.resources.list()
          return response.resources.some(
            (resource) =>
              resource.id === 'mpc:mpc-frame' &&
              resource.status === 'installed' &&
              resource.health.managed === true &&
              resource.health.status === 'ok',
          )
        }),
      { timeout: 120_000 },
    )
    .toBe(true)
}

async function waitForQuickStartWorkspace(
  root: string,
  page: Page,
): Promise<{
  projectRoot: string
  workspacePath: string
}> {
  const deadline = Date.now() + 180_000
  let nextUiCheck = 0
  while (Date.now() < deadline) {
    const workspace = await findQuickStartWorkspace(root)
    if (workspace) return workspace
    if (Date.now() >= nextUiCheck) {
      const ui = await page.locator('body').innerText()
      const failedStep = ui.match(/Quick Start step ([^\n]+) failed: ([^\n]+)/)
      if (failedStep) {
        throw new Error(`Quick Start ${failedStep[1]} failed: ${failedStep[2]}`)
      }
      nextUiCheck = Date.now() + 500
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('Quick Start did not create a workspace before the timeout.')
}

async function findQuickStartWorkspace(root: string): Promise<{
  projectRoot: string
  workspacePath: string
} | null> {
  let projects
  try {
    projects = await readdir(root, { withFileTypes: true })
  } catch {
    return null
  }
  for (const project of projects) {
    if (!project.isDirectory()) continue
    const projectRoot = join(root, project.name)
    let manifest: { project_id?: string }
    try {
      manifest = JSON.parse(
        await readFile(join(projectRoot, 'project.json'), 'utf8'),
      ) as { project_id?: string }
    } catch {
      continue
    }
    if (!manifest.project_id) continue
    let entries
    try {
      entries = await readdir(projectRoot, { withFileTypes: true })
    } catch {
      continue
    }
    for (const workspace of entries) {
      if (!workspace.isDirectory()) continue
      const workspacePath = join(projectRoot, workspace.name)
      try {
        await readFile(join(workspacePath, 'home', 'params.toml'), 'utf8')
        return { projectRoot, workspacePath }
      } catch {
        // Wait until the workspace contents are readable and stop Quick Start
        // before it can register the workspace and advance to the flow phase.
      }
    }
  }
  return null
}

async function createCompletedWorkspaceFixture(root: string): Promise<void> {
  const writeJson = async (relativePath: string, value: unknown) => {
    const path = join(root, relativePath)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, JSON.stringify(value), 'utf8')
  }
  const metrics = (...items: Array<[string, number]>) => ({
    status: 'success',
    metrics: items.map(([id, value]) => ({ id, value })),
  })
  const checklist = (...items: Array<[string, string]>) => ({
    status: 'ready',
    checklist: items.map(([id, state]) => ({ id, state })),
  })

  await writeJson('home/flow.json', {
    steps: [
      'Synthesis',
      'preFloorplan',
      'macroPlacement',
      'postFloorplan',
      'place',
      'CTS',
      'legalization',
      'Timing optimization',
      'route',
      'drc',
      'lvs',
      'filler',
      'RCX',
      'sta',
      'Harden',
    ].map((name) => ({ name, state: 'Success' })),
  })
  await writeJson('home/parameters.json', {
    Design: 'tiny',
    'Target density': 0.2,
    'Cell padding x': 300,
    'Routability opt flag': 1,
  })
  await writeJson(
    'Synthesis_yosys/analysis/qor_metrics.json',
    metrics(
      ['synthesis_cell_area', 1200],
      ['runtime_seconds', 0.5],
      ['peak_memory_mb', 80],
    ),
  )
  await writeJson(
    'postFloorplan_ecc/analysis/qor_metrics.json',
    metrics(
      ['die_area', 3000],
      ['core_area', 2500],
      ['runtime_seconds', 0.75],
      ['peak_memory_mb', 90],
    ),
  )
  await writeJson(
    'place_dreamplace/analysis/qor_metrics.json',
    metrics(
      ['place_hpwl', 4315],
      ['place_grwl', 3812],
      ['place_lutrudy_utilization_max', 0.88],
      ['place_rudy_utilization_max', 0.55],
      ['place_congestion_egr_overflow_max', 0],
      ['place_congestion_egr_overflow_total', 0],
      ['core_utilization', 0.52],
      ['place_total_wirelength', 123],
      ['runtime_seconds', 1],
      ['peak_memory_mb', 100],
    ),
  )
  await writeJson('CTS_ecc/feature/CTS.step.json', {
    CTS: {
      total_clock_wirelength: 950,
      clock_path_max_buffer: 4,
      clock_path_min_buffer: 4,
    },
  })
  await writeJson(
    'CTS_ecc/analysis/qor_metrics.json',
    metrics(['runtime_seconds', 2], ['peak_memory_mb', 200]),
  )
  await writeJson(
    'legalization_dreamplace/analysis/qor_metrics.json',
    metrics(['runtime_seconds', 3], ['peak_memory_mb', 0]),
  )
  await writeJson(
    'timing_optimization_sizer/analysis/qor_metrics.json',
    metrics(['runtime_seconds', 3.5], ['peak_memory_mb', 0]),
  )
  await writeJson(
    'route_ecc/analysis/qor_metrics.json',
    metrics(
      ['route_dr_total_violation_count', 0],
      ['route_dr_total_wirelength', 9999],
      ['route_la_total_overflow', 1],
      ['route_wirelength', 5243.741],
      ['route_via_count', 1705],
      ['route_dr_total_patch_count', 126],
      ['runtime_seconds', 4],
      ['peak_memory_mb', 300],
    ),
  )
  await writeJson(
    'drc_ecc/analysis/qor_metrics.json',
    metrics(['drc_count', 0], ['runtime_seconds', 5], ['peak_memory_mb', 100]),
  )
  await writeJson(
    'lvs_ecc/analysis/qor_metrics.json',
    metrics(['lvs_count', 0], ['runtime_seconds', 6], ['peak_memory_mb', 150]),
  )
  await writeJson(
    'filler_ecc/analysis/qor_metrics.json',
    metrics(['runtime_seconds', 7], ['peak_memory_mb', 0]),
  )
  await writeJson(
    'RCX_ecc/analysis/qor_metrics.json',
    metrics(
      ['rcx_expected_corner_count', 3],
      ['rcx_spef_file_count', 3],
      ['rcx_missing_corner_count', 0],
      ['rcx_spef_parse_failure_count', 0],
      ['runtime_seconds', 8],
      ['peak_memory_mb', 400],
    ),
  )
  await writeJson(
    'sta_ecc/analysis/qor_metrics.json',
    metrics(
      ['sta_setup_violation_count', 0],
      ['sta_hold_violation_count', 0],
      ['sta_setup_wns', 0.2],
      ['sta_setup_tns', 0],
      ['sta_hold_wns', 0.1],
      ['sta_hold_tns', 0],
      ['sta_corner_count', 3],
      ['sta_expected_corner_count', 3],
      ['sta_missing_corner_count', 0],
      ['runtime_seconds', 9],
      ['peak_memory_mb', 500],
    ),
  )
  await writeJson(
    'Harden_ecc/analysis/qor_metrics.json',
    metrics(
      ['harden_artifact_missing_count', 0],
      ['runtime_seconds', 10],
      ['peak_memory_mb', 250],
    ),
  )

  const corners: Record<string, [number, number, number, number, number]> = {
    'MAX_125/Cworst': [6.8, 0.2, 313, 105.2, 80],
    'ML_125/RCworst': [8.9, 0.1, 964, 103.3, 89.1],
    'TYP_25/TYPICAL': [8.5, 0.14, 672, 66.8, 0.267],
  }
  for (const [
    corner,
    [setupWns, holdWns, frequency, dynamicUw, leakageUw],
  ] of Object.entries(corners)) {
    const featureRoot = `sta_ecc/feature/${corner}`
    await writeJson(`${featureRoot}/qor_summary.json`, {
      summary: {
        setup: { wns: setupWns, tns: 0, nvp: 0, frequency_mhz: frequency },
        hold: { wns: holdWns, tns: 0, nvp: 0 },
      },
      design_statistics: { cella: 1140 },
    })
    await writeJson(`${featureRoot}/power_summary.json`, {
      schema_version: 1,
      internal_uw: dynamicUw - 10,
      switching_uw: 10,
      dynamic_uw: dynamicUw,
      leakage_uw: leakageUw,
    })
  }
  const configuredCorners = Object.keys(corners).sort()
  await writeJson('sta_ecc/feature/sta.step.json', {
    sta: {
      expected_corner_count: configuredCorners.length,
      loaded_corners: configuredCorners,
      signoff_metrics: {
        corners: configuredCorners.map((staCorner) => ({ sta_corner: staCorner })),
      },
    },
  })
  await writeJson('drc_ecc/checklist.json', checklist(['quality.drc.clean', 'pass']))
  await writeJson('lvs_ecc/checklist.json', checklist(['quality.lvs.clean', 'pass']))
  await writeJson(
    'filler_ecc/checklist.json',
    checklist(['quality.filler.complete', 'pass']),
  )
  await writeJson(
    'RCX_ecc/checklist.json',
    checklist(
      ['quality.rcx.corner_coverage', 'pass'],
      ['quality.rcx.spef_parse_health', 'pass'],
    ),
  )
  await writeJson(
    'sta_ecc/checklist.json',
    checklist(['quality.sta.setup_closed', 'pass'], ['quality.sta.hold_closed', 'pass']),
  )
  await writeJson(
    'Harden_ecc/checklist.json',
    checklist(['quality.mpc.minimum_area', 'pass'], ['quality.mpc.maximum_area', 'pass']),
  )
  for (const suffix of ['gds', 'lef', 'lib']) {
    const output = join(root, 'Harden_ecc', 'output', `tiny_Harden.${suffix}`)
    await mkdir(dirname(output), { recursive: true })
    await writeFile(output, suffix, 'utf8')
  }
  await writeGeometrySnapshot(root)
}

async function writeGeometrySnapshot(root: string): Promise<void> {
  const geometryRoot = join(root, 'filler_ecc', 'output', 'geometry')
  const headerSize = 56
  const shapeRecordSize = 56
  const ownerRecordSize = 40
  const geometryHeader = (kind: number, recordSize: number, count: number) => {
    const header = Buffer.alloc(headerSize)
    header.writeBigUInt64LE(0x454347454f4d3031n, 0)
    header.writeUInt32LE(1, 8)
    header.writeUInt32LE(headerSize, 12)
    header.writeUInt16LE(kind, 16)
    header.writeUInt16LE(0, 18)
    header.writeUInt32LE(recordSize, 20)
    header.writeBigUInt64LE(BigInt(count), 24)
    header.writeBigUInt64LE(BigInt(recordSize * count), 32)
    return header
  }
  const shapes = [
    [0, 0, 1000, 1000],
    [100, 100, 900, 900],
  ].map((bbox, index) => {
    const shape = Buffer.alloc(shapeRecordSize)
    shape.writeBigUInt64LE(BigInt(index + 1), 0)
    shape.writeUInt32LE(1, 8)
    shape.writeUInt16LE(0, 12)
    shape.writeUInt8(3, 14)
    shape.writeUInt8(1, 15)
    shape.writeUInt16LE(0, 16)
    shape.writeUInt32LE(index, 20)
    shape.writeBigUInt64LE(0n, 24)
    shape.writeUInt32LE(0, 32)
    shape.writeUInt32LE(0, 36)
    bbox.forEach((value, valueIndex) => shape.writeInt32LE(value!, 40 + valueIndex * 4))
    return shape
  })
  const owners = [1, 2].map((ownerType) => {
    const owner = Buffer.alloc(ownerRecordSize)
    owner.writeUInt8(ownerType, 0)
    return owner
  })
  await mkdir(geometryRoot, { recursive: true })
  await Promise.all([
    writeFile(
      join(geometryRoot, 'shapes.bin'),
      Buffer.concat([geometryHeader(2, shapeRecordSize, shapes.length), ...shapes]),
    ),
    writeFile(
      join(geometryRoot, 'owners.bin'),
      Buffer.concat([geometryHeader(4, ownerRecordSize, owners.length), ...owners]),
    ),
    writeFile(
      join(geometryRoot, 'geometry.manifest'),
      [
        'schema_version=1',
        'dbu_per_micron=1000',
        'shape_count=2',
        'owner_count=2',
        'shapes=shapes.bin',
        'owners=owners.bin',
        '',
      ].join('\n'),
      'utf8',
    ),
  ])
}

async function captureUi(page: Page, outDir: string, stage: string): Promise<void> {
  await writeFile(join(outDir, `${stage}-ui.txt`), await page.locator('body').innerText())
  await page.screenshot({ path: join(outDir, `${stage}.png`), fullPage: true })
}

async function captureFailure(
  page: Page,
  logs: string[],
  outDir: string,
  error: unknown,
): Promise<void> {
  await Promise.all([
    writeFile(join(outDir, 'failure-ui.txt'), await page.locator('body').innerText()),
    writeFile(join(outDir, 'failure-app.log'), logs.join('')),
    page.screenshot({ path: join(outDir, 'failure.png'), fullPage: true }),
  ]).catch(() => undefined)
  if (error instanceof Error) {
    await writeFile(
      join(outDir, 'failure-error.txt'),
      `${error.stack ?? error.message}\n`,
    )
  }
}

async function clickChoice(page: Page, title: string, label: string): Promise<void> {
  const dock = await openInteraction(page, title)
  const button = dock.getByRole('button', {
    name: new RegExp(`^\\d+\\s+${escapeRegExp(label)}$`),
  })
  await button.waitFor({ state: 'visible', timeout: 60_000 })
  await button.click()
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function sendMessage(page: Page, message: string): Promise<void> {
  const input = page.getByRole('textbox', { name: 'Message', exact: true })
  await expect.poll(() => input.isEnabled(), { timeout: 60_000 }).toBe(true)
  await input.fill(message)
  await page.getByRole('button', { name: 'Send message', exact: true }).click()
  await expect.poll(() => input.inputValue()).toBe('')
}

async function openInteraction(page: Page, title: string) {
  const dock = page.locator('details.interaction-dock')
  await dock.waitFor({ state: 'attached', timeout: 60_000 })
  const summary = dock.locator('summary')
  await expect.poll(() => summary.locator('strong').innerText()).toBe(title)
  if (!(await dock.evaluate((element) => (element as HTMLDetailsElement).open))) {
    await summary.click()
  }
  await dock.evaluate((element) => {
    ;(element as HTMLDetailsElement).open = true
  })
  await expect
    .poll(() => dock.evaluate((element) => (element as HTMLDetailsElement).open))
    .toBe(true)
  return dock
}
