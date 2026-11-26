import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readBinding, writeBinding } from '../scripts/lib/binding.mjs'

const tmp = () => mkdtempSync(join(tmpdir(), 'kanban-'))

test('round-trips', () => {
  const d = tmp()
  const b = { owner: 'ksatu', projectNumber: 3, url: 'https://github.com/orgs/ksatu/projects/3' }
  writeBinding(d, b)
  assert.deepEqual(readBinding(d), b)
  assert.ok(readFileSync(join(d, '.github', 'kanban.json'), 'utf8').endsWith('}\n'))
})

test('missing file gives null', () => {
  assert.equal(readBinding(tmp()), null)
})

test('malformed JSON throws', () => {
  const d = tmp()
  mkdirSync(join(d, '.github'))
  writeFileSync(join(d, '.github', 'kanban.json'), '{nope')
  assert.throws(() => readBinding(d), /kanban\.json/)
})
