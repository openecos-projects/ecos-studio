import { ref } from 'vue'
import type { PdkRequirement } from '@ecos-studio/shared'

/**
 * PDK fields the wizard owns across a project manifest generation. The
 * baseline records the applied state; a new generation clears exactly those
 * fields, so user-entered values (which no longer match the baseline) are
 * preserved.
 */
export interface ProjectPdkGenerationAccessors {
  getPdk(): string | undefined
  setPdk(value: string | undefined): void
  getPdkRoot(): string | undefined
  setPdkRoot(value: string | undefined): void
  getPdkRequirement(): PdkRequirement | undefined
  setPdkRequirement(value: PdkRequirement | undefined): void
  getPdkInstallationId(): string | undefined
  setPdkInstallationId(value: string | undefined): void
  getSelectedPdkId(): string
  setSelectedPdkId(value: string): void
  getPdkSelections(): Record<string, string[]>
  getPdkConfigMode(): string
  setPdkConfigMode(value: 'default' | 'manual'): void
  clearPdkSelections(): void
}

export function useProjectPdkGeneration(accessors: ProjectPdkGenerationAccessors) {
  /** PDK family carried by the project manifest (explicit information). */
  const manifestPdkFamily = ref('')
  /** Baseline PDK state owned by the current manifest generation. */
  const pdkBaseline = ref<{
    pdk: string | null
    pdkInstallationId: string | null
    pdkRequirement: PdkRequirement | null
    pdkRoot: string | null
    selectedPdkId: string | null
    pdkSelections: string
    pdkConfigMode: string
  } | null>(null)
  /** Manifest generation the PDK selection last resolved against. */
  const pdkResolvedForGeneration = ref(-1)

  /**
   * Snapshot of every PDK field the current manifest generation owns. A new
   * generation clears exactly these fields, so user-entered values (which no
   * longer match the baseline) are preserved.
   */
  function snapshotPdkBaseline(): void {
    pdkBaseline.value = {
      pdk: accessors.getPdk() ?? null,
      pdkInstallationId: accessors.getPdkInstallationId() ?? null,
      pdkRequirement: accessors.getPdkRequirement() ?? null,
      pdkRoot: accessors.getPdkRoot() ?? null,
      selectedPdkId: accessors.getSelectedPdkId() || null,
      pdkSelections: JSON.stringify(accessors.getPdkSelections()),
      pdkConfigMode: accessors.getPdkConfigMode(),
    }
  }

  /**
   * Remove manifest-derived PDK values (tracked snapshots) from the config,
   * leaving any values the user entered themselves untouched.
   */
  function clearPreviousGenerationPdkState(): void {
    const baseline = pdkBaseline.value
    if (!baseline) return
    if (baseline.pdk !== null && accessors.getPdk() === baseline.pdk) {
      accessors.setPdk('')
    }
    if (
      baseline.pdkInstallationId !== null &&
      accessors.getPdkInstallationId() === baseline.pdkInstallationId
    ) {
      accessors.setPdkInstallationId('')
    }
    if (
      baseline.pdkRequirement !== null &&
      JSON.stringify(accessors.getPdkRequirement() ?? null) ===
        JSON.stringify(baseline.pdkRequirement)
    ) {
      accessors.setPdkRequirement(undefined)
    }
    if (baseline.pdkRoot !== null && accessors.getPdkRoot() === baseline.pdkRoot) {
      accessors.setPdkRoot('')
    }
    if (
      baseline.selectedPdkId !== null &&
      accessors.getSelectedPdkId() === baseline.selectedPdkId
    ) {
      accessors.setSelectedPdkId('')
    }
    if (
      baseline.pdkSelections !== undefined &&
      JSON.stringify(accessors.getPdkSelections()) === baseline.pdkSelections
    ) {
      accessors.clearPdkSelections()
    }
    if (
      accessors.getPdkConfigMode() === (baseline.pdkConfigMode as 'default' | 'manual')
    ) {
      accessors.setPdkConfigMode('default')
    }
    manifestPdkFamily.value = ''
    pdkBaseline.value = null
  }

  return {
    clearPreviousGenerationPdkState,
    manifestPdkFamily,
    pdkBaseline,
    pdkResolvedForGeneration,
    snapshotPdkBaseline,
  }
}
