import { type ReactNode, memo, useEffect, useRef, useState } from 'react'
import { Check, Copy, Download, Image as ImageIcon, X, ZoomIn } from 'lucide-react'
import { cn } from '@/lib/cn'
import { t } from '@/lib/i18n'

/**
 * Full-featured native Markdown renderer for Muse / Grok Bot replies & reports:
 * - Headings (# .. ######)
 * - GFM Tables (| col | col |)
 * - Blockquotes (> quote)
 * - Horizontal rules (--- / ***)
 * - Unordered, ordered, and task lists (- [x] / - [ ])
 * - Fenced code blocks with language header + one-click Copy button
 * - Inline: **bold**, *italic*, ~~strikethrough~~, `code`, [label](url), ![alt](img), bare https:// URLs
 */

function dataUrlToObjectUrl(dataUrl: string): string | null {
  const comma = dataUrl.indexOf(',')
  if (comma < 0 || !dataUrl.slice(5, comma).includes(';base64')) return null
  try {
    const binary = atob(dataUrl.slice(comma + 1))
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
    const mime = dataUrl.slice(5, comma).split(';')[0] || 'application/octet-stream'
    return URL.createObjectURL(new Blob([bytes], { type: mime }))
  } catch {
    return null
  }
}

function InlineMarkdownImage({ src, alt }: { src: string; alt: string }) {
  const [zoomed, setZoomed] = useState(false)
  const [failed, setFailed] = useState(false)
  const [displaySrc, setDisplaySrc] = useState<string | null>(() =>
    /^data:image\//i.test(src) ? null : src
  )
  const objectUrlRef = useRef<string | null>(null)

  useEffect(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = null
    }
    if (!/^data:image\//i.test(src)) {
      setDisplaySrc(src)
      return
    }
    const url = dataUrlToObjectUrl(src)
    if (url) {
      objectUrlRef.current = url
      setDisplaySrc(url)
    } else {
      setFailed(true)
    }
  }, [src])

  useEffect(() => () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
  }, [])

  useEffect(() => {
    if (!zoomed) return
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setZoomed(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zoomed])

  const filename =
    alt.trim() ||
    (src.startsWith('data:') ? 'image.png' : src.split(/[?#]/, 1)[0]?.split('/').pop() || 'image.png')

  const saveImage = () => {
    const a = document.createElement('a')
    a.href = src
    a.download = filename
    if (/^https?:\/\//i.test(src)) {
      a.target = '_blank'
      a.rel = 'noreferrer'
    }
    a.click()
  }

  if (failed) {
    return (
      <span className="my-1 inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1 text-[12px] text-ink-secondary">
        <ImageIcon className="size-3.5 text-ink-muted" aria-hidden />
        <a href={src} target="_blank" rel="noreferrer" className="max-w-60 truncate underline">
          {alt || filename}
        </a>
      </span>
    )
  }

  return (
    <>
      <span className="group/mdimg relative my-1.5 inline-block max-w-full overflow-hidden rounded-xl border border-line bg-sunken/30 align-top">
        <button
          type="button"
          onClick={() => setZoomed(true)}
          className="block cursor-zoom-in"
          title="点击放大查看"
        >
          {displaySrc && (
          <img
            src={displaySrc}
            alt={alt}
            onError={() => setFailed(true)}
            className="max-h-72 max-w-full object-contain"
          />
          )}
        </button>
        <span className="pointer-events-none absolute top-2 right-2 flex items-center gap-1 opacity-0 transition-opacity group-hover/mdimg:opacity-100">
          <button
            type="button"
            onClick={() => setZoomed(true)}
            title="放大查看"
            className="pointer-events-auto grid size-7 place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm hover:bg-black/75"
          >
            <ZoomIn className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={saveImage}
            title="保存图片"
            className="pointer-events-auto grid size-7 place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm hover:bg-black/75"
          >
            <Download className="size-3.5" />
          </button>
        </span>
      </span>
      {zoomed && (
        <span
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/80 p-6 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          onClick={() => setZoomed(false)}
        >
          <span
            className="mb-3 flex w-full max-w-4xl items-center justify-between gap-3 text-white"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="truncate text-[13px] font-medium text-white/90">{filename}</span>
            <span className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={saveImage}
                className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-white/25"
              >
                <Download className="size-3.5" /> 保存图片
              </button>
              <button
                type="button"
                aria-label="关闭预览"
                onClick={() => setZoomed(false)}
                className="grid size-8 place-items-center rounded-full bg-white/15 text-white hover:bg-white/25"
              >
                <X className="size-4" />
              </button>
            </span>
          </span>
          {displaySrc && <img
            src={displaySrc}
            alt={alt}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[82vh] max-w-[90vw] rounded-xl object-contain shadow-2xl"
          />}
        </span>
      )}
    </>
  )
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false)

  const onCopy = () => {
    void navigator.clipboard.writeText(code).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1600)
      },
      () => {}
    )
  }

  return (
    <div className="my-2 overflow-hidden rounded-xl border border-line bg-sunken/80">
      <div className="flex items-center justify-between border-b border-line/60 px-3 py-1 text-[11px] text-ink-muted">
        <span className="font-mono lowercase">{lang || 'code'}</span>
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-ink-secondary hover:bg-hover hover:text-ink"
        >
          {copied ? <Check className="size-3 text-status-online" /> : <Copy className="size-3" />}
          {copied ? '已复制' : t('Copy')}
        </button>
      </div>
      <pre className="overflow-x-auto px-3 py-2.5 font-mono text-[12.5px] leading-[1.55] text-ink">
        <code>{code}</code>
      </pre>
    </div>
  )
}

