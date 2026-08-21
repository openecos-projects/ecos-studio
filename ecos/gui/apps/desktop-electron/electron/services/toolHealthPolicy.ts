export type ToolHealthMarkerKind = 'exists' | 'executable'

export interface ToolHealthMarker {
  path: string
  kind: ToolHealthMarkerKind
}

function exists(path: string): ToolHealthMarker {
  return { path, kind: 'exists' }
}

function executable(path: string): ToolHealthMarker {
  return { path, kind: 'executable' }
}

const TOOL_HEALTH_POLICIES: Readonly<Record<string, readonly ToolHealthMarker[]>> = {
  verilator: [
    executable('bin/verilator'),
    executable('bin/verilator_bin'),
    exists('share/verilator/include/verilated.cpp'),
  ],
  'riscv-toolchain': [
    executable('bin/riscv64-unknown-elf-gcc'),
    executable('bin/riscv64-unknown-elf-ld'),
    executable('bin/riscv64-unknown-elf-objdump'),
    executable('bin/riscv64-unknown-elf-objcopy'),
  ],
  'ecc-fe': [executable('bin/ecc-fe'), exists('fecompiler')],
  'ecc-fe-soc-ysyx-am': [
    exists('manifest.json'),
    exists('catalog.json'),
    exists('filelist.soc.f'),
    exists('driver/main.cpp'),
  ],
  'ecc-fe-cpu-rtl': [
    exists('thirdparty/README'),
    exists('thirdparty/cv32e40p'),
    exists('thirdparty/cva6'),
    exists('thirdparty/darkriscv'),
    exists('thirdparty/ibex'),
    exists('thirdparty/learn-fpga'),
    exists('thirdparty/picorv32'),
    exists('thirdparty/scr1'),
    exists('thirdparty/serv'),
    exists('thirdparty/vexriscv'),
  ],
  'ecc-fe-difftest-ref': [exists('tools/riscv32-spike-so')],
  'ecc-fe-examples': [
    exists('examples/ysyx_00000000/filelist.cpu.f'),
    exists('examples/ysyx_00000000/rtl/ysyx_00000000.sv'),
    exists('examples/ysyx_00000000/rtl/ysyx_00000000_difftest.sv'),
  ],
  surfer: [
    exists('index.html'),
    exists('integration.js'),
    exists('surfer.js'),
    exists('surfer_bg.wasm'),
  ],
}

export function requiredToolHealthMarkers(
  normalizedName: string,
): readonly ToolHealthMarker[] {
  if (normalizedName.startsWith('ecc-fe-cpu-')) {
    return normalizedName === 'ecc-fe-cpu-rtl'
      ? TOOL_HEALTH_POLICIES['ecc-fe-cpu-rtl']
      : [exists('thirdparty')]
  }
  if (normalizedName.startsWith('ecc-fe-test-')) return [exists('tests')]
  return TOOL_HEALTH_POLICIES[normalizedName] ?? []
}
