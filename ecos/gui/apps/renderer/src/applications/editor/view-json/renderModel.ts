import {
  deriveBBoxFromRects,
  edaPointToWorldPoint,
  edaRectToWorldRect,
  materializeLocalRect,
  materializeMasterLocalRect,
  normalizeBBox,
} from './geometry'
import type {
  ViewJsonBBox,
  ViewJsonLayer,
  ViewJsonObjectKind,
  ViewJsonPackageData,
  ViewJsonPathRenderable,
  ViewJsonPoint,
  ViewJsonRectRenderable,
  ViewJsonLazyViaGeometrySource,
  ViewJsonRenderModel,
  ViewJsonWireSegment,
} from './types'
import { requestIdle as defaultRequestIdle } from '@/composables/requestIdle'

export interface ViewJsonRenderModelAsyncBuildOptions {
  batchSize?: number
  requestIdle?: () => Promise<void>
  shouldCancel?: () => boolean
}

function emptyCounts(): Record<ViewJsonObjectKind, number> {
  return {
    die: 0,
    core: 0,
    rows: 0,
    tracks: 0,
    gcell_grids: 0,
    instances: 0,
    io_pins: 0,
    regular_wires: 0,
    special_wires: 0,
    vias: 0,
    blockages: 0,
    fills: 0,
    regions: 0,
    cell_pins: 0,
    cell_obs: 0,
  }
}

function rectRenderable(
  id: string,
  objectKind: ViewJsonObjectKind,
  sourceId: number,
  layerId: number | undefined,
  eda: ViewJsonBBox,
  worldHeight: number,
): ViewJsonRectRenderable {
  const normalized = normalizeBBox(eda)
  return {
    id,
    objectKind,
    sourceId,
    layerId,
    eda: normalized,
    world: edaRectToWorldRect(normalized, worldHeight),
  }
}

function makePathRenderable(
  segment: ViewJsonWireSegment,
  objectKind: 'regular_wires' | 'special_wires',
  worldHeight: number,
): ViewJsonPathRenderable | null {
  if (
    typeof segment.layer_id !== 'number'
    || typeof segment.width !== 'number'
    || !Array.isArray(segment.points)
    || segment.points.length < 2
  ) {
    return null
  }

  return {
    id: `${objectKind}:${segment.id}:path`,
    objectKind,
    sourceId: segment.id,
    layerId: segment.layer_id,
    width: segment.width,
    edaPoints: segment.points,
    worldPoints: segment.points.map(point => edaPointToWorldPoint(point, worldHeight)),
  }
}

function addWireSegment(
  rects: ViewJsonRectRenderable[],
  lazyViaGeometry: ViewJsonLazyViaGeometrySource[],
  paths: ViewJsonPathRenderable[],
  pkg: ViewJsonPackageData,
  segment: ViewJsonWireSegment,
  objectKind: 'regular_wires' | 'special_wires',
): void {
  if (segment.kind === 'path') {
    const path = makePathRenderable(segment, objectKind, pkg.worldHeight)
    if (path) paths.push(path)
    return
  }

  if (segment.kind === 'patch' && segment.rect && typeof segment.layer_id === 'number') {
    rects.push(rectRenderable(
      `${objectKind}:${segment.id}:patch`,
      objectKind,
      segment.id,
      segment.layer_id,
      segment.rect,
      pkg.worldHeight,
    ))
    return
  }

  if (segment.kind === 'via' && typeof segment.via_master_id === 'number' && segment.origin) {
    const via = pkg.viaById.get(segment.via_master_id)
    if (!via) return
    const transform = {
      origin: segment.origin,
      orient: segment.orient,
      width: 0,
      height: 0,
    }
    lazyViaGeometry.push({
      idPrefix: `${objectKind}:${segment.id}:via`,
      sourceId: segment.id,
      viaMasterId: segment.via_master_id,
      origin: segment.origin,
      orient: segment.orient,
      bbox: segment.bbox ?? deriveBBoxFromRects(
        via.shapes.flatMap(shape => shape.rects.map(rect => materializeLocalRect(rect, transform))),
      ) ?? [segment.origin[0], segment.origin[1], segment.origin[0], segment.origin[1]],
    })
  }
}

