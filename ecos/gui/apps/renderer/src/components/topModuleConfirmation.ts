import { isVerilogIdentifier } from '@ecos-studio/shared'
import type { HdlModuleDiscoveryResult } from '@ecos-studio/shared'

export function designInputFingerprint(input: {
  filelist: string
  originVerilog: string
  rtlList: string[]
  startsFromSynthesis: boolean
}): string {
  if (input.startsFromSynthesis) {
    return `rtl:${[...input.rtlList].sort().join('|')}|filelist:${input.filelist.trim()}`
  }
  return `verilog:${input.originVerilog.trim()}`
}

export function exclusiveRtlFilelistPrefill(
  rtlList: string[],
  filelist: string,
): { filelist: string; rtlList: string[] } {
  const trimmedFilelist = filelist.trim()
  if (trimmedFilelist) {
    return { filelist: trimmedFilelist, rtlList: [] }
  }
  return { filelist: '', rtlList }
}

export function exclusiveDesignFilesReady(rtlList: string[], filelist: string): boolean {
  const hasRtl = rtlList.length > 0
  const hasFilelist = filelist.trim() !== ''
  return hasRtl !== hasFilelist
}

export function orderTopModuleCandidates(
  candidates: string[],
  suggested: string,
): string[] {
  if (!suggested || !candidates.includes(suggested)) return [...candidates]
  return [suggested, ...candidates.filter((name) => name !== suggested)]
}

export function nextTopModuleSelection(input: {
  currentValue: string
  designNameChanged: boolean
  pathsChanged: boolean
  previousSuggested: string
  result: HdlModuleDiscoveryResult
  seenDropdown: boolean
  userPickedOther: boolean
}): string {
  const currentValue = input.currentValue.trim()
  if (input.result.status !== 'complete' || input.result.candidates.length === 0) {
    if (
      input.result.status === 'incomplete' ||
      input.result.status === 'total_read_failure'
    ) {
      return currentValue
    }
    return ''
  }

  if (!input.seenDropdown) return input.result.suggested
  if (input.pathsChanged) {
    return input.result.candidates.includes(currentValue)
      ? currentValue
      : input.result.suggested
  }
  if (
    input.designNameChanged &&
    !input.userPickedOther &&
    currentValue === input.previousSuggested
  ) {
    return input.result.suggested
  }
  if (input.result.candidates.includes(currentValue)) return currentValue
  return input.result.suggested
}

export function canSubmitTopModule(
  result: HdlModuleDiscoveryResult | null,
  value: string,
  options: { readOnlyCommitted?: boolean } = {},
): boolean {
  const trimmed = value.trim()
  if (options.readOnlyCommitted) return trimmed.length > 0
  if (!result) return false
  if (result.status === 'complete') {
    return result.candidates.includes(trimmed)
  }
  if (result.status === 'incomplete' || result.status === 'total_read_failure') {
    return isVerilogIdentifier(trimmed)
  }
  return false
}

export function topModuleBlockedReason(result: HdlModuleDiscoveryResult | null): string {
  if (!result) return 'Discovering modules from the selected HDL...'
  if (result.status === 'complete' && result.candidates.length === 0) {
    return 'No module declarations were found. Return to Design Files and add HDL that declares a module.'
  }
  if (result.status === 'partial_read_failure') {
    return (
      result.reason ||
      'One or more selected HDL files could not be read. Return to Design Files.'
    )
  }
  if (result.status === 'incomplete' || result.status === 'total_read_failure') {
    return result.reason || 'HDL discovery could not finish. Enter a Verilog identifier.'
  }
  return ''
}
