export type LogLineTone = 'plain' | 'info' | 'phase' | 'success' | 'warning' | 'error'

export interface PresentedLogLine {
  number: number
  text: string
  tone: LogLineTone
}

const ERROR_PATTERN =
  /(?:%Error(?:-[A-Za-z0-9_]+)?\b|\b(?:error|fatal(?: error)?)\s*(?::|\bat\b)|^\s*(?:\[[^\]]+\]\s*)*ERROR\b|\b(?:failed|failure|mismatch|timeout|timed out|bad trap|aborted)\b|\b(?:cannot|can't)\s+(?:open|load|find|read|build|compile|link|execute)\b|\bnot found\b|\bmissing (?:file|image|symbol|reference)\b|\b[1-9]\d*\s+(?:errors?|failures?|mismatches?)\b|\b(?:errors?|failures?|mismatches?)\s*[:=]\s*[1-9]\d*\b|\b(?:exit(?:ed)? with (?:code|status)|return code)\s+[1-9]\d*\b)/i

const WARNING_PATTERN =
  /(?:%Warning(?:-[A-Za-z0-9_]+)?\b|\bwarning\s*:|^\s*(?:\[[^\]]+\]\s*)*WARN(?:ING)?\b|\b[1-9]\d*\s+warnings?\b|\bwarnings?\s*[:=]\s*[1-9]\d*\b)/i

const SUCCESS_PATTERN =
  /(?:\b(?:pass|passed|success|successful|successfully|completed|finished|good trap)\b|\[(?:pass|passed|success|ok)\]|\b(?:no|0)\s+(?:errors?|failures?|mismatches?)\b|\b(?:errors?|failures?|mismatches?)\s*[:=]\s*0\b|\b0\s+failed\b|\bfailed\s*[:=]\s*0\b)/i

const INFO_PATTERN = /^\s*(?:\[[^\]]+\]\s*)*(?:info|debug|trace)\b/i

const PHASE_PATTERN =
  /^\s*(?:\[[^\]]+\](?:\[[^\]]+\])*\s*|[-=]{3,}\s*|[$>]\s+|(?:running|building|compiling|linking|executing|loading|starting)\b)/i

const ANSI_CSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, 'g')

export function normalizeLogContent(content: string): string {
  return content.replace(ANSI_CSI_PATTERN, '').replace(/\r\n?/g, '\n')
}

export function presentLog(content: string): PresentedLogLine[] {
  return normalizeLogContent(content).split('\n').map(presentLogLine)
}

function presentLogLine(text: string, index: number): PresentedLogLine {
  return {
    number: index + 1,
    text,
    tone: logLineTone(text),
  }
}

function logLineTone(text: string): LogLineTone {
  const issueText = text
    .replace(/\b(?:no|0)\s+(?:errors?|failures?|mismatches?|warnings?)\b/gi, '')
    .replace(/\b(?:errors?|failures?|mismatches?|warnings?)\s*[:=]\s*0\b/gi, '')
    .replace(/\b0\s+failed\b/gi, '')
    .replace(/\bfailed\s*[:=]\s*0\b/gi, '')

  if (ERROR_PATTERN.test(issueText)) return 'error'
  if (WARNING_PATTERN.test(issueText)) return 'warning'
  if (SUCCESS_PATTERN.test(text)) return 'success'
  if (INFO_PATTERN.test(text)) return 'info'
  if (PHASE_PATTERN.test(text)) return 'phase'
  return 'plain'
}
