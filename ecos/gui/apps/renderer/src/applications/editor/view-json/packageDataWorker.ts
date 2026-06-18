import ViewJsonPackageDataWorker from './packageData.worker?worker'
import type {
  ViewJsonPackageDataWorkerFactory,
} from './packageData'

export const createViewJsonPackageDataWorker: ViewJsonPackageDataWorkerFactory = () =>
  new ViewJsonPackageDataWorker()
