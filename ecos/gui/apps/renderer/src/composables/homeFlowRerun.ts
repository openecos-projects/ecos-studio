export type HomeWorkspaceRerunHandler = () => Promise<boolean>

let activeHandler: HomeWorkspaceRerunHandler | null = null

export function registerHomeWorkspaceRerun(
  handler: HomeWorkspaceRerunHandler,
): () => void {
  activeHandler = handler
  return () => {
    if (activeHandler === handler) {
      activeHandler = null
    }
  }
}

export async function rerunHomeWorkspace(): Promise<boolean> {
  if (!activeHandler) {
    throw new Error('Workspace rerun is not available.')
  }
  return await activeHandler()
}
