/** Map internal/legacy contract titles to user-facing labels. */
export function displayAgentContractTitle(title: string): string {
  if (!title) return title
  if (/frozen workspace execution|冻结的 Workspace 执行/i.test(title)) {
    return /[\u4e00-\u9fff]/.test(title) ? 'Workspace 运行方案' : 'Workspace run plan'
  }
  if (/frozen workspace rerun|冻结的重跑/i.test(title)) {
    return /[\u4e00-\u9fff]/.test(title) ? 'Workspace 重跑方案' : 'Workspace rerun plan'
  }
  return title
}
