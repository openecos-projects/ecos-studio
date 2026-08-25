export type ToolHealthMarkerKind = 'file' | 'directory' | 'executable'

export interface ToolHealthMarker {
  path: string
  kind: ToolHealthMarkerKind
}

function file(path: string): ToolHealthMarker {
  return { path, kind: 'file' }
}

function directory(path: string): ToolHealthMarker {
  return { path, kind: 'directory' }
}

function executable(path: string): ToolHealthMarker {
  return { path, kind: 'executable' }
}

const TOOL_HEALTH_POLICIES: Readonly<Record<string, readonly ToolHealthMarker[]>> = {
  verilator: [
    executable('bin/verilator'),
    executable('bin/verilator_bin'),
    file('share/verilator/include/verilated.cpp'),
  ],
  'riscv-toolchain': [
    executable('bin/riscv64-unknown-elf-gcc'),
    executable('bin/riscv64-unknown-elf-ld'),
    executable('bin/riscv64-unknown-elf-objdump'),
    executable('bin/riscv64-unknown-elf-objcopy'),
  ],
  'ecc-fe': [executable('bin/ecc-fe'), directory('fecompiler')],
  'ecc-fe-soc-ysyx-am': [
    file('manifest.json'),
    file('catalog.json'),
    file('filelist.soc.f'),
    file('driver/main.cpp'),
  ],
  'ecc-fe-cpu-rtl': [
    file('thirdparty/README'),
    directory('thirdparty/cv32e40p'),
    directory('thirdparty/cva6'),
    directory('thirdparty/darkriscv'),
    directory('thirdparty/ibex'),
    directory('thirdparty/learn-fpga'),
    directory('thirdparty/picorv32'),
    directory('thirdparty/scr1'),
    directory('thirdparty/serv'),
    directory('thirdparty/vexriscv'),
  ],
  'ecc-fe-difftest-ref': [file('tools/riscv32-spike-so')],
  'ecc-fe-examples': [
    file('examples/ysyx_00000000/filelist.cpu.f'),
    file('examples/ysyx_00000000/rtl/ysyx_00000000.sv'),
    file('examples/ysyx_00000000/rtl/ysyx_00000000_difftest.sv'),
  ],
  surfer: [
    file('index.html'),
    file('integration.js'),
    file('surfer.js'),
    file('surfer_bg.wasm'),
  ],
}

export function requiredToolHealthMarkers(
  normalizedName: string,
): readonly ToolHealthMarker[] {
  if (normalizedName.startsWith('ecc-fe-cpu-')) {
    return normalizedName === 'ecc-fe-cpu-rtl'
      ? TOOL_HEALTH_POLICIES['ecc-fe-cpu-rtl']
      : [directory('thirdparty')]
  }
  if (normalizedName.startsWith('ecc-fe-test-')) return [directory('tests')]
  return TOOL_HEALTH_POLICIES[normalizedName] ?? []
}
