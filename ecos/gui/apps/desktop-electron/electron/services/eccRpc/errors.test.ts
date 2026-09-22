import { describe, expect, it } from 'vitest'

import { EccJsonRpcError } from './jsonRpcClient'
import { normalizeRuntimeError } from './errors'

describe('ECC runtime errors', () => {
  it('preserves the derived-config conflict code from the RPC error', () => {
    const error = normalizeRuntimeError(
      new EccJsonRpcError(-32021, 'derived config files changed', {
        files: ['config/sta.json'],
      }),
    )

    expect(error.code).toBe('derived_configs_modified')
    expect(error.message).toBe('derived config files changed')
  })
})
