const HDL_EXTENSIONS = new Set(['v', 'sv', 'vhd', 'vhdl'])

export function isHdlFilePath(path: string): boolean {
  const basename = path.split(/[\\/]/).pop() ?? path
  const normalizedBasename = basename.toLowerCase().endsWith('.gz')
    ? basename.slice(0, -3)
    : basename
  const extensionStart = normalizedBasename.lastIndexOf('.')
  const extension =
    extensionStart > 0 ? normalizedBasename.slice(extensionStart + 1).toLowerCase() : ''
  return Boolean(extension && HDL_EXTENSIONS.has(extension))
}
