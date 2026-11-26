/** Shared Hark conversation shapes used by the desktop project page and mobile sync. */
export interface HarkProjectSummary {
  id: string
  kind: 'main' | 'project'
  title: string | null
  favorite: boolean
  archivedAt: string | null
  /** Conversation creation time, used to distinguish a never-used project from one with task history. */
  createdAt?: string
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
      createdAt: asString(raw['createdAt']) || undefined,
      activityAt:
        asString(raw['activityAt']) ||
        asString(raw['updatedAt']) ||
        asString(raw['createdAt']),
      status: asString(raw['status']) || undefined
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

/** Active projects in the same recency order used by the Linux project page. */
export function harkProjectsByRecency(projects: HarkProjectSummary[]): HarkProjectSummary[] {
  return [...projects]
    .filter((project) => project.kind === 'project' && project.archivedAt === null)
    .sort((left, right) => harkActivityTime(right) - harkActivityTime(left))
}

/**
 * Effective status for one project. The live status endpoint wins; the status
 * cached on the project (native snapshot / desktop sync) is the fallback so a
 * transient status-poll failure does not make a working project look idle.
 */
export function harkProjectStatus(
  project: Pick<HarkProjectSummary, 'id' | 'status'>,
  statuses: Record<string, string>
): string {
  return (statuses[project.id] || project.status || '').toLowerCase()
}

/** Projects currently working, preserving the caller's recency order. */
export function harkWorkingProjects(
  projects: HarkProjectSummary[],
  statuses: Record<string, string>
): HarkProjectSummary[] {
  return projects.filter((project) => harkProjectStatus(project, statuses) === 'working')
}

/**
 * Linux resume rule: only auto-open when the user opted in, no session is
 * already active, and exactly one project is working. Several working projects
 * stay on the project list so the user can choose.
 */
export function shouldAutoOpenHarkProject(options: {
  activeSessionId?: string | null
  resumeLast: boolean
  projects: HarkProjectSummary[]
  statuses: Record<string, string>
}): HarkProjectSummary | null {
  if (!options.resumeLast || options.activeSessionId) return null
  const working = harkWorkingProjects(options.projects, options.statuses)
  return working.length === 1 ? working[0]! : null
}

export function harkActivityTime(project: Pick<HarkProjectSummary, 'activityAt'>): number {
  const time = Date.parse(project.activityAt)
  return Number.isFinite(time) ? time : 0
}

/** True when a project has message/task activity beyond the instant it was created. */
export function harkHasHistory(
  project: Pick<HarkProjectSummary, 'activityAt'> & { createdAt?: string }
): boolean {
  const activity = Date.parse(project.activityAt)
  if (!Number.isFinite(activity)) return false
  const created = project.createdAt ? Date.parse(project.createdAt) : NaN
  if (!Number.isFinite(created)) return true
  return activity - created > 2_000
}
