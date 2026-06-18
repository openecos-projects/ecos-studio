import {
  parseViewJsonPackageDataFromTexts,
  parseViewJsonRoutingDetailFromTexts,
} from './packageData'
import type {
  ViewJsonPackageDataWorkerRequest,
  ViewJsonPackageDataWorkerResponse,
} from './packageData'

self.onmessage = (event: MessageEvent<ViewJsonPackageDataWorkerRequest>) => {
  const message = event.data

  try {
    if (message.type === 'parse-view-json-package-data') {
      const packageData = parseViewJsonPackageDataFromTexts(message.request)
      self.postMessage({
        id: message.id,
        ok: true,
        packageData,
      } satisfies ViewJsonPackageDataWorkerResponse)
      return
    }

    if (message.type === 'parse-view-json-routing-detail') {
      const routingDetail = parseViewJsonRoutingDetailFromTexts(message.request)
      self.postMessage({
        id: message.id,
        ok: true,
        routingDetail,
      } satisfies ViewJsonPackageDataWorkerResponse)
    }
  } catch (error: unknown) {
    self.postMessage({
      id: message.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    } satisfies ViewJsonPackageDataWorkerResponse)
  }
}