function renderInline(
  text: string,
  keyPrefix: string,
  onFileLinkClick?: (path: string, label: string) => void,
  suppressWorkspaceImages?: boolean
): ReactNode[] {
  const nodes: ReactNode[] = []
  // Match image ![alt](url), link [label](url), **bold**, ~~strike~~, *italic*, `code`, or bare https:// URL
  const re =
    /(!\[[^\]]*\]\([^)]+\)|\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*|~~[^~]+~~|`[^`]+`|\*[^*\n]+\*|https?:\/\/[^\s<>)]+)/g
  let last = 0
  let match: RegExpExecArray | null
  let i = 0

  while ((match = re.exec(text)) !== null) {
    if (match.index > last) {
      nodes.push(text.slice(last, match.index))
    }
    const token = match[0]!
    if (token.startsWith('![')) {
      const m = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(token)
      const alt = m?.[1] ?? ''
      const url = m?.[2]?.trim() ?? ''
      if (/^data:video\//i.test(url) || (/^https?:\/\//i.test(url) && /\.(mp4|m4v|webm|mov|mkv)(?:[?#].*)?$/i.test(url))) {
        nodes.push(
          <video
            key={`${keyPrefix}-vid-${i}`}
            controls
            playsInline
            preload="metadata"
            src={url}
            className="my-1.5 max-h-72 w-full max-w-md rounded-lg border border-line bg-black"
          />
        )
      } else if (/^data:audio\//i.test(url) || (/^https?:\/\//i.test(url) && /\.(mp3|m4a|aac|wav|ogg|oga|flac)(?:[?#].*)?$/i.test(url))) {
        nodes.push(
          <audio
            key={`${keyPrefix}-aud-${i}`}
            controls
            preload="metadata"
            src={url}
            className="my-1.5 w-full max-w-md"
          />
        )
      } else if (/^https?:\/\/|^data:image\//i.test(url)) {
        nodes.push(<InlineMarkdownImage key={`${keyPrefix}-img-${i}`} src={url} alt={alt} />)
      } else if (/^\/?(?:fs\/raw\/)?workspace\//i.test(url) || /\.(png|jpe?g|gif|webp|svg)(?:[?#].*)?$/i.test(url)) {
        if (!suppressWorkspaceImages) {
          const cleanPath = url.replace(/^\/?fs\/raw\//i, '').replace(/^\/+/, '')
          const label = alt || cleanPath.split('/').pop() || cleanPath
          if (onFileLinkClick) {
            nodes.push(
              <button
                key={`${keyPrefix}-wimg-${i}`}
                type="button"
                onClick={() => onFileLinkClick(cleanPath, label)}
                className="inline-flex items-center gap-1 rounded-md border border-line bg-accent-50/80 px-2 py-0.5 font-mono text-[12px] font-medium text-accent-600 transition-colors hover:bg-accent-100"
              >
                🖼️ {label}
              </button>
            )
          } else {
            nodes.push(label)
          }
        }
      } else {
        nodes.push(token)
      }
    } else if (token.startsWith('[')) {
      const m = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token)
      const label = m?.[1] ?? token
      const href = m?.[2]?.trim() ?? ''
      if (/^https?:\/\//i.test(href)) {
        nodes.push(
          <a
            key={`${keyPrefix}-a-${i}`}
            href={href}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-accent-600 underline decoration-accent-600/40 underline-offset-2 hover:decoration-accent-600"
          >
            {label}
          </a>
        )
      } else if (
        onFileLinkClick &&
        (href.startsWith('workspace/') ||
          /^(sediment|dotfile|dotatt|harkatt|harkfile):\/\//i.test(href) ||
          /\.(md|markdown|txt|json|csv|html|htm|pdf|png|jpe?g|gif|webp|svg|py|ts|tsx|js|sh|sql|yaml|yml)$/i.test(href))
      ) {
        nodes.push(
          <button
            key={`${keyPrefix}-f-${i}`}
            type="button"
            onClick={() => onFileLinkClick(href.replace(/^\/+/, ''), label)}
            className="inline-flex items-center gap-1 rounded-md border border-line bg-accent-50/80 px-2 py-0.5 font-mono text-[12px] font-medium text-accent-600 transition-colors hover:bg-accent-100"
          >
            📄 {label}
          </button>
        )
      } else if (href.startsWith('#hark:') || href.startsWith('hark:')) {
        nodes.push(
          <span
            key={`${keyPrefix}-hk-${i}`}
            className="inline-flex items-center gap-1 rounded-full border border-accent-600/30 bg-accent-50 px-2.5 py-0.5 text-[12px] font-medium text-accent-600"
          >
            ⚡ {label}
          </span>
        )
      } else {
        nodes.push(label)
      }
    } else if (token.startsWith('**')) {
      nodes.push(
        <strong key={`${keyPrefix}-b-${i}`} className="font-semibold text-ink">
          {renderInline(token.slice(2, -2), `${keyPrefix}-b-${i}`, onFileLinkClick)}
        </strong>
      )
    } else if (token.startsWith('~~')) {
      nodes.push(
        <del key={`${keyPrefix}-s-${i}`} className="text-ink-muted line-through">
          {token.slice(2, -2)}
        </del>
      )
    } else if (token.startsWith('`')) {
      const inner = token.slice(1, -1)
      if (
        onFileLinkClick &&
        (inner.startsWith('workspace/') || /^[\w./-]+\.(md|markdown|html|json|csv|txt|py|ts|tsx|js)$/i.test(inner))
      ) {
        nodes.push(
          <button
            key={`${keyPrefix}-fc-${i}`}
            type="button"
            onClick={() => onFileLinkClick(inner.replace(/^\/+/, ''), inner)}
            title="点击原生打开预览"
            className="rounded bg-sunken px-1.5 py-0.5 font-mono text-[0.9em] text-accent-600 underline decoration-dotted underline-offset-2 hover:bg-hover"
          >
            {inner}
          </button>
        )
      } else {
        nodes.push(
          <code key={`${keyPrefix}-c-${i}`} className="rounded bg-sunken px-1 py-0.5 font-mono text-[0.9em]">
            {inner}
          </code>
        )
      }
    } else if (token.startsWith('*')) {
      nodes.push(
        <em key={`${keyPrefix}-i-${i}`} className="italic">
          {token.slice(1, -1)}
        </em>
      )
    } else if (/^https?:\/\//i.test(token)) {
      nodes.push(
        <a
          key={`${keyPrefix}-u-${i}`}
          href={token}
          target="_blank"
          rel="noreferrer"
          className="break-all text-accent-600 underline decoration-accent-600/40 underline-offset-2 hover:decoration-accent-600"
        >
          {token}
        </a>
      )
    } else {
      nodes.push(token)
    }
    last = match.index + token.length
    i += 1
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

