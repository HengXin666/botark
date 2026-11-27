#!/usr/bin/env node
/**
 * Generate a BotArk web password hash for BOTARK_WEB_PASSWORD_HASH.
 *
 * Usage:
 *   printf '%s' 'your long password' | npm run web:hash-password
 *   echo 'your long password' | npm run web:hash-password
 *
 * The password is read from stdin so it does not appear in shell history.
 */
import { randomBytes, scryptSync } from 'node:crypto'

const chunks = []
for await (const chunk of process.stdin) chunks.push(chunk)
const password = Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '')

if (password.length < 8) {
  console.error('Password must be at least 8 characters.')
  process.exit(1)
}

const N = 16384
const r = 8
const p = 1
const salt = randomBytes(16)
const hash = scryptSync(password, salt, 64, { N, r, p, maxmem: 64 * 1024 * 1024 })
const b64 = (value) => Buffer.from(value).toString('base64url')
console.log(['scrypt', String(N), String(r), String(p), b64(salt), b64(hash)].join('$'))
