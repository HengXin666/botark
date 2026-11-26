import { useEffect, useState } from 'react'
import { appendQuotaSamples, QUOTA_HISTORY_DAYS, type QuotaSample } from '@shared/quotaUsage'

const STORAGE_KEY = 'bothub:quota-usage:v1'
const CHANGE_EVENT = 'bothub:quota-usage-changed'
let memoryFallback: QuotaSample[] = []

function readStorage(): QuotaSample[] {
  if (typeof window === 'undefined') return memoryFallback
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as QuotaSample[]) : []
  } catch {
    return memoryFallback
  }
}

function writeStorage(samples: QuotaSample[]): void {
  memoryFallback = samples
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(samples))
  } catch {
    /* Quota history is best-effort; memory fallback keeps this session usable. */
  }
}

export function loadQuotaSamples(): QuotaSample[] {
  return appendQuotaSamples(readStorage(), [], { now: Date.now(), maxAgeDays: QUOTA_HISTORY_DAYS })
}

export function recordQuotaSamples(incoming: QuotaSample[], now = Date.now()): QuotaSample[] {
  const merged = appendQuotaSamples(readStorage(), incoming, { now, maxAgeDays: QUOTA_HISTORY_DAYS })
  writeStorage(merged)
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: merged }))
  }
  return merged
}

export function clearQuotaSamples(): void {
  writeStorage([])
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: [] }))
  }
}

export function subscribeQuotaSamples(listener: (samples: QuotaSample[]) => void): () => void {
  if (typeof window === 'undefined') return () => undefined
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<QuotaSample[]>).detail
    listener(Array.isArray(detail) ? detail : loadQuotaSamples())
  }
  window.addEventListener(CHANGE_EVENT, handler)
  return () => window.removeEventListener(CHANGE_EVENT, handler)
}

export function useQuotaSamples(): QuotaSample[] {
  const [samples, setSamples] = useState<QuotaSample[]>(loadQuotaSamples)
  useEffect(() => subscribeQuotaSamples(setSamples), [])
  return samples
}