function isRenderableWirePathSegment(segment: ViewJsonWireSegment): boolean {
  return segment.kind === 'path'
    && typeof segment.layer_id === 'number'
    && typeof segment.width === 'number'
    && Array.isArray(segment.points)
    && segment.points.length >= 2
}

function isRenderableWirePatchSegment(segment: ViewJsonWireSegment): boolean {
  return segment.kind === 'patch' && segment.rect != null && typeof segment.layer_id === 'number'
}

function isRenderableWireViaSegment(segment: ViewJsonWireSegment, pkg: ViewJsonPackageData): boolean {
  return segment.kind === 'via'
    && typeof segment.via_master_id === 'number'
    && segment.origin != null
    && pkg.viaById.has(segment.via_master_id)
}

function addViaPlacementRects(
  rects: ViewJsonRectRenderable[],
  pkg: ViewJsonPackageData,
  idPrefix: string,
  sourceId: number,
  viaMasterId: number,
  origin: ViewJsonPoint,
  orient?: ViewJsonWireSegment['orient'],
): void {
  const via = pkg.viaById.get(viaMasterId)
  if (!via) return
  const transform = {
    origin,
    orient,
    width: 0,
    height: 0,
  }
  for (let shapeIndex = 0; shapeIndex < via.shapes.length; shapeIndex += 1) {
    const shape = via.shapes[shapeIndex]
    for (let rectIndex = 0; rectIndex < shape.rects.length; rectIndex += 1) {
      rects.push(rectRenderable(
        `${idPrefix}:${shapeIndex}:${rectIndex}`,
        'vias',
        sourceId,
        shape.layer_id,
        materializeLocalRect(shape.rects[rectIndex], transform),
        pkg.worldHeight,
      ))
    }
  }
}

function addInstanceMasterRects(
  rects: ViewJsonRectRenderable[],
  pkg: ViewJsonPackageData,
): void {
  for (const inst of pkg.instances) {
    const master = pkg.cellMasterById.get(inst.master_id)
    if (!master) continue
    const transform = {
      origin: inst.origin,
      orient: inst.orient,
      width: master.size[0],
      height: master.size[1],
    }

    for (let pinIndex = 0; pinIndex < master.pins.length; pinIndex += 1) {
      const pin = master.pins[pinIndex]
      for (let portIndex = 0; portIndex < pin.ports.length; portIndex += 1) {
        const port = pin.ports[portIndex]
        for (let rectIndex = 0; rectIndex < port.rects.length; rectIndex += 1) {
          rects.push(rectRenderable(
            `cell_pins:${inst.id}:${pinIndex}:${portIndex}:${rectIndex}`,
            'cell_pins',
            inst.id,
            port.layer_id,
            materializeMasterLocalRect(port.rects[rectIndex], transform, master.origin),
            pkg.worldHeight,
          ))
        }
      }
    }

    for (let obsIndex = 0; obsIndex < master.obs.length; obsIndex += 1) {
      const obs = master.obs[obsIndex]
      for (let rectIndex = 0; rectIndex < obs.rects.length; rectIndex += 1) {
        rects.push(rectRenderable(
          `cell_obs:${inst.id}:${obsIndex}:${rectIndex}`,
          'cell_obs',
          inst.id,
          obs.layer_id,
          materializeMasterLocalRect(obs.rects[rectIndex], transform, master.origin),
          pkg.worldHeight,
        ))
      }
    }
  }
}

function addLazyInstanceMasterCounts(model: ViewJsonRenderModel, pkg: ViewJsonPackageData): void {
  if (!model.lazyGeometry) return

  for (const inst of pkg.instances) {
    const master = pkg.cellMasterById.get(inst.master_id)
    if (!master) continue
    model.lazyGeometry.cellInstances.push({
      instanceId: inst.id,
      masterId: inst.master_id,
      origin: inst.origin,
      orient: inst.orient,
      bbox: inst.bbox,
    })
    for (const pin of master.pins) {
      for (const port of pin.ports) {
        model.countsByObjectKind.cell_pins += port.rects.length
      }
    }
    for (const obs of master.obs) {
      model.countsByObjectKind.cell_obs += obs.rects.length
    }
  }
}

