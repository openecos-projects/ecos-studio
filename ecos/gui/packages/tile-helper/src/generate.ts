import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { deflateSync } from 'node:zlib'
import type { TileManifest } from './manifest.ts'

const TILE_PIXEL_SIZE = 256
const VECTOR_THRESHOLD = 3000
const MIN_FEATURE_FLOOR = 50
const MAX_Z_HARD_CAP = 10

const PALETTE: ReadonlyArray<readonly [number, number, number]> = [
  [120, 120, 120],
  [65, 105, 225],
  [0, 206, 209],
  [50, 205, 50],
  [127, 255, 0],
  [255, 215, 0],
  [255, 140, 0],
  [232, 69, 60],
  [255, 105, 180],
  [147, 112, 219],
  [255, 99, 71],
  [32, 178, 170],
  [186, 85, 211],
  [60, 179, 113],
  [123, 104, 238],
  [70, 130, 180],
  [218, 165, 32],
  [205, 92, 92],
  [106, 90, 205],
  [30, 144, 255],
  [220, 20, 60],
] as const

interface LayerStyle {
  name: string
  rgb: readonly [number, number, number]
  alpha: number
  zOrder: number
}

interface LayerRuntime {
  gdsIdToIdx: Map<number, number>
  byIdx: LayerStyle[]
}

interface ScreenRect {
  minX: number
  minY: number
  maxX: number
  maxY: number
  layerIdx: number
}

interface RawInst {
  name: string
  rects: ScreenRect[]
}

interface LocalRect {
  layerIdx: number
  lx: number
  ly: number
  lw: number
  lh: number
}

interface LayerRects {
  layerIdx: number
  packed: Uint8Array
  rectCount: number
}

interface CellDef {
  cellId: number
  bboxW: number
  bboxH: number
  coordBits: number
  layers: LayerRects[]
}

interface CellInst {
  instanceId: number
  cellId: number
  originX: number
  originY: number
  orient: number
  bboxW: number
  bboxH: number
}

function asObject(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(message)
  }

  return value as Record<string, unknown>
}

function asArray(value: unknown, message: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(message)
  }

  return value
}

function asNumber(value: unknown, message: string): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new Error(message)
  }

  return value
}

function buildLayerRuntime(layerInfo: Array<[number, string]>): LayerRuntime {
  const sorted = [...layerInfo].sort((left, right) => left[0] - right[0])
  const gdsIdToIdx = new Map<number, number>()
  const byIdx: LayerStyle[] = []

  sorted.forEach(([id, name], index) => {
    gdsIdToIdx.set(id, index)
    const rgb = PALETTE[index % PALETTE.length]
    const alpha = index === 0 ? 76 : 153
    const normalizedName = name
      .toLowerCase()
      .split('')
      .map((char) => (/\s/.test(char) ? '_' : char))
      .join('')
    byIdx.push({
      name: normalizedName,
      rgb,
      alpha,
      zOrder: index * 5,
    })
  })

  return {
    gdsIdToIdx,
    byIdx,
  }
}

function crc32PngChunk(data: Uint8Array): number {
  let crc = 0xffff_ffff

  for (const byte of data) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) !== 0 ? (crc >>> 1) ^ 0xedb8_8320 : crc >>> 1
    }
  }

  return (~crc) >>> 0
}

function pngChunk(chunkType: Uint8Array, data: Uint8Array): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)

  const crcInput = Buffer.concat([chunkType, data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32PngChunk(crcInput), 0)

  return Buffer.concat([length, chunkType, data, crc])
}

function encodePngRgba(pixels: Uint8Array, width: number, height: number): Buffer {
  const side = TILE_PIXEL_SIZE
  if (width !== side || height !== side || pixels.length !== side * side * 4) {
    throw new Error('encode_png: bad dimensions')
  }

  const rows = Buffer.alloc(height * (1 + width * 4))
  let rowOffset = 0
  for (let y = 0; y < height; y += 1) {
    rows[rowOffset] = 0
    rowOffset += 1
    const sourceOffset = y * width * 4
    Buffer.from(pixels.buffer, pixels.byteOffset + sourceOffset, width * 4).copy(rows, rowOffset)
    rowOffset += width * 4
  }

  const compressed = deflateSync(rows, { level: 6 })
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk(Buffer.from('IHDR'), ihdr),
    pngChunk(Buffer.from('IDAT'), compressed),
    pngChunk(Buffer.from('IEND'), Buffer.alloc(0)),
  ])
}

