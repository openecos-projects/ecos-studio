import { MONACO_DISASSEMBLY_LANGUAGE_ID } from './monacoLanguageIds'

export type FrontendSourceLanguage =
  | 'c'
  | 'cpp'
  | typeof MONACO_DISASSEMBLY_LANGUAGE_ID
  | 'plaintext'
  | 'python'
  | 'shell'
  | 'systemverilog'
  | 'tcl'
  | 'verilog'

const SOURCE_LANGUAGE_BY_EXTENSION: Record<string, FrontendSourceLanguage> = {
  bash: 'shell',
  asm: MONACO_DISASSEMBLY_LANGUAGE_ID,
  c: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  cxx: 'cpp',
  h: 'c',
  hh: 'cpp',
  hpp: 'cpp',
  hxx: 'cpp',
  py: 'python',
  pyw: 'python',
  s: MONACO_DISASSEMBLY_LANGUAGE_ID,
  sh: 'shell',
  sv: 'systemverilog',
  svh: 'systemverilog',
  tcl: 'tcl',
  v: 'verilog',
  vh: 'verilog',
  zsh: 'shell',
}

export function frontendSourceLanguageForPath(path: string): FrontendSourceLanguage {
  const normalizedPath = String(path || '')
    .trim()
    .split(/[?#]/, 1)[0]
    .toLowerCase()
  const fileName = normalizedPath.split(/[\\/]/).pop() || ''
  const extension = fileName.includes('.') ? fileName.split('.').pop() || '' : ''
  return SOURCE_LANGUAGE_BY_EXTENSION[extension] || 'plaintext'
}
