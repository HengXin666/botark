/** Shared Hark conversation shapes used by the desktop project page and mobile sync. */
export interface HarkProjectSummary {
  id: string
  kind: 'main' | 'project'
  title: string | null
  favorite: boolean
  archivedAt: string | null
  activityAt: string
  status?: string
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function parseHarkConversations(data: unknown): HarkProjectSummary[] {
  const root = asRecord(data)
  const items = root && Array.isArray(root['conversations']) ? root['conversations'] : []
  return items.flatMap((item) => {
    const raw = asRecord(item)
    const id = raw ? asString(raw['id']) : ''
    if (!raw || !id) return []
    const kind = asString(raw['kind']) === 'main' ? 'main' : 'project'
    return [{
      id,
      kind,
      title: asString(raw['title']) || null,
      favorite: raw['favorite'] === true,
      archivedAt: asString(raw['archivedAt']) || null,
      activityAt:
        asString(raw['activityAt']) ||
        asString(raw['updatedAt']) ||
        asString(raw['createdAt'])
    }]
  })
}

export function parseHarkStatuses(data: unknown): Record<string, string> {
  const raw = asRecord(asRecord(data)?.['statuses'])
  const out: Record<string, string> = {}
  if (raw) {
    for (const [id, value] of Object.entries(raw)) {
      if (typeof value === 'string' && value) out[id] = value
    }
  }
  return out
}

export function harkProjectTitle(project: Pick<HarkProjectSummary, 'title' | 'kind'>): string {
  return project.title?.trim() || (project.kind === 'main' ? '主对话' : '未命名项目')
}

export function harkActivityTime(project: Pick<HarkProjectSummary, 'activityAt'>): number {
  const time = Date.parse(project.activityAt)
  return Number.isFinite(time) ? time : 0
}