function parseSourceData(
  data: unknown[],
  dieHeight: number,
  runtime: LayerRuntime,
): { rawInsts: RawInst[]; totalBoxes: number } {
  const rawInsts: RawInst[] = []
  let totalBoxes = 0

  for (const groupValue of data) {
    const group = asObject(groupValue, 'group')
    if (group.type !== 'group') {
      continue
    }

    const children = asArray(group.children, 'group without children')
    const rects: ScreenRect[] = []
    for (const childValue of children) {
      const child = asObject(childValue, 'child')
      if (child.type !== 'box') {
        continue
      }

      const layerId = typeof child.layer === 'number' ? child.layer : null
      if (layerId == null) {
        throw new Error('box layer')
      }

      const layerIdx = runtime.gdsIdToIdx.get(layerId)
      if (layerIdx == null) {
        continue
      }

      const pathPoints = asArray(child.path, 'box path')
      let minX = Number.POSITIVE_INFINITY
      let minY = Number.POSITIVE_INFINITY
      let maxX = Number.NEGATIVE_INFINITY
      let maxY = Number.NEGATIVE_INFINITY

      for (const pointValue of pathPoints) {
        const point = asArray(pointValue, 'path point')
        if (point.length < 2) {
          continue
        }

        const x = asNumber(point[0], 'x')
        const y = asNumber(point[1], 'y')
        minX = Math.min(minX, x)
        maxX = Math.max(maxX, x)
        minY = Math.min(minY, y)
        maxY = Math.max(maxY, y)
      }

      rects.push({
        minX,
        minY: dieHeight - maxY,
        maxX,
        maxY: dieHeight - minY,
        layerIdx,
      })
    }

    if (rects.length === 0) {
      continue
    }

    totalBoxes += rects.length
    rawInsts.push({
      name: typeof group['struct name'] === 'string' ? group['struct name'] : 'instance',
      rects,
    })
  }

  return { rawInsts, totalBoxes }
}

function buildPackedRects(localRects: LocalRect[], coordBits: number): Uint8Array {
  const packed = Buffer.alloc(localRects.length * (coordBits === 0 ? 8 : 16))
  let offset = 0

  for (const rect of localRects) {
    if (coordBits === 0) {
      packed.writeInt16LE(rect.lx, offset)
      packed.writeInt16LE(rect.ly, offset + 2)
      packed.writeInt16LE(rect.lw, offset + 4)
      packed.writeInt16LE(rect.lh, offset + 6)
      offset += 8
    } else {
      packed.writeInt32LE(rect.lx, offset)
      packed.writeInt32LE(rect.ly, offset + 4)
      packed.writeInt32LE(rect.lw, offset + 8)
      packed.writeInt32LE(rect.lh, offset + 12)
      offset += 16
    }
  }

  return packed
}

