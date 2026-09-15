const VERILOG_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$]*$/

export function isVerilogIdentifier(value: string): boolean {
  return VERILOG_IDENTIFIER.test(value.trim())
}