function addGuideLines(model: ViewJsonRenderModel, pkg: ViewJsonPackageData): void {
  for (const track of pkg.tracks) {
    const layerIds = track.layer_ids?.length ? track.layer_ids : (
      typeof track.layer_id === 'number' ? [track.layer_id] : [undefined]
    )
    for (const layerId of layerIds) {
      for (let index = 0; index < track.count; index += 1) {
        const coord = track.start + index * track.step
        const edaPoints: [ViewJsonPoint, ViewJsonPoint] = track.direction === 'Y'
          ? [[coord, 0], [coord, pkg.worldHeight]]
          : [[0, coord], [pkg.worldWidth, coord]]
        model.guides.push({
          id: `tracks:${track.id}:${layerId ?? 'none'}:${index}`,
          objectKind: 'tracks',
          sourceId: track.id,
          layerId,
          direction: track.direction,
          worldPoints: edaPoints.map(point => edaPointToWorldPoint(point, pkg.worldHeight)),
        })
      }
    }
  }

  for (const grid of pkg.gcellGrids) {
    for (let index = 0; index < grid.count; index += 1) {
      const coord = grid.start + index * grid.step
      const edaPoints: [ViewJsonPoint, ViewJsonPoint] = grid.direction === 'Y'
        ? [[coord, 0], [coord, pkg.worldHeight]]
        : [[0, coord], [pkg.worldWidth, coord]]
      model.guides.push({
        id: `gcell_grids:${grid.id}:${index}`,
        objectKind: 'gcell_grids',
        sourceId: grid.id,
        direction: grid.direction,
        worldPoints: edaPoints.map(point => edaPointToWorldPoint(point, pkg.worldHeight)),
      })
    }
  }
}

async function addGuideLinesAsync(
  model: ViewJsonRenderModel,
  pkg: ViewJsonPackageData,
  yieldIfNeeded: () => Promise<void>,
): Promise<void> {
  for (const track of pkg.tracks) {
    const layerIds = track.layer_ids?.length ? track.layer_ids : (
      typeof track.layer_id === 'number' ? [track.layer_id] : [undefined]
    )
    for (const layerId of layerIds) {
      for (let index = 0; index < track.count; index += 1) {
        const coord = track.start + index * track.step
        const edaPoints: [ViewJsonPoint, ViewJsonPoint] = track.direction === 'Y'
          ? [[coord, 0], [coord, pkg.worldHeight]]
          : [[0, coord], [pkg.worldWidth, coord]]
        model.guides.push({
          id: `tracks:${track.id}:${layerId ?? 'none'}:${index}`,
          objectKind: 'tracks',
          sourceId: track.id,
          layerId,
          direction: track.direction,
          worldPoints: edaPoints.map(point => edaPointToWorldPoint(point, pkg.worldHeight)),
        })
        await yieldIfNeeded()
      }
    }
  }

  for (const grid of pkg.gcellGrids) {
    for (let index = 0; index < grid.count; index += 1) {
      const coord = grid.start + index * grid.step
      const edaPoints: [ViewJsonPoint, ViewJsonPoint] = grid.direction === 'Y'
        ? [[coord, 0], [coord, pkg.worldHeight]]
        : [[0, coord], [pkg.worldWidth, coord]]
      model.guides.push({
        id: `gcell_grids:${grid.id}:${index}`,
        objectKind: 'gcell_grids',
        sourceId: grid.id,
        direction: grid.direction,
        worldPoints: edaPoints.map(point => edaPointToWorldPoint(point, pkg.worldHeight)),
      })
      await yieldIfNeeded()
    }
  }
}

function sortLayers(layers: ViewJsonLayer[]): ViewJsonLayer[] {
  return [...layers].sort((a, b) => (a.order ?? a.id) - (b.order ?? b.id))
}

function createEmptyRenderModel(pkg: ViewJsonPackageData): ViewJsonRenderModel {
  return {
    dbuPerMicron: pkg.dbuPerMicron,
    worldWidth: pkg.worldWidth,
    worldHeight: pkg.worldHeight,
    layers: sortLayers(pkg.layers),
    layerById: pkg.layerById,
    rects: [],
    paths: [],
    guides: [],
    lazyGeometry: {
      cellInstances: [],
      vias: [],
    },
    countsByObjectKind: emptyCounts(),
  }
}

