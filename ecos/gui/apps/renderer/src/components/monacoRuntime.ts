import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js'
import 'monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution'
import 'monaco-editor/esm/vs/basic-languages/python/python.contribution'
import 'monaco-editor/esm/vs/basic-languages/shell/shell.contribution'
import 'monaco-editor/esm/vs/basic-languages/systemverilog/systemverilog.contribution'
import 'monaco-editor/esm/vs/basic-languages/tcl/tcl.contribution'
import 'monaco-editor/esm/vs/editor/contrib/bracketMatching/browser/bracketMatching'
import 'monaco-editor/esm/vs/editor/contrib/clipboard/browser/clipboard'
import 'monaco-editor/esm/vs/editor/contrib/comment/browser/comment'
import 'monaco-editor/esm/vs/editor/contrib/contextmenu/browser/contextmenu'
import 'monaco-editor/esm/vs/editor/contrib/find/browser/findController'
import 'monaco-editor/esm/vs/editor/contrib/folding/browser/folding'
import 'monaco-editor/esm/vs/editor/contrib/gotoError/browser/gotoError'
import 'monaco-editor/esm/vs/editor/contrib/hover/browser/hoverContribution'
import 'monaco-editor/esm/vs/editor/contrib/indentation/browser/indentation'
import 'monaco-editor/esm/vs/editor/contrib/lineSelection/browser/lineSelection'
import 'monaco-editor/esm/vs/editor/contrib/linesOperations/browser/linesOperations'
import 'monaco-editor/esm/vs/editor/contrib/links/browser/links'
import 'monaco-editor/esm/vs/editor/contrib/multicursor/browser/multicursor'
import 'monaco-editor/esm/vs/editor/contrib/readOnlyMessage/browser/contribution'
import 'monaco-editor/esm/vs/editor/contrib/wordOperations/browser/wordOperations'
import 'monaco-editor/esm/vs/editor/contrib/wordPartOperations/browser/wordPartOperations'
import './monacoWidgetLayer.css'
import {
  MONACO_DISASSEMBLY_LANGUAGE_ID,
  MONACO_LOG_LANGUAGE_ID,
} from './monacoLanguageIds'

export { MONACO_DISASSEMBLY_LANGUAGE_ID, MONACO_LOG_LANGUAGE_ID }

export type MonacoTheme = 'light' | 'dark'

const LIGHT_THEME_ID = 'ecos-light'
const DARK_THEME_ID = 'ecos-dark'

let customLanguagesRegistered = false
let themesDefined = false
let workerConfigured = false
let editorSequence = 0

export function nextMonacoEditorId(): number {
  editorSequence += 1
  return editorSequence
}

export function getMonacoRuntime(theme: MonacoTheme): typeof monaco {
  configureEditorWorker()
  registerCustomLanguages()
  defineThemes()
  setMonacoTheme(theme)
  return monaco
}

export function setMonacoTheme(theme: MonacoTheme): void {
  monaco.editor.setTheme(theme === 'dark' ? DARK_THEME_ID : LIGHT_THEME_ID)
}

function configureEditorWorker(): void {
  if (workerConfigured) return
  const scope = globalThis as typeof globalThis & {
    MonacoEnvironment?: {
      getWorker?: (workerId: string, label: string) => Worker
    }
  }
  if (!scope.MonacoEnvironment?.getWorker) {
    scope.MonacoEnvironment = {
      ...scope.MonacoEnvironment,
      getWorker: () => new EditorWorker(),
    }
  }
  workerConfigured = true
}

function registerCustomLanguages(): void {
  if (customLanguagesRegistered) return
  registerLogLanguage()
  registerDisassemblyLanguage()
  customLanguagesRegistered = true
}