function isTableRow(line: string): boolean {
  const t = line.trim()
  return t.startsWith('|') && t.endsWith('|') && t.length > 2
}

function isTableDivider(line: string): boolean {
  const t = line.trim()
  return /^\|[\s:|-]+\|$/.test(t) && t.includes('-')
}

function splitTableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim())
}

function renderBlocks(
  text: string,
  onFileLinkClick?: (path: string, label: string) => void,
  suppressWorkspaceImages?: boolean
): ReactNode[] {
  const inline = (s: string, key: string) => renderInline(s, key, onFileLinkClick, suppressWorkspaceImages)
  const cleaned = text.replace(/\[\[hatch_widget:[^\]]+\]\]/g, '').replace(/\r\n/g, '\n')
  const lines = cleaned.split('\n')
  const blocks: ReactNode[] = []
  let i = 0
  let block = 0

  while (i < lines.length) {
    const line = lines[i] ?? ''

    // Fenced code block
    if (line.trimStart().startsWith('```')) {
      const lang = line.trimStart().slice(3).trim()
      const code: string[] = []
      i += 1
      while (i < lines.length && !(lines[i] ?? '').trimStart().startsWith('```')) {
        code.push(lines[i] ?? '')
        i += 1
      }
      if (i < lines.length) i += 1
      blocks.push(<CodeBlock key={`code-${block++}`} lang={lang} code={code.join('\n')} />)
      continue
    }

    // Horizontal rule
    if (/^\s*(?:---|___|\*\*\*)\s*$/.test(line)) {
      blocks.push(<hr key={`hr-${block++}`} className="my-2.5 border-t border-line" />)
      i += 1
      continue
    }

    // Heading (# .. ######)
    const heading = /^(#{1,6})\s+(.+)$/.exec(line)
    if (heading) {
      const level = heading[1]!.length
      const cls =
        level === 1
          ? 'mt-3 mb-1.5 text-[16px] leading-6 font-semibold text-ink'
          : level === 2
            ? 'mt-2.5 mb-1 text-[15px] leading-5 font-semibold text-ink'
            : level === 3
              ? 'mt-2 mb-1 text-[14px] leading-5 font-semibold text-ink'
              : 'mt-1.5 mb-0.5 text-[13.5px] font-semibold text-ink'
      blocks.push(
        <div key={`h-${block++}`} className={cls}>
          {renderInline(heading[2]!, `h${block}`, onFileLinkClick)}
        </div>
      )
      i += 1
      continue
    }

    // GFM Table
    if (isTableRow(line) && i + 1 < lines.length && isTableDivider(lines[i + 1] ?? '')) {
      const headers = splitTableCells(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && isTableRow(lines[i] ?? '')) {
        rows.push(splitTableCells(lines[i] ?? ''))
        i += 1
      }
      blocks.push(
        <div key={`tbl-${block++}`} className="my-2 overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full border-collapse text-left text-[12.5px]">
            <thead>
              <tr className="border-b border-line bg-sunken/60">
                {headers.map((h, hi) => (
                  <th key={hi} className="px-3 py-1.5 font-semibold text-ink">
                    {renderInline(h, `th-${block}-${hi}`, onFileLinkClick)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r, ri) => (
                <tr key={ri} className="hover:bg-hover/40">
                  {headers.map((_, ci) => (
                    <td key={ci} className="px-3 py-1.5 text-ink-secondary">
                      {renderInline(r[ci] ?? '', `td-${block}-${ri}-${ci}`, onFileLinkClick)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
      continue
    }

    // Blockquote
    if (/^\s*>\s?/.test(line)) {
      const qLines: string[] = []
      while (i < lines.length && /^\s*>\s?/.test(lines[i] ?? '')) {
        qLines.push((lines[i] ?? '').replace(/^\s*>\s?/, ''))
        i += 1
      }
      blocks.push(
        <blockquote
          key={`q-${block++}`}
          className="my-1.5 border-l-[3px] border-line-strong pl-3 text-ink-secondary italic"
        >
          {renderInline(qLines.join('\n'), `q${block}`, onFileLinkClick)}
        </blockquote>
      )
      continue
    }

    // Unordered / Task list run
    if (/^\s*[-*•]\s+/.test(line)) {
      const items: ReactNode[] = []
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i] ?? '')) {
        const rawItem = (lines[i] ?? '').replace(/^\s*[-*•]\s+/, '')
        const taskMatch = /^\[([ xX])\]\s+(.*)$/.exec(rawItem)
        if (taskMatch) {
          const checked = taskMatch[1]!.toLowerCase() === 'x'
          items.push(
            <li key={`li-${block}-${items.length}`} className="flex items-start gap-2 leading-[1.55] list-none -ml-4">
              <input
                type="checkbox"
                checked={checked}
                readOnly
                className="mt-1 size-3.5 shrink-0 rounded border-line accent-accent-600"
              />
              <span className={cn(checked && 'text-ink-muted line-through')}>
                {renderInline(taskMatch[2]!, `li${block}-${items.length}`, onFileLinkClick)}
              </span>
            </li>
          )
        } else {
          items.push(
            <li key={`li-${block}-${items.length}`} className="leading-[1.55]">
              {renderInline(rawItem, `li${block}-${items.length}`, onFileLinkClick)}
            </li>
          )
        }
        i += 1
      }
      blocks.push(
        <ul key={`ul-${block++}`} className="my-1.5 list-disc space-y-1 pl-5">
          {items}
        </ul>
      )
      continue
    }

    // Ordered list run
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: ReactNode[] = []
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i] ?? '')) {
        const itemText = (lines[i] ?? '').replace(/^\s*\d+\.\s+/, '')
        items.push(
          <li key={`oli-${block}-${items.length}`} className="leading-[1.55]">
            {renderInline(itemText, `oli${block}-${items.length}`, onFileLinkClick)}
          </li>
        )
        i += 1
      }
      blocks.push(
        <ol key={`ol-${block++}`} className="my-1.5 list-decimal space-y-1 pl-5">
          {items}
        </ol>
      )
      continue
    }

    // Blank line
    if (!line.trim()) {
      i += 1
      continue
    }

    // Paragraph: merge consecutive plain lines
    const para: string[] = [line]
    i += 1
    while (
      i < lines.length &&
      (lines[i] ?? '').trim() &&
      !/^(#{1,6})\s+/.test(lines[i] ?? '') &&
      !/^\s*[-*•]\s+/.test(lines[i] ?? '') &&
      !/^\s*\d+\.\s+/.test(lines[i] ?? '') &&
      !/^\s*>\s?/.test(lines[i] ?? '') &&
      !/^\s*(?:---|___|\*\*\*)\s*$/.test(lines[i] ?? '') &&
      !isTableRow(lines[i] ?? '') &&
      !(lines[i] ?? '').trimStart().startsWith('```')
    ) {
      para.push(lines[i] ?? '')
      i += 1
    }
    blocks.push(
      <p key={`p-${block++}`} className="my-1 whitespace-pre-wrap leading-[1.6] first:mt-0 last:mb-0">
        {inline(para.join('\n'), `p${block}`)}
      </p>
    )
  }

  return blocks
}

export const MarkdownText = memo(function MarkdownText({
  text,
  className,
  onFileLinkClick,
  suppressWorkspaceImages
}: {
  text: string
  className?: string
  onFileLinkClick?: (path: string, label: string) => void
  suppressWorkspaceImages?: boolean
}) {
  if (!/[*_`#\-|>~\[\]]|\n\d+\.|https?:\/\//.test(text) && !text.includes('```')) {
    return <span className={cn('whitespace-pre-wrap break-words', className)}>{text}</span>
  }
  return (
    <div className={cn('break-words [&_p+p]:mt-2', className)}>
      {renderBlocks(text, onFileLinkClick, suppressWorkspaceImages)}
    </div>
  )
})
