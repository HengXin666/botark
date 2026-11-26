const SAFE_ENV_TEMPLATE_RE = /^\.env\.(example|sample|template|dist)$/i
const SENSITIVE_DIR_SEGMENTS = new Set(['.git', '.ssh', '.aws', '.gnupg', '.kube'])
const SENSITIVE_EXACT_NAMES = new Set([
  '.env',
  '.npmrc',
  '.pypirc',
  '.netrc',
  '.htpasswd',
  '.dockercfg',
  '.git-credentials',
  'id_rsa',
  'id_ed25519',
  'id_ecdsa',
  'id_dsa',
  'credentials.json',
  'secrets.json',
  'secrets.yaml',
  'secrets.yml'
])
const SENSITIVE_EXT_RE = /\.(pem|key|p12|pfx|jks|kdbx)$/i
const SENSITIVE_NAME_RE = /^(id_(rsa|ed25519|ecdsa|dsa)\..+|service-account.*\.json|.*credentials.*\.json)$/i

export function normalizeWorkspaceRelPath(raw: string): string {
  const normalized = raw.replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/^\/+/, '').replace(/\/+$/, '')
  return normalized || '.'
}

/** Reject credential material in both the MCP file tools and the Hark portal. */
export function isSensitiveWorkspacePath(rawPath: string): boolean {
  const normalized = normalizeWorkspaceRelPath(rawPath)
  if (normalized === '.') return false
  const segments = normalized.split('/').filter(Boolean)
  for (const segment of segments) {
    if (SENSITIVE_DIR_SEGMENTS.has(segment.toLowerCase())) return true
  }
  const base = (segments[segments.length - 1] ?? '').toLowerCase()
  if (base.startsWith('.env.') && !SAFE_ENV_TEMPLATE_RE.test(base)) return true
  if (SENSITIVE_EXACT_NAMES.has(base)) return true
  if (SENSITIVE_EXT_RE.test(base)) return true
  if (SENSITIVE_NAME_RE.test(base)) return true
  return false
}
