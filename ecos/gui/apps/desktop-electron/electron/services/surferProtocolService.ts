import { createReadStream } from 'node:fs'
import { access, readFile, stat } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { basename, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'

const SURFER_SCHEME = 'ecos-surfer'
const SURFER_ALLOWED_ASSETS = new Map([
  ['integration.js', 'application/javascript; charset=utf-8'],
  ['manifest.json', 'application/json; charset=utf-8'],
  ['surfer.js', 'application/javascript; charset=utf-8'],
  ['surfer_bg.wasm', 'application/wasm'],
  ['sw.js', 'application/javascript; charset=utf-8'],
])
const WAVEFORM_EXTENSIONS = new Set(['.fst', '.ghw', '.vcd'])
const WAVEFORM_GRANT_TTL_MS = 5 * 60 * 1000
const MAX_WAVEFORM_GRANTS = 256

interface ProjectScopeProvider {
  requestProjectPathAccess(path: string): Promise<string>
}

type SurferAssetsPathProvider = () => Promise<string | null | undefined>

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
  appPath?: string
  env?: NodeJS.ProcessEnv
  isPackaged?: boolean
  projectScopeProvider: ProjectScopeProvider
  resourcesPath?: string
  surferAssetsPath?: string
  surferAssetsPathProvider?: SurferAssetsPathProvider
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
  private readonly surferAssetsPath: string
  private readonly surferAssetsPathProvider?: SurferAssetsPathProvider
  private readonly assetCache = new Map<string, Buffer>()
  private readonly waveformGrants = new Map<
    string,
    { canonicalPath: string; expiresAt: number }
  >()
  private registered = false

  constructor(options: SurferProtocolServiceOptions) {
    this.projectScopeProvider = options.projectScopeProvider
    this.surferAssetsPath = options.surferAssetsPath ?? resolveSurferAssetsPath(options)
    this.surferAssetsPathProvider = options.surferAssetsPathProvider
  }

  register(protocol: ProtocolRegistrar): void {
    if (this.registered) return
    protocol.handle(SURFER_SCHEME, async (request) => await this.handleRequest(request))
    this.registered = true
  }

  async authorizeWaveform(path: string): Promise<string> {
    const canonicalPath = await this.resolveWaveformFile(path)
    this.pruneWaveformGrants()
    const token = randomUUID()
    this.waveformGrants.set(token, {
      canonicalPath,
      expiresAt: Date.now() + WAVEFORM_GRANT_TTL_MS,
    })
    return surferWaveformUrl(canonicalPath, token)
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

      return this.response(await this.readSurferAsset(pathname), assetType)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return this.textResponse(message, 502)
    }
  }

  private async buildSurferHtml(): Promise<Buffer> {
    const assetsPath = await this.currentSurferAssetsPath()
    const htmlCacheKey = `${assetsPath}:__surfer_html__`
    const cached = this.assetCache.get(htmlCacheKey)
    if (cached) return cached

    let text = (await this.readSurferAssetFrom(assetsPath, 'index.html')).toString('utf8')
    const integrationScript = (
      await this.readSurferAssetFrom(assetsPath, 'integration.js')
    ).toString('utf8')
    const setupHooks = `
      (() => {
        const postHostMessage = (command, fields = {}) => {
          window.parent.postMessage({
            source: 'ecos-surfer',
            command,
            ...fields,
          }, '*');
        };
        const postError = (err) => {
          postHostMessage('SurferError', {
            message: err && err.message ? err.message : String(err),
          });
        };

        window.__surfer_host_api = {
          postMessage: (message) => postHostMessage('SurferHostMessage', { message }),
        };

        try {
          ${integrationScript}

          let readySent = false;
          const postReadyIfAvailable = (force = false) => {
            if (typeof window.inject_message === 'function') {
              if (force || !readySent) {
                readySent = true;
                postHostMessage('SurferReady');
              }
              return true;
            }
            return false;
          };
          const waitForSurferApi = (attempt = 0, forceNotify = false) => {
            if (postReadyIfAvailable(forceNotify)) return;
            if (attempt >= 400) {
              postError(new Error('Surfer waveform viewer API did not become ready.'));
              return;
            }
            window.setTimeout(() => waitForSurferApi(attempt + 1, forceNotify), 25);
          };
          const injectWhenReady = (message, attempt = 0) => {
            if (typeof window.inject_message === 'function') {
              window.inject_message(message);
              return;
            }
            if (attempt >= 400) {
              postError(new Error('Surfer waveform viewer API did not become ready for host command.'));
              return;
            }
            window.setTimeout(() => injectWhenReady(message, attempt + 1), 25);
          };
          const surferModulePromise = import('./surfer.js');
          const loadWaveformUrl = (url) => {
            injectWhenReady(JSON.stringify({
              LoadWaveformFileFromUrl: [
                url,
                {
                  keep_unavailable: false,
                  keep_variables: false,
                },
              ],
            }));
          };
          const waitForWaveformLoaded = async (decoded, attempt = 0) => {
            try {
              const surferModule = await surferModulePromise;
              if (await surferModule.waves_loaded()) {
                const initialScope = String(decoded.initialScope || '').trim();
                if (initialScope) {
                  const scope = { strs: [initialScope] };
                  injectWhenReady(JSON.stringify({ SetActiveScope: scope }));
                  injectWhenReady(JSON.stringify({ AddScope: scope }));
                }
                postHostMessage('SurferWaveformLoaded', {
                  loadId: decoded.loadId || '',
                  name: decoded.name || '',
                });
                return;
              }
              if (attempt >= 600) {
                throw new Error('Surfer did not finish loading the waveform.');
              }
              window.setTimeout(() => {
                void waitForWaveformLoaded(decoded, attempt + 1);
              }, 25);
            } catch (err) {
              postHostMessage('SurferError', {
                loadId: decoded.loadId || '',
                message: err && err.message ? err.message : String(err),
              });
            }
          };
          window.addEventListener('message', (event) => {
            try {
              const decoded = event.data || {};
              switch (decoded.command) {
                case 'Ping':
                  waitForSurferApi(0, true);
                  break;
                case 'LoadUrl':
                  loadWaveformUrl(decoded.url);
                  void waitForWaveformLoaded(decoded);
                  break;
                case 'ToggleMenu':
                  injectWhenReady(JSON.stringify('ToggleMenu'));
                  break;
                case 'InjectMessage':
                  injectWhenReady(decoded.message);
                  break;
                default:
                  console.debug('Unknown Surfer host command', decoded.command);
                  break;
              }
            } catch (err) {
              postError(err);
            }
          });

          waitForSurferApi();
        } catch (err) {
          postError(err);
          throw err;
        }
      })();
    `

    text = this.removeDefaultMessageListenerSetup(text)
    text = this.awaitSurferWasmInit(text)
    text = this.disableSurferServiceWorker(text)

    if (text.includes('/*SURFER_SETUP_HOOKS*/')) {
      text = text.replace('/*SURFER_SETUP_HOOKS*/', setupHooks)
    } else {
      text = text.replace('</body>', `<script>${setupHooks}</script></body>`)
    }

    const body = Buffer.from(text, 'utf8')
    this.assetCache.set(htmlCacheKey, body)
    return body
  }

  private removeDefaultMessageListenerSetup(text: string): string {
    return text.replace(
      /<script\s+src="integration\.js"><\/script>\s*<script>\s*register_message_listener\(\)\s*<\/script>/,
      '',
    )
  }

  private awaitSurferWasmInit(text: string): string {
    return text.replace(
      /(^|[;\s])([A-Za-z_$][\w$]*\(\s*(['"`])\.\/surfer_bg\.wasm\3\s*\);)/,
      (_match, prefix: string, initCall: string) => `${prefix}await ${initCall}`,
    )
  }

  private disableSurferServiceWorker(text: string): string {
    return text.replace(
      /navigator\.serviceWorker\.register\((['"`])sw\.js\1\);?/g,
      "console.debug('Surfer service worker disabled inside ECOS Studio');",
    )
  }

  private async readSurferAsset(asset: string): Promise<Buffer> {
    return await this.readSurferAssetFrom(await this.currentSurferAssetsPath(), asset)
  }

  private async readSurferAssetFrom(assetsPath: string, asset: string): Promise<Buffer> {
    const key = asset || 'index.html'
    const cacheKey = `${assetsPath}:${key}`
    const cached = this.assetCache.get(cacheKey)
    if (cached) return cached

    const body = await readFile(join(assetsPath, key))
    this.assetCache.set(cacheKey, body)
    return body
  }

  private async currentSurferAssetsPath(): Promise<string> {
    const resourcePath = (await this.surferAssetsPathProvider?.())?.trim()
    if (resourcePath && (await isSurferAssetsPathReady(resourcePath))) {
      return resourcePath
    }
    if (await isSurferAssetsPathReady(this.surferAssetsPath)) {
      return this.surferAssetsPath
    }
    throw new Error(
      'Surfer waveform viewer assets are not installed. Install the Surfer resource in Resource Manager.',
    )
  }

  private async waveformResponse(request: Request, url: URL): Promise<Response> {
    const token = url.searchParams.get('token') || ''
    const grant = this.waveformGrants.get(token)
    if (!grant || grant.expiresAt <= Date.now()) {
      if (token) this.waveformGrants.delete(token)
      throw new Error('Waveform access grant is invalid or expired.')
    }
    const canonicalPath = grant.canonicalPath
    const fileStats = await stat(canonicalPath)
    const headers = this.headers('application/octet-stream')
    headers.set('Content-Length', String(fileStats.size))
    headers.set(
      'Content-Disposition',
      `inline; filename="${basename(canonicalPath).replace(/"/g, '')}"`,
    )

    if (request.method.toUpperCase() === 'HEAD') {
      return new Response(null, { headers })
    }

    const body = Readable.toWeb(createReadStream(canonicalPath)) as ReadableStream
    return new Response(body, { headers })
  }

  private pruneWaveformGrants(): void {
    const now = Date.now()
    for (const [token, grant] of this.waveformGrants) {
      if (grant.expiresAt <= now) this.waveformGrants.delete(token)
    }
    while (this.waveformGrants.size >= MAX_WAVEFORM_GRANTS) {
      const oldestToken = this.waveformGrants.keys().next().value
      if (typeof oldestToken !== 'string') break
      this.waveformGrants.delete(oldestToken)
    }
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
    if (typeof body === 'string') {
      return new Response(body, {
        headers: this.headers(contentType),
      })
    }
    const copy = new Uint8Array(body.byteLength)
    copy.set(body)
    const responseBody = new Blob([copy.buffer])
    return new Response(responseBody, {
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

export function surferWaveformUrl(path: string, token: string): string {
  const name = encodeURIComponent(basename(path))
  return `${SURFER_SCHEME}://viewer/waveform/${name}?token=${encodeURIComponent(token)}`
}

export function resolveSurferAssetsPath(
  options: {
    appPath?: string
    env?: NodeJS.ProcessEnv
    isPackaged?: boolean
    resourcesPath?: string
  } = {},
): string {
  const resourceManagedPath = options.env?.ECOS_SURFER_ASSETS_PATH?.trim()
  if (resourceManagedPath) {
    return resourceManagedPath
  }
  if (options.appPath) {
    return join(options.appPath, 'resources', 'surfer')
  }
  return fileURLToPath(new URL('../../resources/surfer', import.meta.url))
}

export async function isSurferAssetsPathReady(path: string): Promise<boolean> {
  try {
    await Promise.all([
      access(join(path, 'index.html')),
      access(join(path, 'integration.js')),
      access(join(path, 'surfer.js')),
      access(join(path, 'surfer_bg.wasm')),
    ])
    return true
  } catch {
    return false
  }
}
