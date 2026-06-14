import ViewJsonOverviewWorker from './overview.worker?worker'
import type { ViewJsonOverviewWorkerFactory, ViewJsonOverviewWorkerLike } from './overviewData'

export const createViewJsonOverviewWorker: ViewJsonOverviewWorkerFactory = () =>
  new ViewJsonOverviewWorker() as ViewJsonOverviewWorkerLike
