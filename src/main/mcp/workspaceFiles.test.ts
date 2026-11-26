import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { workspaceFile } from './workspaceFiles'

let dir: string, root: string
beforeEach(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), 'workspace-fixture-')))
  root = join(dir, 'root')
  await mkdir(root)
})
afterEach(() => rm(dir, { recursive: true, force: true }))

it('rejects traversal, linked parents and writes to links', async () => {
  await writeFile(join(dir, 'outside.txt'), 'fixture')
  // Use NTFS junction on Windows so the link test runs without Developer Mode / admin elevation
  await symlink(dir, join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir')

  const paths = ['../outside.txt', 'link/outside.txt', 'link']
  try {
    await symlink(join(dir, 'outside.txt'), join(root, 'file'))
    paths.push('file')
  } catch (err) {
    if (process.platform !== 'win32' || (err as NodeJS.ErrnoException).code !== 'EPERM') {
      throw err
    }
  }

  for (const path of paths) {
    await expect(workspaceFile(root, 'read', { path })).rejects.toThrow()
    await expect(workspaceFile(root, 'write', { path, text: 'changed' })).rejects.toThrow()
  }
  expect(await readFile(join(dir, 'outside.txt'), 'utf8')).toBe('fixture')
})

it('applies an unambiguous literal patch and preserves content on a failed match', async () => {
  await workspaceFile(root, 'write', { path: 'draft', text: 'a a b' })
  await expect(workspaceFile(root, 'patch', { path: 'draft', before: 'a', after: 'x' })).rejects.toThrow('exactly once')
  await workspaceFile(root, 'patch', { path: 'draft', before: 'b', after: '$1' })
  expect(await workspaceFile(root, 'read', { path: 'draft' })).toBe('a a $1')
})

it('serializes approved patches to the same canonical file', async () => {
  await mkdir(join(root, 'src'))
  await writeFile(join(root, 'src', 'draft'), 'first second')
  await symlink(join(root, 'src'), join(root, 'alias'), process.platform === 'win32' ? 'junction' : 'dir')
  await Promise.all([
    workspaceFile(root, 'patch', { path: 'src/draft', before: 'first', after: 'one' }),
    workspaceFile(root, 'patch', { path: 'alias/draft', before: 'second', after: 'two' })
  ])
  expect(await readFile(join(root, 'src', 'draft'), 'utf8')).toBe('one two')
})

it('rejects and hides credential files while allowing env templates', async () => {
  await writeFile(join(root, '.env'), 'TOKEN=secret')
  await writeFile(join(root, '.env.example'), 'TOKEN=placeholder')
  await mkdir(join(root, '.ssh'))
  await writeFile(join(root, '.ssh', 'id_rsa'), 'private')
  await mkdir(join(root, '.hxoa'))
  await writeFile(join(root, '.hxoa', 'hx-login.json'), '{"token":"secret","key":"secret"}')

  await expect(workspaceFile(root, 'read', { path: '.hxoa/hx-login.json' })).rejects.toThrow('Sensitive')
  await expect(workspaceFile(root, 'read', { path: '.env' })).rejects.toThrow('Sensitive')
  await expect(workspaceFile(root, 'write', { path: '.ssh/id_rsa', text: 'x' })).rejects.toThrow('Sensitive')
  expect(await workspaceFile(root, 'read', { path: '.env.example' })).toBe('TOKEN=placeholder')
  const listing = await workspaceFile(root, 'search', { path: '.', query: '' })
  expect(listing.split('\n').map((line) => line.replace(/\/$/, ''))).not.toContain('.env')
  expect(listing.split('\n').map((line) => line.replace(/\/$/, ''))).not.toContain('.ssh')
  expect(listing).toContain('.env.example')
})

it('rejects symlinks that resolve to sensitive files or directories', async () => {
  await writeFile(join(root, '.env'), 'TOKEN=secret')
  await symlink('.env', join(root, 'env-link'), process.platform === 'win32' ? 'file' : undefined)
  await expect(workspaceFile(root, 'read', { path: 'env-link' })).rejects.toThrow('Sensitive')

  await mkdir(join(root, '.ssh'))
  await writeFile(join(root, '.ssh', 'id_rsa'), 'private')
  await symlink('.ssh', join(root, 'ssh-link'), process.platform === 'win32' ? 'junction' : 'dir')
  await expect(workspaceFile(root, 'list', { path: 'ssh-link' })).rejects.toThrow('Sensitive')
})

it('skips dependency, build, and VCS directories by default in search', async () => {
  const excluded = ['.git', 'node_modules', 'dist', 'out', '.next', 'target']
  await Promise.all(excluded.map(async (name) => {
    await mkdir(join(root, name))
    await writeFile(join(root, name, 'match.txt'), '')
  }))
  await mkdir(join(root, 'src'))
  await writeFile(join(root, 'src', 'match.txt'), '')
  expect(await workspaceFile(root, 'search', { path: '.', query: 'match' })).toBe(join('src', 'match.txt'))
  expect(await workspaceFile(root, 'search', { path: 'node_modules', query: 'match' }))
    .toBe(join('node_modules', 'match.txt'))
})
