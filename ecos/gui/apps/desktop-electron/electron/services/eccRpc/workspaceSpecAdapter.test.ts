import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { EccWorkspaceCreateRequest } from '@ecos-studio/shared'

import { workspaceSpecCreatePayload } from './workspaceSpecAdapter'

describe('workspaceSpecCreatePayload', () => {
  it('matches the shared ECC and CLI WorkspaceSpec fixture', async () => {
    const root = resolve(
      import.meta.dirname,
      '../../../../../../../ecc/test/fixtures/workspace_spec_v1',
    )
    const fixture = JSON.parse(await readFile(resolve(root, 'valid.json'), 'utf8')) as {
      studioDraft: EccWorkspaceCreateRequest
      workspaceBindings: Record<string, unknown>
      workspaceSpec: Record<string, unknown>
    }
    const draft = {
      ...fixture.studioDraft,
      directory: resolve(root, fixture.studioDraft.directory),
      originVerilog: resolve(root, fixture.studioDraft.originVerilog ?? ''),
      pdkRoot: resolve(root, fixture.studioDraft.pdkRoot ?? ''),
    }

    expect(workspaceSpecCreatePayload(draft)).toEqual({
      commandId: fixture.studioDraft.commandId,
      targetDirectory: draft.directory,
      workspaceBindings: {
        inputs: { 'rtl-main': resolve(root, 'input/gcd.v') },
        pdk: { root: resolve(root, 'pdk') },
      },
      workspaceSpec: fixture.workspaceSpec,
    })
  })

  it('rejects the shared invalid Studio fixture', async () => {
    const root = resolve(
      import.meta.dirname,
      '../../../../../../../ecc/test/fixtures/workspace_spec_v1',
    )
    const fixture = JSON.parse(await readFile(resolve(root, 'invalid.json'), 'utf8')) as {
      expectedStudioError: string
      studioDraft: EccWorkspaceCreateRequest
    }

    expect(() => workspaceSpecCreatePayload(fixture.studioDraft)).toThrow(
      fixture.expectedStudioError,
    )
  })

  it('maps the legacy Studio draft to portable WorkspaceSpec and local bindings', () => {
    const payload = workspaceSpecCreatePayload({
      commandId: 'workspace-create-1',
      designInputMode: 'rtl',
      directory: '/project/ws-1',
      flowConfig: {
        end_step: 'Harden',
        start_step: 'Synthesis',
        steps: ['Synthesis', 'Floorplan', 'Harden'],
      },
      parameters: {
        clock: 'clk',
        core_utilization: 0.6,
        description: 'product-only',
        design: 'gcd',
        frequency_max: 200,
        top_module: 'gcd',
      },
      pdk: 'ics55',
      pdkConfigMode: 'manual',
      pdkConfig: {
        cell_lef: ['/pdk/cells.lef'],
        liberty: ['/pdk/typ.lib'],
        tech_lef: ['/pdk/tech.lef'],
      },
      pdkRoot: '/pdk',
      pdkVersion: '1.10.100',
      rtlList: ['/project/rtl/gcd.v'],
      sdc: '/project/gcd.sdc',
    })

    expect(payload).toEqual({
      commandId: 'workspace-create-1',
      targetDirectory: '/project/ws-1',
      workspaceBindings: {
        inputs: {
          'rtl-1': '/project/rtl/gcd.v',
          sdc: '/project/gcd.sdc',
        },
        pdk: {
          files: {
            'lef-1': '/pdk/cells.lef',
            'liberty-1': '/pdk/typ.lib',
            tech: '/pdk/tech.lef',
          },
          root: '/pdk',
          version: '1.10.100',
        },
      },
      workspaceSpec: {
        design: { clockPort: 'clk', name: 'gcd', topModule: 'gcd' },
        flow: {
          flowId: 'harden',
          fromStepId: 'Synthesis',
          throughStepId: 'Harden',
        },
        inputMode: 'rtl',
        inputs: [
          { inputId: 'rtl-1', role: 'rtl' },
          { inputId: 'sdc', role: 'sdc' },
        ],
        parameters: {
          'design.frequency_mhz': 200,
          'floorplan.core_util': 0.6,
        },
        pdk: {
          familyId: 'ics55',
          files: [
            { fileId: 'tech', role: 'tech' },
            { fileId: 'lef-1', role: 'lef' },
            { fileId: 'liberty-1', role: 'liberty' },
          ],
          mode: 'manual',
          version: '1.10.100',
        },
        schemaVersion: 1,
      },
    })
  })

  it('rejects a legacy engineering field that cannot be mapped losslessly', () => {
    expect(() =>
      workspaceSpecCreatePayload({
        commandId: 'workspace-create-invalid-parameter',
        directory: '/project/ws-1',
        parameters: { design: 'gcd', mystery_knob: 3, top_module: 'gcd' },
        pdk: 'ics55',
        pdkRoot: '/pdk',
        rtlList: ['/project/gcd.v'],
      }),
    ).toThrow('unsupported_legacy_field: parameters.mystery_knob')
  })

  it('maps a legacy inline PDK config instead of silently dropping it', () => {
    const payload = workspaceSpecCreatePayload({
      commandId: 'workspace-create-inline-pdk',
      directory: '/project/ws-1',
      parameters: { design: 'gcd', top_module: 'gcd' },
      pdkJson: {
        name: 'custom55',
        root: '/pdk',
        tech: '/pdk/tech.lef',
        lefs: ['/pdk/cells.lef'],
        libs: ['/pdk/typ.lib'],
        mapping_file: '/pdk/cells.map',
      },
      rtlList: ['/project/gcd.v'],
    }) as {
      workspaceBindings: { pdk: Record<string, unknown> }
      workspaceSpec: { pdk: Record<string, unknown> }
    }

    expect(payload.workspaceSpec.pdk).toMatchObject({
      familyId: 'custom55',
      mode: 'manual',
      files: expect.arrayContaining([{ fileId: 'mapping', role: 'mapping' }]),
    })
    expect(payload.workspaceBindings.pdk).toMatchObject({
      root: '/pdk',
      files: expect.objectContaining({ mapping: '/pdk/cells.map' }),
    })
  })
})
