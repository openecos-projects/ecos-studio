const HDL_EXTENSIONS = new Set(['v', 'sv', 'vhd', 'vhdl'])

export function isHdlFilePath(path: string): boolean {
  const basename = path.split(/[\\/]/).pop() ?? path
  const extension = basename.includes('.') ? basename.split('.').pop()?.toLowerCase() : ''
  return Boolean(extension && HDL_EXTENSIONS.has(extension))
}
