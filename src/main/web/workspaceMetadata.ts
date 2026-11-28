import { app } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { HARK_CHANNELS } from '@shared/ipc'
import { WORKSPACE_METADATA_CHANNEL } from '@shared/workspaceMetadata'
import { applyMobileWorkspaceMetadataPatch } from '../mobileSync/mobileSyncIpc'

export interface WorkspaceMetadataHost {
  broadcast: (channel: string, args: unknown[]) => void
  invokeIpc: (channel: string, args: unknown[]) => Promise<unknown>
  logError: (message: string, detail: unknown) => void
}

let host: WorkspaceMetadataHost | null = null

/** Install the gateway callbacks this module needs; call once at gateway start. */
export function initWorkspaceMetadata(hostOptions: WorkspaceMetadataHost): void {
  host = hostOptions
}

export function workspaceMetadataPath(): string {
  return join(app.getPath('userData'), 'workspace-metadata.json')
}

/** Read the last saved patch; undefined when the file is missing or unreadable. */
export function readSavedWorkspaceMetadata(): unknown {
  try {
    return JSON.parse(readFileSync(workspaceMetadataPath(), 'utf8')) as unknown
  } catch {
    return null
  }
}

/** Read the Hark import registry so a patch can materialise bots for new accounts. */
async function harkImportHints(): Promise<Array<{ accountId: string; handle: string; displayName: string }>> {
  if (!host) return []
  try {
    const rows = (await host.invokeIpc(HARK_CHANNELS.remoteList, [])) as unknown
    if (!Array.isArray(rows)) return []
    return rows.flatMap((row) => {
      if (!row || typeof row !== 'object') return []
      const record = row as Record<string, unknown>
      const accountId = typeof record['accountId'] === 'string' ? record['accountId'] : ''
      const handle = typeof record['email'] === 'string' ? record['email'] : ''
      if (!accountId || !handle) return []
      const displayName = typeof record['displayName'] === 'string' ? record['displayName'] : handle
      return [{ accountId, handle, displayName }]
    })
  } catch {
    return []
  }
}

/**
 * Persist a metadata-only patch, push it to connected browsers, and merge it
 * into the mirrored snapshot that the REST API reads.
 */
export async function applyWorkspaceMetadataPatch(
  payload: unknown
): Promise<Record<string, unknown>> {
  // Persist so a browser that opens later (or was offline during the push)
  // still starts with the local workspace's group names and bot names.
  writeFileSync(workspaceMetadataPath(), JSON.stringify(payload, null, 2), { mode: 0o600 })
  host?.broadcast(WORKSPACE_METADATA_CHANNEL, [payload])
  // The mirrored snapshot is what REST clients read, and it only moves when a
  // browser pushes one. Apply the patch to the server copy as well so the
  // names and groups are visible without an open browser tab.
  try {
    const knownAccounts = await harkImportHints()
    const result = applyMobileWorkspaceMetadataPatch(payload, { createMissingBots: true, knownAccounts })
    return { ok: true, ...result }
  } catch (error) {
    host?.logError('[web] workspace metadata patch failed', error)
    return { ok: true }
  }
}
