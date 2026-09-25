import { describe, expect, it } from 'vitest'
import {
  SNAPSHOT_IDENTITY_MISMATCH,
  SNAPSHOT_REBUILD_REQUIRED,
} from '@ecos-studio/shared'

import { EccRuntimeServiceError, normalizeRuntimeError } from './errors'
import { EccJsonRpcError, EccJsonRpcTimeoutError } from './jsonRpcClient'

describe('normalizeRuntimeError', () => {
  it('keeps the stable ECC wire code for snapshot open-policy failures', () => {
    // Mirrors the ECC `workspace.open` wire contract (ADR-0009): error.message
    // carries the stable code, error.data.message the human explanation.
    const rebuildRequired = normalizeRuntimeError(
      new EccJsonRpcError(-32000, SNAPSHOT_REBUILD_REQUIRED, {
        message: 'invalid Engineering Snapshot: /ws/home/engineering-snapshot.json',
      }),
      { method: 'workspace.open' },
    )

    expect(rebuildRequired).toBeInstanceOf(EccRuntimeServiceError)
    expect(rebuildRequired.code).toBe(SNAPSHOT_REBUILD_REQUIRED)
    expect(rebuildRequired.message).toBe(
      'invalid Engineering Snapshot: /ws/home/engineering-snapshot.json',
    )

    const identityMismatch = normalizeRuntimeError(
      new EccJsonRpcError(-32000, SNAPSHOT_IDENTITY_MISMATCH, {
        message: 'Engineering Snapshot workspace identity mismatch',
      }),
      { method: 'workspace.open' },
    )
    expect(identityMismatch.code).toBe(SNAPSHOT_IDENTITY_MISMATCH)
  })

  it('preserves the derived-config conflict code from the RPC error', () => {
    const error = normalizeRuntimeError(
      new EccJsonRpcError(-32021, 'derived config files changed', {
        files: ['config/sta.json'],
      }),
    )

    expect(error.code).toBe('derived_configs_modified')
    expect(error.message).toBe('derived config files changed')
  })

  it('keeps the existing mapping for named JSON-RPC codes', () => {
    expect(
      normalizeRuntimeError(new EccJsonRpcError(-32602, 'invalid_request')).code,
    ).toBe('invalid_request')
    expect(
      normalizeRuntimeError(new EccJsonRpcError(-32010, 'workspace_session_not_found'))
        .code,
    ).toBe('workspace_session_not_found')
    expect(
      normalizeRuntimeError(new EccJsonRpcError(-32020, 'command_failed')).code,
    ).toBe('command_failed')
  })

  it('falls back to the numeric code for non-stable wire messages', () => {
    expect(
      normalizeRuntimeError(new EccJsonRpcError(-32601, 'Method not found')).code,
    ).toBe('json_rpc_-32601')
    expect(
      normalizeRuntimeError(new EccJsonRpcError(-32000, 'Sidecar exploded')).code,
    ).toBe('json_rpc_-32000')
  })

  it('maps timeouts and plain errors as before', () => {
    expect(
      normalizeRuntimeError(new EccJsonRpcTimeoutError('workspace.open', 1000)).code,
    ).toBe('request_timeout')
    expect(normalizeRuntimeError(new Error('boom')).code).toBe('runtime_error')
    expect(normalizeRuntimeError('boom').message).toBe('boom')
  })
})
