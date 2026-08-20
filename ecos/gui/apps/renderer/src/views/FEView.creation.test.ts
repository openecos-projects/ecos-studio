import { describe, expect, it } from 'vitest'
import viewSource from './FEView.vue?raw'
import wizardSource from '../components/FrontendProjectWizard.vue?raw'

describe('frontend workspace creation lifecycle', () => {
  it('keeps the wizard mounted until workspace creation succeeds', () => {
    const createIndex = viewSource.indexOf('const success = await newProject')
    const closeIndex = viewSource.indexOf('showWizard.value = false', createIndex)

    expect(viewSource).toContain(':creating="wizardCreating"')
    expect(viewSource).toContain('if (!success) return')
    expect(createIndex).toBeGreaterThan(-1)
    expect(closeIndex).toBeGreaterThan(createIndex)
  })

  it('prevents duplicate submit and close actions while creation is active', () => {
    expect(viewSource).toContain('if (wizardCreating.value) return')
    expect(wizardSource).toContain('const isCreating = computed(() => props.creating)')
    expect(wizardSource).toMatch(
      /if\s*\(\s*isCreating\.value\s*\|\|\s*!validationOk\.value/,
    )
    expect(wizardSource).toContain("if (!isCreating.value) emit('close')")
  })

  it('creates a project-managed frontend workspace from route context', () => {
    expect(viewSource).toContain(':initial-config="initialWizardConfig"')
    expect(viewSource).toContain('prefillManagedProjectWorkspace()')
    expect(viewSource).toContain("designTool: 'frontend'")
    expect(viewSource).toContain('registerProjectManagedWorkspace({')
    expect(viewSource).toContain('routeQuery: route.query')
    expect(viewSource).toContain("path: '/workspace/home'")
    expect(viewSource).toContain("void router.push('/projects')")
    expect(wizardSource).toContain('initialConfig?: Partial<WorkspaceConfig>')
    expect(wizardSource).toContain('createFrontendWorkspaceConfig(props.initialConfig)')
  })
})
