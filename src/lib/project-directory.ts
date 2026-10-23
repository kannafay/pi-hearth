import { invoke } from '@tauri-apps/api/core'
import type { DragDropEvent } from '@tauri-apps/api/webview'

export const resolveProjectDirectory = (path: string | null = null) =>
  invoke<string>('workspace_project_directory', { path })

export async function listenForProjectFolderDrop(onEvent: (event: DragDropEvent) => void) {
  const { getCurrentWebview } = await import('@tauri-apps/api/webview')
  return getCurrentWebview().onDragDropEvent(({ payload }) => onEvent(payload))
}
