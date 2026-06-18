import {
  buildViewJsonSemanticOverviewSeedModel,
  buildViewJsonSemanticOverviewLevel,
} from './semanticOverview'
import type {
  ViewJsonSemanticOverviewWorkerRequest,
  ViewJsonSemanticOverviewWorkerResponse,
} from './semanticOverviewWorker'

self.onmessage = (event: MessageEvent<ViewJsonSemanticOverviewWorkerRequest>) => {
  const message = event.data

  try {
    const level = message.type === 'build-view-json-semantic-overview'
      ? buildViewJsonSemanticOverviewLevel(message.model, message.data, message.scale)
      : message.type === 'build-view-json-semantic-overview-from-package'
        ? buildViewJsonSemanticOverviewLevel(
        buildViewJsonSemanticOverviewSeedModel(message.data),
        message.data,
        message.scale,
      )
        : null
    if (!level) return
    self.postMessage({
      id: message.id,
      ok: true,
      level,
    } satisfies ViewJsonSemanticOverviewWorkerResponse)
  } catch (error: unknown) {
    self.postMessage({
      id: message.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    } satisfies ViewJsonSemanticOverviewWorkerResponse)
  }
}
