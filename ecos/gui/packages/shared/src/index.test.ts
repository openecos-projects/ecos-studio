import { describe, expect, it } from 'vitest'

import type { DesktopSaveFileDialogOptions } from './index.ts'

describe('shared public contracts', () => {
  it('exports Save As dialog options from the package entry point', () => {
    const options = {
      defaultPath: '/exports/design_signoff_package.tar.gz',
      filters: [{ name: 'Tarball', extensions: ['tar.gz'] }],
      title: 'Export Signoff Package',
    } satisfies DesktopSaveFileDialogOptions

    expect(options.title).toBe('Export Signoff Package')
  })
})