function extractHierarchy(rawInsts: RawInst[]): {
  cellDefs: Map<number, CellDef>
  cellInsts: CellInst[]
} {
  const hashToCellId = new Map<string, number>()
  const cellDefs = new Map<number, CellDef>()
  const cellInsts: CellInst[] = []
  let nextCellId = 1

  for (const inst of rawInsts) {
    let minWorldX = Number.POSITIVE_INFINITY
    let minWorldY = Number.POSITIVE_INFINITY
    let maxWorldX = Number.NEGATIVE_INFINITY
    let maxWorldY = Number.NEGATIVE_INFINITY

    for (const rect of inst.rects) {
      minWorldX = Math.min(minWorldX, rect.minX)
      minWorldY = Math.min(minWorldY, rect.minY)
      maxWorldX = Math.max(maxWorldX, rect.maxX)
      maxWorldY = Math.max(maxWorldY, rect.maxY)
    }

    const originX = minWorldX
    const originY = minWorldY
    const bboxW = maxWorldX - minWorldX
    const bboxH = maxWorldY - minWorldY

    const localRects = inst.rects.map<LocalRect>((rect) => ({
      layerIdx: rect.layerIdx,
      lx: Math.trunc(rect.minX - originX),
      ly: Math.trunc(rect.minY - originY),
      lw: Math.trunc(rect.maxX - rect.minX),
      lh: Math.trunc(rect.maxY - rect.minY),
    }))

    const sortedLocalRects = localRects
      .map((rect) => ({
        layerIdx: rect.layerIdx,
        lx: rect.lx,
        ly: rect.ly,
        lw: rect.lw,
        lh: rect.lh,
      }))
      .sort((left, right) =>
        left.layerIdx - right.layerIdx
        || left.lx - right.lx
        || left.ly - right.ly
        || left.lw - right.lw
        || left.lh - right.lh,
      )

    const cellHash = createHash('md5')
      .update(JSON.stringify(sortedLocalRects))
      .digest('hex')

    let cellId = hashToCellId.get(cellHash)
    if (cellId == null) {
      cellId = nextCellId
      nextCellId += 1
      hashToCellId.set(cellHash, cellId)

      let maxCoord = 0
      for (const rect of localRects) {
        const rectMax = Math.max(
          Math.abs(rect.lx),
          Math.abs(rect.ly),
          rect.lx + rect.lw,
          rect.ly + rect.lh,
        )
        maxCoord = Math.max(maxCoord, rectMax)
      }

      const coordBits = maxCoord > 32767 ? 1 : 0
      const rectsByLayer = new Map<number, LocalRect[]>()
      for (const rect of localRects) {
        const layerRects = rectsByLayer.get(rect.layerIdx)
        if (layerRects) {
          layerRects.push(rect)
        } else {
          rectsByLayer.set(rect.layerIdx, [rect])
        }
      }

      const layers = [...rectsByLayer.entries()]
        .sort((left, right) => left[0] - right[0])
        .map<LayerRects>(([layerIdx, layerRects]) => ({
          layerIdx,
          rectCount: layerRects.length,
          packed: buildPackedRects(layerRects, coordBits),
        }))

      cellDefs.set(cellId, {
        cellId,
        bboxW: Math.round(bboxW),
        bboxH: Math.round(bboxH),
        coordBits,
        layers,
      })
    }

    const nameHash = createHash('md5').update(inst.name).digest('hex')
    const instanceId = Number.parseInt(nameHash.slice(0, 8), 16) || 0
    cellInsts.push({
      instanceId,
      cellId,
      originX,
      originY,
      orient: 0,
      bboxW,
      bboxH,
    })
  }

  return { cellDefs, cellInsts }
}

function buildCellsBin(cellDefs: Map<number, CellDef>): Buffer {
  const cells = [...cellDefs.values()].sort((left, right) => left.cellId - right.cellId)
  const cellBuffers = cells.map((cell) => {
    const header = Buffer.alloc(14)
    header.writeUInt32LE(cell.cellId, 0)
    header.writeInt32LE(cell.bboxW, 4)
    header.writeInt32LE(cell.bboxH, 8)
    header[12] = cell.layers.length
    header[13] = cell.coordBits

    const parts: Buffer[] = [header]
    for (const layer of cell.layers) {
      const layerHeader = Buffer.alloc(3)
      layerHeader[0] = layer.layerIdx
      layerHeader.writeUInt16LE(layer.rectCount, 1)
      parts.push(layerHeader, Buffer.from(layer.packed))
    }

    return Buffer.concat(parts)
  })

  const fileHeader = Buffer.alloc(16)
  fileHeader.writeUInt32LE(0x4543454c, 0)
  fileHeader.writeUInt16LE(1, 4)
  fileHeader.writeUInt16LE(0, 6)
  fileHeader.writeUInt32LE(cells.length, 8)
  fileHeader.writeUInt32LE(16, 12)

  const indexBuffer = Buffer.alloc(cells.length * 12)
  let dataOffset = 16 + indexBuffer.length
  cells.forEach((cell, index) => {
    const offset = index * 12
    indexBuffer.writeUInt32LE(cell.cellId, offset)
    indexBuffer.writeUInt32LE(dataOffset, offset + 4)
    indexBuffer.writeUInt32LE(cellBuffers[index].length, offset + 8)
    dataOffset += cellBuffers[index].length
  })

  return Buffer.concat([fileHeader, indexBuffer, ...cellBuffers])
}

function buildGlobalBin(): Buffer {
  const fileHeader = Buffer.alloc(12)
  fileHeader.writeUInt32LE(0x45434756, 0)
  fileHeader.writeUInt16LE(1, 4)
  fileHeader.writeUInt16LE(0, 6)
  fileHeader.writeUInt32LE(0, 8)
  return fileHeader
}

