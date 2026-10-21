import type { FlowTopology } from './flowTopology'

export const FLOW_CARD = { width: 156, height: 164 } as const
const GAP = { x: 32, y: 18 }
const PADDING = 16

export function flowGraphLayout(topology: FlowTopology) {
  return {
    positions: new Map(
      topology.nodes.map((node) => [
        node.id,
        {
          x: PADDING + node.column * (FLOW_CARD.width + GAP.x),
          y: PADDING + node.row * (FLOW_CARD.height + GAP.y),
        },
      ]),
    ),
    width:
      PADDING * 2 +
      Math.max(0, topology.columns - 1) * (FLOW_CARD.width + GAP.x) +
      FLOW_CARD.width,
    height:
      PADDING * 2 +
      Math.max(0, topology.rows - 1) * (FLOW_CARD.height + GAP.y) +
      FLOW_CARD.height,
  }
}
