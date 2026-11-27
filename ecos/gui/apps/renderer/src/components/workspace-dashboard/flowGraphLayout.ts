import type { FlowTopology } from './flowTopology'

export const FLOW_CARD = { width: 156, height: 164 } as const
export const FLOW_GAP = { x: 44, y: 24 } as const
const PADDING = 16

export function flowGraphLayout(topology: FlowTopology) {
  const topPadding = PADDING + (topology.parallelGroups.length ? 16 : 0)
  return {
    positions: new Map(
      topology.nodes.map((node) => [
        node.id,
        {
          x: PADDING + node.column * (FLOW_CARD.width + FLOW_GAP.x),
          y: topPadding + node.row * (FLOW_CARD.height + FLOW_GAP.y),
        },
      ]),
    ),
    width:
      PADDING * 2 +
      Math.max(0, topology.columns - 1) * (FLOW_CARD.width + FLOW_GAP.x) +
      FLOW_CARD.width,
    height:
      PADDING +
      topPadding +
      Math.max(0, topology.rows - 1) * (FLOW_CARD.height + FLOW_GAP.y) +
      FLOW_CARD.height,
  }
}
