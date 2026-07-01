const HDL_EXTENSIONS = new Set(['v', 'sv', 'vhd', 'vhdl'])

export function isHdlFilePath(path: string): boolean {
  const basename = path.split(/[\\/]/).pop() ?? path
  const extensionStart = basename.lastIndexOf('.')
  const extension =
    extensionStart > 0 ? basename.slice(extensionStart + 1).toLowerCase() : ''
  return Boolean(extension && HDL_EXTENSIONS.has(extension))
}