function addBaseDesignGeometry(model: ViewJsonRenderModel, pkg: ViewJsonPackageData): void {
  model.rects.push(rectRenderable('die:0', 'die', 0, undefined, pkg.die.die_area, pkg.worldHeight))
  if (pkg.die.core_area) {
    model.rects.push(rectRenderable('core:0', 'core', 0, undefined, pkg.die.core_area, pkg.worldHeight))
  }

  for (const row of pkg.rows) {
    model.rects.push(rectRenderable(`rows:${row.id}`, 'rows', row.id, undefined, row.bbox, pkg.worldHeight))
  }

  for (const inst of pkg.instances) {
    model.rects.push(rectRenderable(`instances:${inst.id}`, 'instances', inst.id, undefined, inst.bbox, pkg.worldHeight))
  }

  for (const pin of pkg.ioPins) {
    for (let portIndex = 0; portIndex < pin.ports.length; portIndex += 1) {
      const port = pin.ports[portIndex]
      for (let rectIndex = 0; rectIndex < port.rects.length; rectIndex += 1) {
        model.rects.push(rectRenderable(
          `io_pins:${pin.id}:${portIndex}:${rectIndex}`,
          'io_pins',
          pin.id,
          port.layer_id,
          port.rects[rectIndex],
          pkg.worldHeight,
        ))
      }
    }

    for (let viaIndex = 0; viaIndex < (pin.vias ?? []).length; viaIndex += 1) {
      const via = pin.vias?.[viaIndex]
      if (!via) continue
      const viaMaster = pkg.viaById.get(via.via_master_id)
      if (!viaMaster) continue
      model.lazyGeometry?.vias.push({
        idPrefix: `io_pins:${pin.id}:via:${viaIndex}`,
        sourceId: pin.id,
        viaMasterId: via.via_master_id,
        origin: via.origin,
        orient: via.orient ?? pin.orient,
        bbox: deriveBBoxFromRects(
          viaMaster.shapes.flatMap(shape => shape.rects.map(rect => materializeLocalRect(rect, {
            origin: via.origin,
            orient: via.orient ?? pin.orient,
            width: 0,
            height: 0,
          }))),
        ) ?? [via.origin[0], via.origin[1], via.origin[0], via.origin[1]],
      })
    }
  }
}

function addRoutingGeometry(model: ViewJsonRenderModel, pkg: ViewJsonPackageData): void {
  for (const segment of pkg.regularWires) {
    addWireSegment(model.rects, model.lazyGeometry?.vias ?? [], model.paths, pkg, segment, 'regular_wires')
  }
  for (const segment of pkg.specialWires) {
    addWireSegment(model.rects, model.lazyGeometry?.vias ?? [], model.paths, pkg, segment, 'special_wires')
  }
}

function addAuxiliaryGeometry(model: ViewJsonRenderModel, pkg: ViewJsonPackageData): void {
  for (const blockage of pkg.blockages) {
    const rect = blockage.rect ?? blockage.bbox
    if (rect) model.rects.push(rectRenderable(`blockages:${blockage.id}`, 'blockages', blockage.id, blockage.layer_id, rect, pkg.worldHeight))
  }
  for (const fill of pkg.fills) {
    const rect = fill.rect ?? fill.bbox
    if (rect) model.rects.push(rectRenderable(`fills:${fill.id}`, 'fills', fill.id, fill.layer_id, rect, pkg.worldHeight))
  }
  for (const region of pkg.regions) {
    const rects = region.rects ?? (region.bbox ? [region.bbox] : [])
    for (let rectIndex = 0; rectIndex < rects.length; rectIndex += 1) {
      model.rects.push(rectRenderable(`regions:${region.id}:${rectIndex}`, 'regions', region.id, undefined, rects[rectIndex], pkg.worldHeight))
    }
  }
}

