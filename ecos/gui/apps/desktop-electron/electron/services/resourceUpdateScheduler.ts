import type {
  ResourceUpdatesDetectedEvent,
  ResourceUpdatesDetectedItem,
} from '@ecos-studio/shared'
import { electronLogger } from './logger'
import type { ResourceManagerService } from './resourceManagerService'

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000

type ResourceUpdateCheckService = Pick<
  ResourceManagerService,
  'checkResourceUpdates' | 'isUpdateCheckCacheStale' | 'listResources'
>

export type ResourceUpdateCycleReason = 'startup' | 'focus' | 'interval'

export interface ResourceUpdateSchedulerOptions {
  resourceManagerService: ResourceUpdateCheckService
  emit: (event: ResourceUpdatesDetectedEvent) => void
  intervalMs?: number
  now?: () => number
}

function detectedSignature(item: ResourceUpdatesDetectedItem): string {
  return `${item.resource_id}|${item.update_kind}|${item.latest_version}`
}

/**
 * Runs automatic resource update checks: once at startup, then on a timer and
 * on window focus. Checks are TTL-gated (never forced, never refreshing the
 * registry — the registry's own background refresh covers that), and an
 * updates-detected event is emitted only for updates not already notified
 * this session. Cycles never reject; failures are logged.
 */
export class ResourceUpdateScheduler {
  private readonly resourceManagerService: ResourceUpdateCheckService
  private readonly emit: (event: ResourceUpdatesDetectedEvent) => void
  private readonly intervalMs: number
  private readonly now: () => number
  private readonly notifiedSignatures = new Set<string>()
  private timer: ReturnType<typeof setInterval> | null = null
  private cyclePromise: Promise<void> | null = null

  constructor(options: ResourceUpdateSchedulerOptions) {
    this.resourceManagerService = options.resourceManagerService
    this.emit = options.emit
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS
    this.now = options.now ?? Date.now
  }

  start(): void {
    if (this.timer) return
    void this.runCycle('startup')
    this.timer = setInterval(() => {
      void this.runCycle('interval')
    }, this.intervalMs)
    // Never keep the process alive just for update checks.
    this.timer.unref?.()
  }

  stop(): void {
    if (!this.timer) return
    clearInterval(this.timer)
    this.timer = null
  }

  async runCycle(reason: ResourceUpdateCycleReason): Promise<void> {
    this.cyclePromise ??= this.runCycleOnce(reason).finally(() => {
      this.cyclePromise = null
    })
    return await this.cyclePromise
  }

  private async runCycleOnce(reason: ResourceUpdateCycleReason): Promise<void> {
    try {
      if (await this.resourceManagerService.isUpdateCheckCacheStale(this.now())) {
        await this.resourceManagerService.checkResourceUpdates({ force: false })
      }

      const list = await this.resourceManagerService.listResources()
      const items: ResourceUpdatesDetectedItem[] = []
      for (const resource of list.resources) {
        if (resource.status !== 'update_available') continue
        items.push({
          resource_id: resource.id,
          display_name: resource.display_name,
          update_kind: resource.update_kind ?? null,
          installed_version: resource.installed_version,
          latest_version: resource.available_versions[0] ?? null,
        })
      }

      if (items.length === 0) {
        // Nothing pending: forget what was notified so a future update
        // notifies again.
        this.notifiedSignatures.clear()
        return
      }

      const signatures = items.map(detectedSignature)
      const newItems = items.filter(
        (_item, index) => !this.notifiedSignatures.has(signatures[index]),
      )
      if (newItems.length > 0) {
        this.emit({ resources: newItems })
      }
      for (const signature of signatures) {
        this.notifiedSignatures.add(signature)
      }
    } catch (error) {
      electronLogger.warn(`[resources] automatic update check (${reason}) failed`, error)
    }
  }
}
