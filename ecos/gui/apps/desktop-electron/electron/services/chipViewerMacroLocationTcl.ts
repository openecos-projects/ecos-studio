/**
 * macro_location.tcl parsing for the layout edit save writeback.
 *
 * ECC writes the manual macro-placement handoff with saveMacroTCL()
 * (`placeInstance` + `setInstancePlacementStatus` pairs, micrometers,
 * R-notation orientations). After a macro-placement save publishes the
 * layout, ECOS Studio re-records those placements as the
 * `macro.placements` workspace parameter so parameters stay the single
 * source of truth and macroPlacement skips DreamPlace.
 */

/** R-notation orientations shared with the ECC place_instance operation. */
const R_ORIENTATIONS = new Set(['R0', 'R90', 'R180', 'R270', 'MX', 'MY', 'MX90', 'MY90'])

export interface MacroPlacementEntry {
  instance: string
  orientation: string
  x: number
  y: number
}

/**
 * Parses the ECC-generated macro location handoff into `macro.placements`
 * entries. Comment, blank, and `setInstancePlacementStatus` lines are
 * skipped; any other malformed line fails loudly so a partial writeback is
 * never silently recorded.
 */
export function parseMacroLocationTcl(text: string): MacroPlacementEntry[] {
  const entries: MacroPlacementEntry[] = []
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (
      !trimmed ||
      trimmed.startsWith('#') ||
      trimmed.startsWith('setInstancePlacementStatus')
    ) {
      continue
    }
    const tokens = trimmed.split(/\s+/)
    if (tokens[0] !== 'placeInstance' || tokens.length !== 5) {
      throw new Error(`macro location: unsupported statement: ${trimmed}`)
    }
    const x = Number(tokens[2])
    const y = Number(tokens[3])
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error(`macro location: non-finite coordinates: ${trimmed}`)
    }
    if (!R_ORIENTATIONS.has(tokens[4])) {
      throw new Error(`macro location: unknown orientation: ${trimmed}`)
    }
    if (!tokens[1].trim()) {
      throw new Error(`macro location: empty instance name: ${trimmed}`)
    }
    entries.push({ instance: tokens[1], orientation: tokens[4], x, y })
  }
  return entries
}
