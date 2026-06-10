import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { Readable } from 'node:stream'

const SURFER_SCHEME = 'ecos-surfer'
const SURFER_APP_BASE = 'https://app.surfer-project.org'
const SURFER_FETCH_TIMEOUT_MS = 8000
const SURFER_ALLOWED_ASSETS = new Map([
  ['integration.js', 'application/javascript; charset=utf-8'],
  ['manifest.json', 'application/json; charset=utf-8'],
  ['surfer.js', 'application/javascript; charset=utf-8'],
  ['surfer_bg.wasm', 'application/wasm'],
  ['sw.js', 'application/javascript; charset=utf-8'],
])
const WAVEFORM_EXTENSIONS = new Set(['.fst', '.ghw', '.vcd'])

interface ProjectScopeProvider {
  requestProjectPathAccess(path: string): Promise<string>
}

interface ProtocolRegistrar {
  handle(scheme: string, handler: (request: Request) => Promise<Response>): void
  registerSchemesAsPrivileged?(
    schemes: Array<{
      privileges: {
        bypassCSP?: boolean
        corsEnabled?: boolean
        secure?: boolean
        standard?: boolean
        stream?: boolean
        supportFetchAPI?: boolean
      }
      scheme: string
    }>,
  ): void
}

export interface SurferProtocolServiceOptions {
  projectScopeProvider: ProjectScopeProvider
}

let schemesRegistered = false

export function registerSurferProtocolSchemes(protocol: ProtocolRegistrar): void {
  if (schemesRegistered) return
  protocol.registerSchemesAsPrivileged?.([
    {
      scheme: SURFER_SCHEME,
      privileges: {
        corsEnabled: true,
        secure: true,
        standard: true,
        stream: true,
        supportFetchAPI: true,
      },
    },
  ])
  schemesRegistered = true
}

export class SurferProtocolService {
  private readonly projectScopeProvider: ProjectScopeProvider
  private readonly assetCache = new Map<string, Buffer>()
  private registered = false

  constructor(options: SurferProtocolServiceOptions) {
    this.projectScopeProvider = options.projectScopeProvider
  }

  register(protocol: ProtocolRegistrar): void {
    if (this.registered) return
    protocol.handle(SURFER_SCHEME, async (request) => await this.handleRequest(request))
    this.registered = true
  }

  private async handleRequest(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url)
      const pathname = decodeURIComponent(url.pathname.replace(/^\/+/, ''))

      if (!pathname || pathname === 'index.html') {
        return this.response(await this.buildSurferHtml(), 'text/html; charset=utf-8')
      }

      if (pathname.startsWith('waveform/')) {
        return await this.waveformResponse(request, url)
      }

      const assetType = SURFER_ALLOWED_ASSETS.get(pathname)
      if (!assetType) {
        return this.textResponse(`Unknown Surfer asset: ${pathname}`, 404)
      }

      return this.response(await this.fetchSurferAsset(pathname), assetType)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return this.textResponse(message, 502)
    }
  }

  private async buildSurferHtml(): Promise<Buffer> {
    const htmlCacheKey = '__surfer_html__'
    const cached = this.assetCache.get(htmlCacheKey)
    if (cached) return cached

    let text = (await this.fetchSurferAsset('')).toString('utf8')
    const integrationScript = (await this.fetchSurferAsset('integration.js')).toString('utf8')
    const setupHooks = `
      try {
        ${integrationScript}
        register_message_listener();
        window.__surfer_host_api = {
          postMessage: (message) => window.parent.postMessage({
            source: 'ecos-surfer',
            command: 'SurferHostMessage',
            message,
          }, '*'),
        };
        window.setTimeout(() => {
          window.parent.postMessage({ source: 'ecos-surfer', command: 'SurferReady' }, '*');
        }, 0);
      } catch (err) {
        window.parent.postMessage({
          source: 'ecos-surfer',
          command: 'SurferError',
          message: err && err.message ? err.message : String(err),
        }, '*');
        throw err;
      }
    `

    if (text.includes('/*SURFER_SETUP_HOOKS*/')) {
      text = text.replace('/*SURFER_SETUP_HOOKS*/', setupHooks)
    } else {
      text = text.replace('</body>', `<script>${setupHooks}</script></body>`)
    }
    text = text.replace(
      "navigator.serviceWorker.register('sw.js');",
      "console.debug('Surfer service worker disabled inside ECOS Studio');",
    )

    const body = Buffer.from(text, 'utf8')
    this.assetCache.set(htmlCacheKey, body)
    return body
  }

  private async fetchSurferAsset(asset: string): Promise<Buffer> {
    const key = asset || '__index__'
    const cached = this.assetCache.get(key)
    if (cached) return cached

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), SURFER_FETCH_TIMEOUT_MS)
    try {
      const url = `${SURFER_APP_BASE}/${asset}`
      const response = await fetch(url, { signal: controller.signal })
      if (!response.ok) {
        throw new Error(`failed to fetch Surfer asset ${asset || 'index'}: ${response.status}`)
      }
      const body = Buffer.from(await response.arrayBuffer())
      this.assetCache.set(key, body)
      return body
    } finally {
      clearTimeout(timer)
    }
  }

  private async waveformResponse(request: Request, url: URL): Promise<Response> {
    const requestedPath = url.searchParams.get('path') || ''
    const canonicalPath = await this.resolveWaveformFile(requestedPath)
    const fileStats = await stat(canonicalPath)
    const headers = this.headers('application/octet-stream')
    headers.set('Content-Length', String(fileStats.size))
    headers.set('Content-Disposition', `inline; filename="${basename(canonicalPath).replace(/"/g, '')}"`)

    if (request.method.toUpperCase() === 'HEAD') {
      return new Response(null, { headers })
    }

    const body = Readable.toWeb(createReadStream(canonicalPath)) as ReadableStream
    return new Response(body, { headers })
  }

  private async resolveWaveformFile(path: string): Promise<string> {
    const canonicalPath = await this.projectScopeProvider.requestProjectPathAccess(path)
    const extension = extname(canonicalPath).toLowerCase()
    if (!WAVEFORM_EXTENSIONS.has(extension)) {
      throw new Error(`unsupported waveform file type: ${extension || '(none)'}`)
    }
    const fileStats = await stat(canonicalPath)
    if (!fileStats.isFile()) {
      throw new Error(`waveform path is not a file: ${canonicalPath}`)
    }
    return canonicalPath
  }

  private response(body: Buffer | string, contentType: string): Response {
    return new Response(body, {
      headers: this.headers(contentType),
    })
  }

  private textResponse(message: string, status: number): Response {
    return new Response(message, {
      headers: this.headers('text/plain; charset=utf-8'),
      status,
    })
  }

  private headers(contentType: string): Headers {
    return new Headers({
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=600',
      'Content-Type': contentType,
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'same-origin',
    })
  }
}

export function surferViewerUrl(): string {
  return `${SURFER_SCHEME}://viewer/`
}

export function surferWaveformUrl(path: string): string {
  const name = encodeURIComponent(basename(path))
  return `${SURFER_SCHEME}://viewer/waveform/${name}?path=${encodeURIComponent(path)}`
}
