/**
 * Metadata-only workspace patch used to align a remote BotArk with the local
 * desktop workspace.  It deliberately carries no credentials or messages:
 * only sidebar groups, display names and group assignments.
 */
export interface WorkspaceMetadataGroup {
  id: string
  name: string
  collapsed?: boolean
}

export interface WorkspaceMetadataBot {
  /** Account handle (email/username) used as the stable cross-instance key. */
  matchHandle: string
  name: string
  groupId: string
  pinned?: boolean
}

export interface WorkspaceMetadataPayload {
  groups: WorkspaceMetadataGroup[]
  bots: WorkspaceMetadataBot[]
  /** Remove groups that become empty and are not present in this payload. */
  removeEmptyGroups?: boolean
}

export const WORKSPACE_METADATA_CHANNEL = 'botark:workspace:metadata'

export interface WorkspaceMetadataBridge {
  onApply: (listener: (payload: WorkspaceMetadataPayload) => void) => () => void
}
