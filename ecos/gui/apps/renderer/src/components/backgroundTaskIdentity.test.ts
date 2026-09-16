import { describe, expect, it } from 'vitest'
import {
  backgroundTaskIdentityLabel,
  ownerFromWorkspacePath,
} from './backgroundTaskIdentity'

describe('backgroundTaskIdentityLabel', () => {
  it('pairs a default workspace name with its owning design directory', () => {
    expect(
      backgroundTaskIdentityLabel({
        workspacePath: '/home/ekko/Desktop/ECOS/templates/minirv/ws_0001',
      }),
    ).toBe('minirv / ws_0001')
  })

  it('uses an explicit design owner when the folder name is generic', () => {
    expect(
      backgroundTaskIdentityLabel({
        owner: 'picorv32',
        projectRoot: '/projects/cpu',
        workspacePath: '/projects/cpu/ws_0001',
      }),
    ).toBe('picorv32 / ws_0001')
  })

  it('does not repeat the workspace name when it already matches the design', () => {
    expect(
      backgroundTaskIdentityLabel({
        owner: 'minirv',
        workspacePath: '/designs/minirv',
      }),
    ).toBe('minirv')
  })

  it('skips the ECC runs/ container when inferring the owner', () => {
    expect(ownerFromWorkspacePath('/projects/gcd/runs/ws_0036')).toBe('gcd')
    expect(
      backgroundTaskIdentityLabel({
        workspacePath: '/projects/gcd/runs/ws_0036/',
      }),
    ).toBe('gcd / ws_0036')
  })

  it('keeps a standalone workspace name when there is no owner', () => {
    expect(backgroundTaskIdentityLabel({ workspacePath: 'ws_0001' })).toBe('ws_0001')
  })
})