function buildVectorTile(instances: readonly CellInst[]): Buffer {
  const header = Buffer.alloc(16)
  header.writeUInt32LE(0x45434f53, 0)
  header.writeUInt16LE(2, 4)
  header[6] = instances.length === 0 ? 0 : 1
  header[7] = 0
  header.writeUInt32LE(instances.length, 8)
  header.writeUInt32LE(0, 12)

  const instBuffer = Buffer.alloc(instances.length * 17)
  instances.forEach((inst, index) => {
    const offset = index * 17
    instBuffer.writeUInt32LE(inst.instanceId, offset)
    instBuffer.writeUInt32LE(inst.cellId, offset + 4)
    instBuffer.writeInt32LE(Math.round(inst.originX), offset + 8)
    instBuffer.writeInt32LE(Math.round(inst.originY), offset + 12)
    instBuffer[offset + 16] = inst.orient
  })

  return Buffer.concat([header, instBuffer])
}

function renderRasterTile(
  instances: readonly CellInst[],
  cellDefs: Map<number, CellDef>,
  tileBounds: readonly [number, number, number, number],
  tileWorldSize: number,
  runtime: LayerRuntime,
): Uint8Array {
  const side = TILE_PIXEL_SIZE
  const pixels = new Uint8Array(side * side * 4)
  const [tileMinX, tileMinY] = tileBounds
  const scale = side / tileWorldSize
  const sortedLayerIdx = runtime.byIdx
    .map((_layer, index) => index)
    .sort((left, right) => runtime.byIdx[left].zOrder - runtime.byIdx[right].zOrder)

  for (const layerIdx of sortedLayerIdx) {
    const style = runtime.byIdx[layerIdx]
    const sourceRed = style.rgb[0]
    const sourceGreen = style.rgb[1]
    const sourceBlue = style.rgb[2]
    const sourceAlpha = style.alpha / 255

    for (const inst of instances) {
      const cell = cellDefs.get(inst.cellId)
      if (!cell) {
        continue
      }

      const layer = cell.layers.find((candidate) => candidate.layerIdx === layerIdx)
      if (!layer) {
        continue
      }

      const rectView = new DataView(
        layer.packed.buffer,
        layer.packed.byteOffset,
        layer.packed.byteLength,
      )

      for (let rectIndex = 0; rectIndex < layer.rectCount; rectIndex += 1) {
        let localX: number
        let localY: number
        let localW: number
        let localH: number

        if (cell.coordBits === 0) {
          const offset = rectIndex * 8
          localX = rectView.getInt16(offset, true)
          localY = rectView.getInt16(offset + 2, true)
          localW = rectView.getInt16(offset + 4, true)
          localH = rectView.getInt16(offset + 6, true)
        } else {
          const offset = rectIndex * 16
          localX = rectView.getInt32(offset, true)
          localY = rectView.getInt32(offset + 4, true)
          localW = rectView.getInt32(offset + 8, true)
          localH = rectView.getInt32(offset + 12, true)
        }

        const worldX = inst.originX + localX
        const worldY = inst.originY + localY
        const pixelMinX = Math.floor((worldX - tileMinX) * scale)
        const pixelMinY = Math.floor((worldY - tileMinY) * scale)
        const pixelMaxX = Math.ceil((worldX + localW - tileMinX) * scale)
        const pixelMaxY = Math.ceil((worldY + localH - tileMinY) * scale)

        const startX = Math.max(0, Math.min(side, pixelMinX))
        const endX = Math.max(0, Math.min(side, pixelMaxX))
        const startY = Math.max(0, Math.min(side, pixelMinY))
        const endY = Math.max(0, Math.min(side, pixelMaxY))

        if (startX >= endX || startY >= endY) {
          continue
        }

        for (let pixelY = startY; pixelY < endY; pixelY += 1) {
          for (let pixelX = startX; pixelX < endX; pixelX += 1) {
            const pixelOffset = (pixelY * side + pixelX) * 4
            const destAlpha = pixels[pixelOffset + 3] / 255
            const outAlpha = sourceAlpha + destAlpha * (1 - sourceAlpha)

            if (outAlpha <= 0) {
              continue
            }

            const invOutAlpha = 1 / outAlpha
            pixels[pixelOffset] = Math.round(
              (sourceRed * sourceAlpha + pixels[pixelOffset] * destAlpha * (1 - sourceAlpha))
              * invOutAlpha,
            )
            pixels[pixelOffset + 1] = Math.round(
              (sourceGreen * sourceAlpha
                + pixels[pixelOffset + 1] * destAlpha * (1 - sourceAlpha))
              * invOutAlpha,
            )
            pixels[pixelOffset + 2] = Math.round(
              (sourceBlue * sourceAlpha
                + pixels[pixelOffset + 2] * destAlpha * (1 - sourceAlpha))
              * invOutAlpha,
            )
            pixels[pixelOffset + 3] = Math.round(outAlpha * 255)
          }
        }
      }
    }
  }

  return pixels
}