function registerLogLanguage(): void {
  registerLanguage(MONACO_LOG_LANGUAGE_ID)
  monaco.languages.setMonarchTokensProvider(MONACO_LOG_LANGUAGE_ID, {
    ignoreCase: true,
    tokenizer: {
      root: [
        [/^\s*\d{2}:\d{2}:\d{2}(?:\.\d+)?/, 'log.timestamp'],
        [/^\s*(?:\[[^\]]+\])+/, 'log.scope'],
        [
          /%Error(?:-[A-Za-z0-9_]+)?\b|\b(?:ERROR|FATAL|FAILED|FAILURE|MISMATCH|TIMEOUT)\b/,
          'log.error',
        ],
        [/%Warning(?:-[A-Za-z0-9_]+)?\b|\bWARN(?:ING)?\b/, 'log.warning'],
        [
          /\b(?:PASS|PASSED|SUCCESS|SUCCESSFUL|COMPLETED|FINISHED|GOOD TRAP)\b/,
          'log.success',
        ],
        [/\b(?:INFO|DEBUG|TRACE)\b/, 'log.info'],
        [
          /\b(?:RUNNING|BUILDING|COMPILING|LINKING|EXECUTING|LOADING|STARTING)\b/,
          'log.phase',
        ],
        [/(?:\/[A-Za-z0-9_.@+~-]+)+(?:\.[A-Za-z0-9_+-]+)?/, 'log.path'],
        [/[A-Za-z]:\\(?:[^\s:]+\\)*[^\s:]+/, 'log.path'],
        [/\b0x[0-9a-f]+\b/, 'number.hex'],
        [/\b\d+(?:\.\d+)?\b/, 'number'],
      ],
    },
  })
}

function registerDisassemblyLanguage(): void {
  registerLanguage(MONACO_DISASSEMBLY_LANGUAGE_ID)
  monaco.languages.setMonarchTokensProvider(MONACO_DISASSEMBLY_LANGUAGE_ID, {
    ignoreCase: true,
    tokenizer: {
      root: [
        [/^\s*[0-9a-f]+:/, 'disassembly.address'],
        [/<[^>]+>/, 'disassembly.symbol'],
        [/\b[0-9a-f]{8}\b/, 'disassembly.opcode'],
        [
          /\b(?:add|addi|and|andi|auipc|beq|beqz|bge|bgeu|bgez|bgtz|blez|blt|bltu|bltz|bnez|call|csrr|csrrc|csrrci|csrrs|csrrsi|csrrw|csrrwi|div|divu|ebreak|ecall|fence|j|jal|jalr|jr|la|lb|lbu|lh|lhu|li|lw|lui|mv|mul|mulh|mulhsu|mulhu|neg|nop|not|or|ori|rem|remu|ret|sb|seqz|sh|sll|slli|slt|slti|sltiu|sltu|snez|sra|srai|srl|srli|sub|sw|tail|wfi|xor|xori)\b/,
          'disassembly.mnemonic',
        ],
        [
          /\b(?:zero|ra|sp|gp|tp|t[0-6]|s(?:[0-9]|1[01])|a[0-7]|fp|x(?:[0-9]|[12][0-9]|3[01])|pc)\b/,
          'disassembly.register',
        ],
        [/\b(?:0x)?[0-9a-f]+\b/, 'number.hex'],
        [/#.*$/, 'comment'],
        [
          /^\s*(?:Disassembly of section|[^:]+:\s+file format)\b.*$/,
          'disassembly.header',
        ],
      ],
    },
  })
}

function registerLanguage(languageId: string): void {
  if (!monaco.languages.getLanguages().some((language) => language.id === languageId)) {
    monaco.languages.register({ id: languageId })
  }
}

function defineThemes(): void {
  if (themesDefined) return
  monaco.editor.defineTheme(LIGHT_THEME_ID, {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'log.timestamp', foreground: '7A858D' },
      { token: 'log.scope', foreground: '2679B9' },
      { token: 'log.error', foreground: 'BE3B36', fontStyle: 'bold' },
      { token: 'log.warning', foreground: 'B76B08', fontStyle: 'bold' },
      { token: 'log.success', foreground: '07866F', fontStyle: 'bold' },
      { token: 'log.info', foreground: '2679B9' },
      { token: 'log.phase', foreground: '009C83', fontStyle: 'bold' },
      { token: 'log.path', foreground: '0F766E' },
      { token: 'disassembly.address', foreground: '8A5A00' },
      { token: 'disassembly.opcode', foreground: '7A858D' },
      { token: 'disassembly.mnemonic', foreground: '005CC5', fontStyle: 'bold' },
      { token: 'disassembly.register', foreground: '7C3AED' },
      { token: 'disassembly.symbol', foreground: '0F766E' },
      { token: 'disassembly.header', foreground: '2679B9', fontStyle: 'bold' },
      { token: 'number', foreground: '8A5A00' },
      { token: 'number.hex', foreground: '8A5A00' },
    ],
    colors: lightThemeColors(),
  })

  monaco.editor.defineTheme(DARK_THEME_ID, {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'log.timestamp', foreground: '8B949E' },
      { token: 'log.scope', foreground: '60A5FA' },
      { token: 'log.error', foreground: 'F87171', fontStyle: 'bold' },
      { token: 'log.warning', foreground: 'FBBF24', fontStyle: 'bold' },
      { token: 'log.success', foreground: '34D399', fontStyle: 'bold' },
      { token: 'log.info', foreground: '60A5FA' },
      { token: 'log.phase', foreground: '00BFA5', fontStyle: 'bold' },
      { token: 'log.path', foreground: '5EEAD4' },
      { token: 'disassembly.address', foreground: 'D7BA7D' },
      { token: 'disassembly.opcode', foreground: '8B949E' },
      { token: 'disassembly.mnemonic', foreground: '569CD6', fontStyle: 'bold' },
      { token: 'disassembly.register', foreground: 'C586C0' },
      { token: 'disassembly.symbol', foreground: '4EC9B0' },
      { token: 'disassembly.header', foreground: '60A5FA', fontStyle: 'bold' },
      { token: 'number', foreground: 'D7BA7D' },
      { token: 'number.hex', foreground: 'D7BA7D' },
    ],
    colors: darkThemeColors(),
  })
  themesDefined = true
}

