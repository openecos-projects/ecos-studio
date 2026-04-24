/**
 * Alova HTTP client configuration for ChipCompiler API
 *
 * The API port is determined dynamically at runtime:
 * - In Tauri mode: queries the actual port from the Rust backend (which auto-discovers a free port)
 * - In browser-only mode: falls back to the default port (8765)
 */

import { createAlova } from 'alova'
import adapterFetch from 'alova/fetch'
import { isTauri } from '@/composables/useTauri'

// API server configuration
const API_HOST = '127.0.0.1'
const DEFAULT_API_PORT = 8765

// Mutable state — updated by initApiPort()
let API_PORT: number = DEFAULT_API_PORT
let API_BASE_URL: string = `http://${API_HOST}:${API_PORT}`

/**
 * Create (or recreate) the Alova instance with the current API_BASE_URL.
 */
function createAlovaClient() {
  return createAlova({
    baseURL: API_BASE_URL,
    requestAdapter: adapterFetch(),

    // Request interceptor
    beforeRequest(method) {
      method.config.headers = {
        ...method.config.headers,
        'Content-Type': 'application/json',
      }
    },

    // Response interceptor
    responded: {
      async onSuccess(response) {
        const json = await response.json()
        return json
      },
      onError(error) {
        console.error('API request failed:', error)
        throw error
      },
    },
  })
}

/**
 * Alova instance configured for ChipCompiler backend API.
 * Re-created by initApiPort() when the actual port is known.
 */
// eslint-disable-next-line import/no-mutable-exports
export let alovaInstance = createAlovaClient()

/**
 * Initialise the API port by querying the Tauri backend.
 *
 * Must be called once during application startup (before any API requests).
 * In non-Tauri environments (browser-only dev) this is a no-op that keeps the
 * default port.
 *
 * @returns The resolved API port number.
 */
export async function initApiPort(): Promise<number> {
  if (!isTauri()) {
    console.log(`[api] Not running in Tauri, using default port ${DEFAULT_API_PORT}`)
    return API_PORT
  }

  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const port = await invoke<number>('get_api_port')

    if (port && port !== API_PORT) {
      API_PORT = port
      API_BASE_URL = `http://${API_HOST}:${API_PORT}`
      // Recreate alova instance with the new base URL
      alovaInstance = createAlovaClient()
      console.log(`[api] API port initialised to ${API_PORT}`)
    } else {
      console.log(`[api] API port confirmed as ${API_PORT}`)
    }
  } catch (err) {
    console.warn(`[api] Failed to query API port from Tauri, using default ${DEFAULT_API_PORT}:`, err)
  }

  return API_PORT
}

/**
 * Check if the API server is available
 *
 * @param options.timeoutMs - Abort timeout for a single request (default 3000 ms).
 *   Shorter values are appropriate when polling in a loop.
 */
export async function checkApiHealth(options?: { timeoutMs?: number }): Promise<boolean> {
  const ms = options?.timeoutMs ?? 3000
  try {
    const response = await fetch(`${API_BASE_URL}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(ms)
    })
    return response.ok
  } catch {
    return false
  }
}

export interface WaitForApiReadyOptions {
  /** Total time to keep polling (default 90_000 ms) */
  timeoutMs?: number
  /** Delay between polls after a failed check (default 250 ms) */
  intervalMs?: number
  /** Per-attempt health request timeout (default 1500 ms) */
  healthTimeoutMs?: number
}

/**
 * Block until `/health` succeeds or the total timeout is exceeded.
 * Use before workspace/critical API calls so the GUI does not race the FastAPI child process.
 */
export async function waitForApiReady(options?: WaitForApiReadyOptions): Promise<void> {
  const timeoutMs = options?.timeoutMs ?? 180_000
  const intervalMs = options?.intervalMs ?? 250
  const healthTimeoutMs = options?.healthTimeoutMs ?? 1500
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    if (await checkApiHealth({ timeoutMs: healthTimeoutMs })) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }

  throw new Error(
    `API server did not respond on ${API_BASE_URL} within ${timeoutMs}ms`
  )
}

export { API_BASE_URL, API_HOST, API_PORT }
