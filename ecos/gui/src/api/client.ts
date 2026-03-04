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
 */
export async function checkApiHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(3000)
    })
    return response.ok
  } catch {
    return false
  }
}

export { API_BASE_URL, API_HOST, API_PORT }