function lightThemeColors(): monaco.editor.IColors {
  return {
    'editor.background': '#FDFDFC',
    'editor.foreground': '#20292F',
    'editorLineNumber.foreground': '#8A949B',
    'editorLineNumber.activeForeground': '#35424B',
    'editorGutter.background': '#F4F6F6',
    'editor.lineHighlightBackground': '#F1F5F4',
    'editor.selectionBackground': '#B9E6DE',
    'editor.inactiveSelectionBackground': '#DCEFEB',
    'editor.findMatchBackground': '#E7C86799',
    'editor.findMatchHighlightBackground': '#E7C86755',
    'editorWidget.background': '#F4F6F6',
    'editorWidget.border': '#D9E0E0',
    'input.background': '#FDFDFC',
    'input.foreground': '#20292F',
    'input.border': '#D9E0E0',
    'scrollbarSlider.background': '#5D69722E',
    'scrollbarSlider.hoverBackground': '#5D69725C',
    'scrollbarSlider.activeBackground': '#5D697275',
  }
}

function darkThemeColors(): monaco.editor.IColors {
  return {
    'editor.background': '#18181C',
    'editor.foreground': '#E3E3E8',
    'editorLineNumber.foreground': '#71717A',
    'editorLineNumber.activeForeground': '#E3E3E8',
    'editorGutter.background': '#222226',
    'editor.lineHighlightBackground': '#222226',
    'editor.selectionBackground': '#155E7580',
    'editor.inactiveSelectionBackground': '#164E6355',
    'editor.findMatchBackground': '#E2A81788',
    'editor.findMatchHighlightBackground': '#E2A81744',
    'editorWidget.background': '#222226',
    'editorWidget.border': '#52525B',
    'input.background': '#18181C',
    'input.foreground': '#E3E3E8',
    'input.border': '#52525B',
    'scrollbarSlider.background': '#A1A1AA2E',
    'scrollbarSlider.hoverBackground': '#A1A1AA5C',
    'scrollbarSlider.activeBackground': '#A1A1AA75',
  }
}