function parseDbuPerMicron(units: unknown): number {
  if (typeof units !== 'string') {
    return 1000
  }

  const firstPart = units.split(/\s+/u)[0]
  const parsed = Number.parseFloat(firstPart)
  if (!Number.isFinite(parsed)) {
    return 1000
  }

  return parsed >= 10 ? Math.round(parsed) : 1000
}

function sha256Tag(data: Uint8Array): string {
  return `sha256:${createHash('sha256').update(data).digest('hex')}`
}

async function writeOutputFile(path: string, content: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content)
}

export async function generateLayoutTiles(layoutJsonPath: string, outDir: string): Promise<void> {
  const rawLayout = await readFile(layoutJsonPath, 'utf8')
  const merged = asObject(JSON.parse(rawLayout), 'parse JSON')
  const dieArea = asObject(merged.diearea, 'Invalid JSON: missing diearea.path')
  const diePoints = asArray(dieArea.path, 'Invalid JSON: missing diearea.path')

  if (diePoints.length === 0) {
    throw new Error('Invalid JSON: diearea.path empty')
  }

  const layerInfoValues = asArray(merged.layerInfo, 'Invalid JSON: missing layerInfo')
  const layerInfo: Array<[number, string]> = layerInfoValues.map((layerValue) => {
    const layer = asObject(layerValue, 'layer')
    if (typeof layer.id !== 'number') {
      throw new Error('layer id')
    }

    return [layer.id, typeof layer.layername === 'string' ? layer.layername : '']
  })

  if (layerInfo.length === 0) {
    throw new Error('Invalid JSON: layerInfo empty')
  }

  const data = asArray(merged.data, 'Invalid JSON: missing data array')

  const xs: number[] = []
  const ys: number[] = []
  for (const pointValue of diePoints) {
    const point = asArray(pointValue, 'die point')
    if (point.length < 2) {
      continue
    }

    xs.push(asNumber(point[0], 'die x'))
    ys.push(asNumber(point[1], 'die y'))
  }

  const dieMinX = Math.min(...xs)
  const dieMinY = Math.min(...ys)
  const dieWidth = Math.max(...xs) - dieMinX
  const dieHeight = Math.max(...ys) - dieMinY

  const runtime = buildLayerRuntime(layerInfo)
  const dbuPerMicron = parseDbuPerMicron(merged.units)
  const designName = typeof merged['design name'] === 'string' ? merged['design name'] : 'design'
  const { rawInsts, totalBoxes } = parseSourceData(data, dieHeight, runtime)

  let minFeature = Number.POSITIVE_INFINITY
  for (const inst of rawInsts) {
    for (const rect of inst.rects) {
      const width = rect.maxX - rect.minX
      const height = rect.maxY - rect.minY
      if (width >= MIN_FEATURE_FLOOR && width < minFeature) {
        minFeature = width
      }
      if (height >= MIN_FEATURE_FLOOR && height < minFeature) {
        minFeature = height
      }
    }
  }

  if (!Number.isFinite(minFeature) || minFeature <= 0) {
    minFeature = 130
  }

  const dieMaxSide = Math.max(dieWidth, dieHeight)
  const zByFeature = Math.ceil(Math.log2(dieMaxSide / minFeature))
  const zFloor = Math.ceil(Math.log2(dieMaxSide / (minFeature * 20)))

  let zByDensity = zByFeature
  for (let z = 0; z <= zByFeature; z += 1) {
    const avgPerTile = totalBoxes / (4 ** z)
    if (avgPerTile < 10) {
      zByDensity = z
      break
    }
  }

  const maxZ = Math.min(Math.max(Math.min(zByFeature, zByDensity), zFloor), MAX_Z_HARD_CAP)

  let rasterMaxZ = 0
  for (let z = 0; z <= maxZ; z += 1) {
    const worstTile = totalBoxes / (4 ** z)
    if (worstTile > VECTOR_THRESHOLD) {
      rasterMaxZ = z
    } else {
      break
    }
  }

  const { cellDefs, cellInsts } = extractHierarchy(rawInsts)

  await mkdir(outDir, { recursive: true })

  const cellsBuffer = buildCellsBin(cellDefs)
  await writeOutputFile(join(outDir, 'cells.bin'), cellsBuffer)
  const cellsHash = sha256Tag(cellsBuffer)

  const globalBuffer = buildGlobalBin()
  await writeOutputFile(join(outDir, 'global.bin'), globalBuffer)
  const globalHash = sha256Tag(globalBuffer)

  const sortedLayerInfo = [...layerInfo].sort((left, right) => left[0] - right[0])
  const layers = sortedLayerInfo.map((layerEntry, index) => {
    const style = runtime.byIdx[index]
    return {
      id: index,
      name: style.name,
      originalLayerId: layerEntry[0],
      zOrder: style.zOrder,
      color: `#${style.rgb.map((value) => value.toString(16).padStart(2, '0')).join('')}`,
      alpha: Math.round((style.alpha / 255) * 100) / 100,
    }
  })

  const manifest: TileManifest = {
    version: 1,
    designName,
    dbuPerMicron,
    dieArea: {
      x: 0,
      y: 0,
      w: dieWidth,
      h: dieHeight,
    },
    tileConfig: {
      tilePixelSize: TILE_PIXEL_SIZE,
      minZ: 0,
      maxZ,
      rasterMaxZ,
      rasterFormat: 'png',
      vectorFormat: 'bin',
    },
    layers,
    cellsFile: {
      path: 'cells.bin',
      size: cellsBuffer.length,
      hash: cellsHash,
    },
    globalFile: {
      path: 'global.bin',
      size: globalBuffer.length,
      hash: globalHash,
    },
    stats: {
      totalInstances: cellInsts.length,
      uniqueCellTypes: cellDefs.size,
      totalBoxes,
      minFeatureDbu: minFeature,
      generatedAt: new Date().toISOString(),
    },
  }

  await writeOutputFile(
    join(outDir, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  )

  for (let z = 0; z <= maxZ; z += 1) {
    const tilesPerSide = 2 ** z
    const tileWorldSize = dieMaxSide / tilesPerSide
    const isLowZoom = z <= rasterMaxZ

    for (let tileX = 0; tileX < tilesPerSide; tileX += 1) {
      for (let tileY = 0; tileY < tilesPerSide; tileY += 1) {
        const tileMinX = tileX * tileWorldSize
        const tileMinY = tileY * tileWorldSize
        const tileMaxX = (tileX + 1) * tileWorldSize
        const tileMaxY = (tileY + 1) * tileWorldSize

        const visible = cellInsts.filter((inst) =>
          inst.originX < tileMaxX
          && inst.originX + inst.bboxW > tileMinX
          && inst.originY < tileMaxY
          && inst.originY + inst.bboxH > tileMinY,
        )

        const hasVectorContent = visible.length > 0
        if (!isLowZoom && !hasVectorContent) {
          continue
        }

        if (isLowZoom) {
          const rasterBuffer = encodePngRgba(
            renderRasterTile(
              visible,
              cellDefs,
              [tileMinX, tileMinY, tileMaxX, tileMaxY],
              tileWorldSize,
              runtime,
            ),
            TILE_PIXEL_SIZE,
            TILE_PIXEL_SIZE,
          )
          await writeOutputFile(
            join(outDir, 'tiles', 'raster', String(z), String(tileX), `${tileY}.png`),
            rasterBuffer,
          )

          if (hasVectorContent) {
            await writeOutputFile(
              join(outDir, 'tiles', 'vector', String(z), String(tileX), `${tileY}.bin`),
              buildVectorTile(visible),
            )
          }
        } else {
          await writeOutputFile(
            join(outDir, 'tiles', 'vector', String(z), String(tileX), `${tileY}.bin`),
            buildVectorTile(visible),
          )
        }
      }
    }
  }
}