function countRenderableGeometry(model: ViewJsonRenderModel): void {
  model.countsByObjectKind = emptyCounts()
  for (const rect of model.rects) {
    model.countsByObjectKind[rect.objectKind] += 1
  }
  for (const path of model.paths) {
    model.countsByObjectKind[path.objectKind] += 1
  }
  for (const guide of model.guides) {
    model.countsByObjectKind[guide.objectKind] += 1
  }
  model.countsByObjectKind.vias += model.lazyGeometry?.vias.length ?? 0
}

function countRoutingGeometry(model: ViewJsonRenderModel, pkg: ViewJsonPackageData): void {
  if ((pkg.regularWires.length === 0 && pkg.specialWires.length === 0) && pkg.overview?.countsByObjectKind) {
    model.countsByObjectKind.regular_wires += pkg.overview.countsByObjectKind.regular_wires ?? 0
    model.countsByObjectKind.special_wires += pkg.overview.countsByObjectKind.special_wires ?? 0
    model.countsByObjectKind.vias += pkg.overview.countsByObjectKind.vias ?? 0
    return
  }

  for (const segment of pkg.regularWires) {
    if (isRenderableWirePathSegment(segment)) {
      model.countsByObjectKind.regular_wires += 1
      continue
    }
    if (isRenderableWirePatchSegment(segment)) {
      model.countsByObjectKind.regular_wires += 1
      continue
    }
    if (isRenderableWireViaSegment(segment, pkg)) {
      model.countsByObjectKind.vias += 1
    }
  }

  for (const segment of pkg.specialWires) {
    if (isRenderableWirePathSegment(segment)) {
      model.countsByObjectKind.special_wires += 1
      continue
    }
    if (isRenderableWirePatchSegment(segment)) {
      model.countsByObjectKind.special_wires += 1
      continue
    }
    if (isRenderableWireViaSegment(segment, pkg)) {
      model.countsByObjectKind.vias += 1
    }
  }
}

function countGuideGeometry(model: ViewJsonRenderModel, pkg: ViewJsonPackageData): void {
  for (const track of pkg.tracks) {
    const layerCount = track.layer_ids?.length
      ? track.layer_ids.length
      : 1
    model.countsByObjectKind.tracks += track.count * layerCount
  }
  for (const grid of pkg.gcellGrids) {
    model.countsByObjectKind.gcell_grids += grid.count
  }
}

function finalizeModelCounts(model: ViewJsonRenderModel, pkg: ViewJsonPackageData): void {
  countRenderableGeometry(model)
  addLazyInstanceMasterCounts(model, pkg)
}

export function buildViewJsonRenderModel(pkg: ViewJsonPackageData): ViewJsonRenderModel {
  const model = createEmptyRenderModel(pkg)
  addBaseDesignGeometry(model, pkg)
  addRoutingGeometry(model, pkg)
  addAuxiliaryGeometry(model, pkg)
  addGuideLines(model, pkg)
  finalizeModelCounts(model, pkg)

  return model
}

export function buildViewJsonLightweightRenderModel(pkg: ViewJsonPackageData): ViewJsonRenderModel {
  const model = createEmptyRenderModel(pkg)
  addBaseDesignGeometry(model, pkg)
  addAuxiliaryGeometry(model, pkg)
  countRenderableGeometry(model)
  countGuideGeometry(model, pkg)
  countRoutingGeometry(model, pkg)
  addLazyInstanceMasterCounts(model, pkg)

  return model
}

