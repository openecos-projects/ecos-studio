import {
  parseViewJsonOverviewPackageTexts,
  type ViewJsonOverviewWorkerRequest,
  type ViewJsonOverviewWorkerResponse,
} from './overviewData'

self.onmessage = (event: MessageEvent<ViewJsonOverviewWorkerRequest>) => {
  const message = event.data

  if (message.type !== 'load-view-json-overview') return

  void parseViewJsonOverviewPackageTexts(message.input, message.readMs, {
    batchSize: Number.MAX_SAFE_INTEGER,
  })
    .then((overview) => {
      self.postMessage({
        id: message.id,
        ok: true,
        overview,
      } satisfies ViewJsonOverviewWorkerResponse)
    })
    .catch((error: unknown) => {
      self.postMessage({
        id: message.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      } satisfies ViewJsonOverviewWorkerResponse)
    })
}
