import type { FrontendCpuPortContract } from '@/api/frontendCatalog'

const VERILOG_IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_$]*$/
const SYSTEMVERILOG_RESERVED_WORDS = new Set(
  [
    'accept_on alias always always_comb always_ff always_latch and assert assign assume automatic before begin bind bins binsof bit break buf bufif0 bufif1 byte',
    'case casex casez cell chandle checker class clocking cmos config const constraint context continue cover covergroup coverpoint cross',
    'deassign default defparam design disable dist do edge else end endchecker endclass endclocking endconfig endfunction endgenerate endgroup endinterface endmodule endpackage endprimitive endprogram endproperty endspecify endsequence endtable endtask',
    'enum event eventually expect export extends extern final first_match for force foreach forever fork forkjoin function generate genvar global highz0 highz1 if iff ifnone ignore_bins illegal_bins implements implies import incdir include initial inout input inside int integer interconnect intersect',
    'join join_any join_none large let liblist library local localparam logic longint macromodule matches medium modport module nand negedge nettype new nexttime nmos nor noshowcancelled not notif0 notif1 null or output package packed parameter pmos posedge primitive priority program property protected pull0 pull1 pulldown pullup pulsestyle_ondetect pulsestyle_onevent pure',
    'rand randc randcase randsequence rcmos real realtime ref reg reject_on release repeat restrict return rnmos rpmos rtran rtranif0 rtranif1 s_always s_eventually s_nexttime s_until s_until_with scalared sequence shortint shortreal showcancelled signed small solve specify specparam static string strong strong0 strong1 struct super supply0 supply1 sync_accept_on sync_reject_on',
    'table tagged task this throughout time timeprecision timeunit tran tranif0 tranif1 tri tri0 tri1 triand trior trireg type typedef union unique unique0 unsigned until until_with untyped use uwire var vectored virtual void wait wait_order wand weak weak0 weak1 while wildcard wire with within wor xnor xor',
  ].flatMap((group) => group.split(' ')),
)
const PORT_DIRECTIONS = new Set<FrontendCpuPortContract['direction']>([
  'input',
  'output',
  'inout',
])

export const YSYX_BLACKBOX_CPU_PORT_CONTRACT: FrontendCpuPortContract[] = [
  { name: 'clock', direction: 'input', width: 1 },
  { name: 'reset', direction: 'input', width: 1 },
  { name: 'io_interrupt', direction: 'input', width: 1 },
  { name: 'io_master_awready', direction: 'input', width: 1 },
  { name: 'io_master_awvalid', direction: 'output', width: 1 },
  { name: 'io_master_awid', direction: 'output', width: 4 },
  { name: 'io_master_awaddr', direction: 'output', width: 32 },
  { name: 'io_master_awlen', direction: 'output', width: 8 },
  { name: 'io_master_awsize', direction: 'output', width: 3 },
  { name: 'io_master_awburst', direction: 'output', width: 2 },
  { name: 'io_master_wready', direction: 'input', width: 1 },
  { name: 'io_master_wvalid', direction: 'output', width: 1 },
  { name: 'io_master_wdata', direction: 'output', width: 32 },
  { name: 'io_master_wstrb', direction: 'output', width: 4 },
  { name: 'io_master_wlast', direction: 'output', width: 1 },
  { name: 'io_master_bready', direction: 'output', width: 1 },
  { name: 'io_master_bvalid', direction: 'input', width: 1 },
  { name: 'io_master_bid', direction: 'input', width: 4 },
  { name: 'io_master_bresp', direction: 'input', width: 2 },
  { name: 'io_master_arready', direction: 'input', width: 1 },
  { name: 'io_master_arvalid', direction: 'output', width: 1 },
  { name: 'io_master_arid', direction: 'output', width: 4 },
  { name: 'io_master_araddr', direction: 'output', width: 32 },
  { name: 'io_master_arlen', direction: 'output', width: 8 },
  { name: 'io_master_arsize', direction: 'output', width: 3 },
  { name: 'io_master_arburst', direction: 'output', width: 2 },
  { name: 'io_master_rready', direction: 'output', width: 1 },
  { name: 'io_master_rvalid', direction: 'input', width: 1 },
  { name: 'io_master_rid', direction: 'input', width: 4 },
  { name: 'io_master_rdata', direction: 'input', width: 32 },
  { name: 'io_master_rresp', direction: 'input', width: 2 },
  { name: 'io_master_rlast', direction: 'input', width: 1 },
  { name: 'io_slave_awready', direction: 'output', width: 1 },
  { name: 'io_slave_awvalid', direction: 'input', width: 1 },
  { name: 'io_slave_awid', direction: 'input', width: 4 },
  { name: 'io_slave_awaddr', direction: 'input', width: 32 },
  { name: 'io_slave_awlen', direction: 'input', width: 8 },
  { name: 'io_slave_awsize', direction: 'input', width: 3 },
  { name: 'io_slave_awburst', direction: 'input', width: 2 },
  { name: 'io_slave_wready', direction: 'output', width: 1 },
  { name: 'io_slave_wvalid', direction: 'input', width: 1 },
  { name: 'io_slave_wdata', direction: 'input', width: 32 },
  { name: 'io_slave_wstrb', direction: 'input', width: 4 },
  { name: 'io_slave_wlast', direction: 'input', width: 1 },
  { name: 'io_slave_bready', direction: 'input', width: 1 },
  { name: 'io_slave_bvalid', direction: 'output', width: 1 },
  { name: 'io_slave_bid', direction: 'output', width: 4 },
  { name: 'io_slave_bresp', direction: 'output', width: 2 },
  { name: 'io_slave_arready', direction: 'output', width: 1 },
  { name: 'io_slave_arvalid', direction: 'input', width: 1 },
  { name: 'io_slave_arid', direction: 'input', width: 4 },
  { name: 'io_slave_araddr', direction: 'input', width: 32 },
  { name: 'io_slave_arlen', direction: 'input', width: 8 },
  { name: 'io_slave_arsize', direction: 'input', width: 3 },
  { name: 'io_slave_arburst', direction: 'input', width: 2 },
  { name: 'io_slave_rready', direction: 'input', width: 1 },
  { name: 'io_slave_rvalid', direction: 'output', width: 1 },
  { name: 'io_slave_rid', direction: 'output', width: 4 },
  { name: 'io_slave_rdata', direction: 'output', width: 32 },
  { name: 'io_slave_rresp', direction: 'output', width: 2 },
  { name: 'io_slave_rlast', direction: 'output', width: 1 },
]

export function isVerilogIdentifier(value: string): boolean {
  const normalized = value.trim()
  return (
    VERILOG_IDENTIFIER_RE.test(normalized) &&
    !SYSTEMVERILOG_RESERVED_WORDS.has(normalized)
  )
}

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
  if (!isVerilogIdentifier(normalizedName) || ports.length === 0) return ''

  const declarations = ports.map((port, index) => {
    const range = port.width === 1 ? '' : ` [${port.width - 1}:0]`
    const suffix = index === ports.length - 1 ? '' : ','
    return `  ${port.direction}${range} ${port.name}${suffix}`
  })
  return `module ${normalizedName} (\n${declarations.join('\n')}\n);\n\nendmodule`
}