export async function buildViewJsonRenderModelAsync(
  pkg: ViewJsonPackageData,
  options: ViewJsonRenderModelAsyncBuildOptions = {},
): Promise<ViewJsonRenderModel> {
  const model = createEmptyRenderModel(pkg)
  const batchSize = Number.isFinite(options.batchSize) && options.batchSize != null && options.batchSize > 0
    ? options.batchSize
    : 5000
  const requestIdle = options.requestIdle ?? defaultRequestIdle
  let processed = 0

  const yieldIfNeeded = async (force = false): Promise<void> => {
    if (options.shouldCancel?.()) throw new Error('View JSON render model build cancelled.')
    processed += force ? 0 : 1
    if (!force && processed < batchSize) return
    processed = 0
    await requestIdle()
    if (options.shouldCancel?.()) throw new Error('View JSON render model build cancelled.')
  }

  await yieldIfNeeded(true)

  model.rects.push(rectRenderable('die:0', 'die', 0, undefined, pkg.die.die_area, pkg.worldHeight))
  if (pkg.die.core_area) {
    model.rects.push(rectRenderable('core:0', 'core', 0, undefined, pkg.die.core_area, pkg.worldHeight))
  }

  for (const row of pkg.rows) {
    model.rects.push(rectRenderable(`rows:${row.id}`, 'rows', row.id, undefined, row.bbox, pkg.worldHeight))
    await yieldIfNeeded()
  }

  for (const inst of pkg.instances) {
    model.rects.push(rectRenderable(`instances:${inst.id}`, 'instances', inst.id, undefined, inst.bbox, pkg.worldHeight))
    await yieldIfNeeded()
  }

  for (const pin of pkg.ioPins) {
    for (let portIndex = 0; portIndex < pin.ports.length; portIndex += 1) {
      const port = pin.ports[portIndex]
      for (let rectIndex = 0; rectIndex < port.rects.length; rectIndex += 1) {
        model.rects.push(rectRenderable(
          `io_pins:${pin.id}:${portIndex}:${rectIndex}`,
          'io_pins',
          pin.id,
          port.layer_id,
          port.rects[rectIndex],
          pkg.worldHeight,
        ))
        await yieldIfNeeded()
      }
    }

    for (let viaIndex = 0; viaIndex < (pin.vias ?? []).length; viaIndex += 1) {
      const via = pin.vias?.[viaIndex]
      if (!via) continue
      const viaMaster = pkg.viaById.get(via.via_master_id)
      if (!viaMaster) continue
      model.lazyGeometry?.vias.push({
        idPrefix: `io_pins:${pin.id}:via:${viaIndex}`,
        sourceId: pin.id,
        viaMasterId: via.via_master_id,
        origin: via.origin,
        orient: via.orient ?? pin.orient,
        bbox: deriveBBoxFromRects(
          viaMaster.shapes.flatMap(shape => shape.rects.map(rect => materializeLocalRect(rect, {
            origin: via.origin,
            orient: via.orient ?? pin.orient,
            width: 0,
            height: 0,
          }))),
        ) ?? [via.origin[0], via.origin[1], via.origin[0], via.origin[1]],
      })
      await yieldIfNeeded()
    }
  }

  for (const segment of pkg.regularWires) {
    addWireSegment(model.rects, model.lazyGeometry?.vias ?? [], model.paths, pkg, segment, 'regular_wires')
    await yieldIfNeeded()
  }

  for (const segment of pkg.specialWires) {
    addWireSegment(model.rects, model.lazyGeometry?.vias ?? [], model.paths, pkg, segment, 'special_wires')
    await yieldIfNeeded()
  }

  for (const blockage of pkg.blockages) {
    const rect = blockage.rect ?? blockage.bbox
    if (rect) model.rects.push(rectRenderable(`blockages:${blockage.id}`, 'blockages', blockage.id, blockage.layer_id, rect, pkg.worldHeight))
    await yieldIfNeeded()
  }

  for (const fill of pkg.fills) {
    const rect = fill.rect ?? fill.bbox
    if (rect) model.rects.push(rectRenderable(`fills:${fill.id}`, 'fills', fill.id, fill.layer_id, rect, pkg.worldHeight))
    await yieldIfNeeded()
  }

  for (const region of pkg.regions) {
    const rects = region.rects ?? (region.bbox ? [region.bbox] : [])
    for (let rectIndex = 0; rectIndex < rects.length; rectIndex += 1) {
      model.rects.push(rectRenderable(`regions:${region.id}:${rectIndex}`, 'regions', region.id, undefined, rects[rectIndex], pkg.worldHeight))
      await yieldIfNeeded()
    }
  }

  await addGuideLinesAsync(model, pkg, yieldIfNeeded)
  finalizeModelCounts(model, pkg)

  return model
}

export const __viewJsonRenderModelInternals = {
  rectRenderable,
  addViaPlacementRects,
  addInstanceMasterRects,
}
