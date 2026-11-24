/**
 * Reply watches per Hark account. Several sends can be in flight; a new one
 * used to cancel the previous watch, cutting the first reply short.
 */
export class HarkWatchRegistry {
  private readonly byAccount = new Map<
    string,
    Map<string, { abort: () => void; target?: string; conversationId?: string }>
  >()
  private seq = 0
  /** Replies already returned by a finished watch (bounded per account). */
  private readonly taken = new Map<string, string[]>()

  add(accountId: string, abort: () => void, target?: string, conversationId?: string): string {
    const token = `w${++this.seq}`
    let map = this.byAccount.get(accountId)
    if (!map) this.byAccount.set(accountId, (map = new Map()))
    map.set(token, { abort, target, conversationId })
    return token
  }

  remove(accountId: string, token: string): void {
    const map = this.byAccount.get(accountId)
    if (!map) return
    map.delete(token)
    if (map.size === 0) this.byAccount.delete(accountId)
  }

  /** Stop every watch of the account (stop-tool, sign-out), or '*' for all accounts. */
  cancelAll(accountId: string): void {
    if (accountId === '*') {
      const entries = [...this.byAccount.values()]
      this.byAccount.clear()
      for (const map of entries) {
        for (const { abort } of map.values()) abort()
      }
      return
    }
    const map = this.byAccount.get(accountId)
    if (!map) return
    this.byAccount.delete(accountId)
    for (const { abort } of map.values()) abort()
  }

  /** Stop watches belonging to one conversation (user switched projects). */
  cancelConversation(accountId: string, conversationId: string): void {
    const map = this.byAccount.get(accountId)
    if (!map) return
    for (const [token, watch] of [...map]) {
      if (watch.conversationId !== conversationId) continue
      map.delete(token)
      watch.abort()
    }
    if (map.size === 0) this.byAccount.delete(accountId)
  }

  /** A finished watch returned this reply: no later watch may take it too. */
  markTaken(accountId: string, replyId: string): void {
    const list = this.taken.get(accountId) ?? []
    if (!list.includes(replyId)) list.push(replyId)
    this.taken.set(accountId, list.slice(-50))
  }

  /** Reply ids other watches are waiting for or already returned: never ours. */
  claimedByOthers(accountId: string, token: string): Set<string> {
    const out = new Set<string>(this.taken.get(accountId) ?? [])
    for (const [t, w] of this.byAccount.get(accountId) ?? []) if (t !== token && w.target) out.add(w.target)
    return out
  }

  size(accountId: string): number {
    return this.byAccount.get(accountId)?.size ?? 0
  }
}
