import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  findLegacyWorkspaceReference,
  hasLegacyRunsLayout,
  projectNeedsCliMigration,
  readLegacyProjectManifest,
} from './legacyMigration'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  )
})

describe('hasLegacyRunsLayout', () => {
  it('detects real workspace directories under runs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ecc-legacy-layout-'))
    roots.push(root)
    await mkdir(join(root, 'runs', 'workspace'), { recursive: true })

    await expect(hasLegacyRunsLayout(root)).resolves.toBe(true)
  })

  it('ignores transaction locks and hidden entries', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ecc-legacy-layout-'))
    roots.push(root)
    await mkdir(join(root, 'runs'))
    await writeFile(join(root, 'runs', 'workspace.lock'), '')
    await mkdir(join(root, 'runs', '.staging'))

    await expect(hasLegacyRunsLayout(root)).resolves.toBe(false)
  })

  it('preserves a stable manifest workspace id when the directory name differs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ecc-legacy-layout-'))
    roots.push(root)
    const workspace = join(root, 'runs', 'exp1')
    await mkdir(workspace, { recursive: true })
    await writeFile(
      join(root, 'project.json'),
      JSON.stringify({
        schema_version: 1,
        workspaces: [{ workspace_id: 'stable-baseline', workspace_path: 'runs/exp1' }],
      }),
    )

    await expect(findLegacyWorkspaceReference(workspace)).resolves.toEqual({
      projectRoot: root,
      workspaceId: 'stable-baseline',
    })
  })

  it('discovers a no-manifest legacy workspace by its directory name', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ecc-legacy-layout-'))
    roots.push(root)
    const workspace = join(root, 'runs', 'exp1')
    await mkdir(workspace, { recursive: true })

    await expect(findLegacyWorkspaceReference(workspace)).resolves.toEqual({
      projectRoot: root,
      workspaceId: 'exp1',
    })
  })

  it('projects legacy flow state without writing a compatibility manifest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ecc-legacy-layout-'))
    roots.push(root)
    const workspace = join(root, 'runs', 'exp1')
    await mkdir(join(workspace, 'home'), { recursive: true })
    await writeFile(
      join(workspace, 'home', 'flow.json'),
      JSON.stringify({ steps: [{ name: 'Synth', state: 'Ongoing' }] }),
    )

    const manifest = await readLegacyProjectManifest(root, 'migration failed')
    expect(manifest).toMatchObject({
      root_path: root,
      project_migration: { status: 'legacy-readonly', reason: 'migration failed' },
      workspaces: [
        { workspace_id: 'exp1', status: 'running', workspace_path: workspace },
      ],
    })
  })

  it('does not read flow state through a runs symlink that escapes the project', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ecc-legacy-layout-'))
    const outside = await mkdtemp(join(tmpdir(), 'ecc-legacy-outside-'))
    roots.push(root, outside)
    await mkdir(join(outside, 'exp1', 'home'), { recursive: true })
    await writeFile(
      join(outside, 'exp1', 'home', 'flow.json'),
      JSON.stringify({ steps: [{ name: 'Synth', state: 'Ongoing' }] }),
    )
    await symlink(outside, join(root, 'runs'))
    await writeFile(
      join(root, 'project.json'),
      JSON.stringify({
        schema_version: 1,
        workspaces: [{ workspace_id: 'exp1', workspace_path: 'runs/exp1' }],
      }),
    )

    const manifest = await readLegacyProjectManifest(root, 'unsafe runs layout')
    expect(manifest?.workspaces[0]?.status).toBe('not_started')
  })

  it('drops workspace entries whose path escapes the project root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ecc-legacy-layout-'))
    const outside = await mkdtemp(join(tmpdir(), 'ecc-legacy-outside-'))
    roots.push(root, outside)
    await writeFile(
      join(root, 'project.json'),
      JSON.stringify({
        schema_version: 1,
        workspaces: [{ workspace_id: 'outside', workspace_path: outside }],
      }),
    )

    const manifest = await readLegacyProjectManifest(root, 'unsafe workspace path')
    expect(manifest?.workspaces).toEqual([])
  })
})

describe('projectNeedsCliMigration', () => {
  it('detects a manifest project whose ecc.toml is missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ecc-config-migration-'))
    roots.push(root)
    await writeFile(join(root, 'project.json'), JSON.stringify({ schema_version: 1 }))

    await expect(projectNeedsCliMigration(root)).resolves.toBe(true)
  })

  it('detects missing required project identity fields', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ecc-config-migration-'))
    roots.push(root)
    await writeFile(join(root, 'project.json'), JSON.stringify({ schema_version: 1 }))
    await writeFile(join(root, 'ecc.toml'), '[design]\ntop = "gcd"\n')

    await expect(projectNeedsCliMigration(root)).resolves.toBe(true)
  })

  it('delegates malformed TOML to the fail-closed CLI migration check', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ecc-config-migration-'))
    roots.push(root)
    await writeFile(join(root, 'project.json'), JSON.stringify({ schema_version: 1 }))
    await writeFile(join(root, 'ecc.toml'), '[design\nname = "broken"\n')

    await expect(projectNeedsCliMigration(root)).resolves.toBe(true)
  })

  it('delegates a symlinked config to the fail-closed CLI migration check', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ecc-config-migration-'))
    roots.push(root)
    const outside = await mkdtemp(join(tmpdir(), 'ecc-config-outside-'))
    roots.push(outside)
    await writeFile(join(root, 'project.json'), JSON.stringify({ schema_version: 1 }))
    await writeFile(join(outside, 'ecc.toml'), '[design]\nname = "gcd"\n')
    await symlink(join(outside, 'ecc.toml'), join(root, 'ecc.toml'))

    await expect(projectNeedsCliMigration(root)).resolves.toBe(true)
  })

  it('skips a complete fresh-project config with an unbound PDK root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ecc-config-migration-'))
    roots.push(root)
    await writeFile(join(root, 'project.json'), JSON.stringify({ schema_version: 1 }))
    await writeFile(
      join(root, 'ecc.toml'),
      '[design]\nname = "gcd"\ntop = "gcd"\nclock_port = "clk"\nfrequency_mhz = 100\n' +
        '\n[pdk]\nname = "ics55"\nroot = ""\n\n[flow]\npreset = "rtl2gds"\n',
    )

    await expect(projectNeedsCliMigration(root)).resolves.toBe(false)
  })
})
