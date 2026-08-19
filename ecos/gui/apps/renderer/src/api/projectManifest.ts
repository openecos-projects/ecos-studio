import {
  parseProjectManifest,
  type ProjectManifest,
  type ProjectManifestMutation,
} from '@ecos-studio/shared'
import { waitForDesktopApi } from '@/platform/desktop'

export async function mutateProjectManifest(
  projectRoot: string,
  mutation: ProjectManifestMutation,
): Promise<ProjectManifest> {
  const desktopApi = await waitForDesktopApi()
  const result = await desktopApi.projectManifest.mutate({
    mutation: cloneForDesktopIpc(mutation),
    projectRoot,
  })
  return parseProjectManifest(result.content)
}

function cloneForDesktopIpc<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
