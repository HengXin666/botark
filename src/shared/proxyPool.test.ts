import { describe, expect, it } from 'vitest'
import { createMutex, planPoolAssignment, planSinglePoolSwap, releasePoolSlot } from './proxyPool'

const pool = (...owners: Array<string | undefined>) => owners.map((o, i) => ({ id: `p${i}`, assignedAccountId: o }))

describe('planPoolAssignment', () => {
  it('keeps existing slots and fills new accounts from free ones', () => {
    const { pool: next, assigned } = planPoolAssignment(pool('a', undefined, undefined), ['a', 'b'])
    expect(next.map((s) => s.assignedAccountId)).toEqual(['a', 'b', undefined])
    expect(assigned.map((x) => [x.accountId, x.slot.id])).toEqual([['a', 'p0'], ['b', 'p1']])
  })

  it('does not hand an in-flight account slot to someone else', () => {
    // "a" is still logging in and was left out of the caller list.
    const { pool: next } = planPoolAssignment(pool('a', undefined), ['b'], (id) => id === 'a')
    expect(next.map((s) => s.assignedAccountId)).toEqual(['a', 'b'])
  })

  it('never shares a slot when the pool runs out', () => {
    const { pool: next, assigned } = planPoolAssignment(pool(undefined), ['a', 'b'])
    expect(next[0]!.assignedAccountId).toBe('a')
    expect(assigned.map((x) => x.accountId)).toEqual(['a'])
  })

  it('does not mutate the input', () => {
    const input = pool('x')
    planPoolAssignment(input, ['y'])
    expect(input[0]!.assignedAccountId).toBe('x')
  })
})

describe('releasePoolSlot', () => {
  it('frees only that account', () => {
    expect(releasePoolSlot(pool('a', 'b'), 'a').map((s) => s.assignedAccountId)).toEqual([undefined, 'b'])
  })
})

describe('planSinglePoolSwap', () => {
  const p = (...rows: Array<[string, string | undefined]>) =>
    rows.map(([id, owner]) => ({ id, assignedAccountId: owner }))

  it('releases the old slot and picks the first free live one', () => {
    const { pool: next, chosen } = planSinglePoolSwap(
      p(['old', 'acc'], ['free-dead', undefined], ['free-live', undefined], ['other', 'someone']),
      'acc',
      new Set(['free-live']),
      new Set(['free-dead'])
    )
    expect(chosen?.id).toBe('free-live')
    expect(next.map((s) => [s.id, s.assignedAccountId])).toEqual([
      ['old', undefined],
      ['free-live', 'acc'],
      ['other', 'someone']
    ])
  })

  it('never takes a slot held by another account', () => {
    const { pool: next, chosen } = planSinglePoolSwap(
      p(['own', 'acc'], ['busy', 'other']),
      'acc',
      new Set(['own', 'busy']),
      new Set()
    )
    expect(chosen).toBeUndefined()
    expect(next.find((s) => s.id === 'busy')?.assignedAccountId).toBe('other')
  })

  it('keeps the current slot when no free working node exists', () => {
    const { pool: next, chosen } = planSinglePoolSwap(
      p(['own', 'acc'], ['dead', undefined]),
      'acc',
      new Set(),
      new Set(['dead'])
    )
    expect(chosen).toBeUndefined()
    // Only the dead slot is removed; the account's binding is untouched.
    expect(next.map((s) => [s.id, s.assignedAccountId])).toEqual([['own', 'acc']])
  })

  it('drops probed-dead slots even when nothing is assignable', () => {
    const { pool: next, chosen } = planSinglePoolSwap(
      p(['dead', undefined], ['kept', 'other']),
      'acc',
      new Set(),
      new Set(['dead'])
    )
    expect(chosen).toBeUndefined()
    expect(next.map((s) => s.id)).toEqual(['kept'])
  })

  it('does not mutate the input', () => {
    const input = p(['own', 'acc'], ['free', undefined])
    planSinglePoolSwap(input, 'acc', new Set(['free']), new Set())
    expect(input[0]!.assignedAccountId).toBe('acc')
    expect(input[1]!.assignedAccountId).toBeUndefined()
  })
})

describe('createMutex', () => {
  it('runs sections one at a time even across awaits', async () => {
    const lock = createMutex()
    let value = 0
    const bump = () =>
      lock(async () => {
        const read = value
        await new Promise((r) => setTimeout(r, 5))
        value = read + 1
      })
    await Promise.all([bump(), bump(), bump()])
    expect(value).toBe(3)
  })

  it('keeps going after a section throws', async () => {
    const lock = createMutex()
    await expect(lock(() => Promise.reject(new Error('x')))).rejects.toThrow('x')
    await expect(lock(() => 1)).resolves.toBe(1)
  })
})
