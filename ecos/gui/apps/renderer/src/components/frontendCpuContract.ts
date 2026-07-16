import type { FrontendCpuPortContract } from '@/api/frontendCatalog'

const VERILOG_IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_$]*$/
const PORT_DIRECTIONS = new Set<FrontendCpuPortContract['direction']>([
  'input',
  'output',
  'inout',
])

export function normalizeCpuPortContract(value: unknown): FrontendCpuPortContract[] {
  if (!Array.isArray(value)) return []

  const ports: FrontendCpuPortContract[] = []
  const names = new Set<string>()
  for (const rawPort of value) {
    if (!rawPort || typeof rawPort !== 'object') continue
    const record = rawPort as Record<string, unknown>
    const name = typeof record.name === 'string' ? record.name.trim() : ''
    const direction =
      typeof record.direction === 'string' ? record.direction.trim().toLowerCase() : ''
    const width = Number(record.width)
    if (
      !VERILOG_IDENTIFIER_RE.test(name) ||
      !PORT_DIRECTIONS.has(direction as FrontendCpuPortContract['direction']) ||
      !Number.isSafeInteger(width) ||
      width < 1 ||
      names.has(name)
    ) {
      continue
    }
    names.add(name)
    ports.push({
      name,
      direction: direction as FrontendCpuPortContract['direction'],
      width,
    })
  }
  return ports
}

export function formatCpuTopModule(
  moduleName: string,
  ports: FrontendCpuPortContract[],
): string {
  const normalizedName = moduleName.trim()
  if (!VERILOG_IDENTIFIER_RE.test(normalizedName) || ports.length === 0) return ''

  const declarations = ports.map((port, index) => {
    const range = port.width === 1 ? '' : ` [${port.width - 1}:0]`
    const suffix = index === ports.length - 1 ? '' : ','
    return `  ${port.direction}${range} ${port.name}${suffix}`
  })
  return `module ${normalizedName} (\n${declarations.join('\n')}\n);\n\nendmodule`
}
