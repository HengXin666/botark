/**
 * Hark working-status normalization.
 *
 * Hark's sync protocol carries the agent's live narration as an object, not a
 * string:
 *   { line: '正在读取界面组件代码。', lineKey?, lineArgs?, live, visible, working, ... }
 * `visible: false` means the line must not be shown. `lineArgs` distinguishes
 * two invocations of the same action class, so it is appended to the line.
 * Older surfaces may still send a plain string; both shapes are accepted here.
 */

export interface HarkNarration {
  text: string
  visible: boolean
  /** Whether Hark says the turn is still working; null when the frame omits it. */
  working: boolean | null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function firstString(record: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function appendLineArgs(text: string, rawArgs: unknown): string {
  const args = asRecord(rawArgs)
  if (!args) return text
  const parts: string[] = []
  for (const [key, value] of Object.entries(args)) {
    if (value == null || value === '') continue
    const rendered =
      typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
        ? String(value)
        : JSON.stringify(value)
    if (rendered) parts.push(key + '=' + rendered)
    if (parts.length >= 6) break
  }
  return parts.length > 0 ? (text + ' ' + parts.join(', ')).slice(0, 200) : text
}

export interface HarkNarrationState {
  /** null means this patch is status-only and carries no new line. */
  text: string | null
  visible: boolean
  working: boolean | null
}

/** Read every field of a narration value, including status-only patches. */
export function readHarkNarrationState(value: unknown): HarkNarrationState | null {
  if (typeof value === 'string') {
    const text = value.trim()
    return text ? { text, visible: true, working: null } : null
  }
  const record = asRecord(value)
  if (!record) return null
  const working =
    typeof record['working'] === 'boolean'
      ? record['working']
      : typeof record['live'] === 'boolean'
        ? record['live']
        : null
  if (record['visible'] === false) return { text: null, visible: false, working }
  const line = firstString(record, [
    'line',
    'narration',
    'text',
    'label',
    'title',
    'message',
    'description',
    'lineKey'
  ])
  return {
    text: line ? appendLineArgs(line, record['lineArgs']) : null,
    visible: true,
    working
  }
}

/** Normalize one narration value (string or protocol object) into display text. */
export function parseHarkNarration(value: unknown): HarkNarration | null {
  const state = readHarkNarrationState(value)
  if (!state || !state.visible || !state.text) return null
  return { text: state.text, visible: true, working: state.working }
}

/** Normalize Hark's activeActivity field (string, array or object) into text. */
export function parseHarkActiveActivity(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null
  if (Array.isArray(value)) {
    for (let index = value.length - 1; index >= 0; index--) {
      const parsed = parseHarkActiveActivity(value[index])
      if (parsed) return parsed
    }
    return null
  }
  const record = asRecord(value)
  if (!record) return null
  if (record['visible'] === false) return null
  const text = firstString(record, [
    'label',
    'line',
    'text',
    'activity',
    'title',
    'name',
    'type'
  ])
  return text || null
}
