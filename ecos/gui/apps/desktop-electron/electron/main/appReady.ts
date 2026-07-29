/**
 * Run work only after Electron's app-ready gate. Used so second-instance
 * launches never create a BrowserWindow before `app.whenReady()`.
 */
export async function runAfterAppReady(
  whenReady: () => Promise<unknown>,
  operation: () => Promise<void>,
): Promise<void> {
  await whenReady()
  await operation()
}
