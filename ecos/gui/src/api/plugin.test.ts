import { describe, expect, it } from 'vitest'

import { resourceJobToInstallProgress, resourceListToTools } from './plugin'

describe('Resource Manager tool API adapter', () => {
  it('maps Resource Manager tool resources to legacy tool rows', () => {
    const tools = resourceListToTools({
      diagnostics: [],
      resources: [
        {
          id: 'tool:yosys',
          type: 'tool',
          name: 'yosys',
          display_name: 'Yosys',
          description: 'RTL synthesis',
          category: 'synthesis',
          status: 'installed',
          installed_version: '0.61',
          available_versions: ['0.61'],
          active_version: '0.61',
          active: true,
          path: '/tmp/tools/yosys/0.61',
          platform: 'linux-x86_64',
          size: 123,
          source: 'registry',
          homepage: 'https://example.com',
          actions: ['uninstall'],
          health: {},
          error: null,
        },
        {
          id: 'pdk:ics55',
          type: 'pdk',
          name: 'ics55',
          display_name: 'ics55',
          description: '',
          category: 'pdk',
          status: 'installed',
          installed_version: null,
          available_versions: [],
          active_version: null,
          active: false,
          path: '/tmp/pdk',
          platform: null,
          size: null,
          source: 'local',
          homepage: '',
          actions: ['validate'],
          health: {},
          error: null,
        },
      ],
    })

    expect(tools).toEqual([
      {
        name: 'yosys',
        display_name: 'Yosys',
        description: 'RTL synthesis',
        category: 'synthesis',
        status: 'installed',
        installed_version: '0.61',
        available_versions: ['0.61'],
        install_path: '/tmp/tools/yosys/0.61',
      },
    ])
  })

  it('maps Resource Manager jobs to install progress rows', () => {
    expect(
      resourceJobToInstallProgress({
        id: 'job-1',
        resource_id: 'tool:yosys',
        action: 'install',
        phase: 'downloading',
        progress: 0.5,
        message: 'Downloading...',
        error: null,
      }),
    ).toEqual({
      tool: 'yosys',
      phase: 'downloading',
      progress: 0.5,
      message: 'Downloading...',
    })
  })
})
