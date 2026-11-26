function extractLeadingJsonObject(raw: string): string {
  let source = raw.trimStart()
  if (source.startsWith('```')) {
    const firstNewline = source.indexOf('\n')
    if (firstNewline === -1) return source
    source = source.slice(firstNewline + 1).trimStart()
  }
  if (!source.startsWith('{')) return source

  let depth = 0
  let inString = false
  let escaped = false
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]!
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === '"') {
        inString = false
      }
      continue
    }
    if (ch === '"') {
      inString = true
    } else if (ch === '{') {
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0) return source.slice(0, i + 1)
    }
  }
  return source
}

export function isToolRequest(text: string): boolean {
  return /^\s*\[TOOL\]/i.test(text)
}

export function requestedTool(text: string) {
  if (!isToolRequest(text)) return undefined
  const payload = extractLeadingJsonObject(text.trimStart().slice(6))
  let value: unknown
  try {
    value = JSON.parse(payload)
  } catch {
    throw new Error('无效的工具请求：JSON 格式有误')
  }
  if (
    !value ||
    typeof value !== 'object' ||
    !('name' in value) ||
    typeof value.name !== 'string' ||
    !value.name.trim() ||
    !('args' in value) ||
    !value.args ||
    typeof value.args !== 'object' ||
    Array.isArray(value.args)
  ) {
    throw new Error('无效的工具请求')
  }
  return { name: value.name, args: value.args as Record<string, unknown> }
}
