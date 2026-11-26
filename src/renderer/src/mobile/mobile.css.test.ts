import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const mobileCss = readFileSync(new URL('./mobile.css', import.meta.url), 'utf8')
const shell = mobileCss.slice(mobileCss.indexOf('.mobile-shell'), mobileCss.indexOf('.mobile-frame'))
const frame = mobileCss.slice(mobileCss.indexOf('.mobile-frame'), mobileCss.indexOf('.mobile-safe-top'))

describe('mobile shell viewport sizing', () => {
  it('anchors the shell to the WebView bounds instead of relying on viewport units', () => {
    expect(shell).toMatch(/position:\s*fixed/)
    expect(shell).toMatch(/top:\s*0/)
    expect(shell).toMatch(/right:\s*0/)
    expect(shell).toMatch(/bottom:\s*0/)
    expect(shell).toMatch(/left:\s*0/)
    expect(shell).not.toMatch(/height:\s*100(?:vh|dvh|%)/)
  })

  it('keeps the frame fill the shell height', () => {
    expect(frame).toMatch(/height:\s*100%/)
  })
})
