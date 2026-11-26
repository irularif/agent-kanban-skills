import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { detectHookMechanism, installHooks } from '../scripts/lib/hooks.mjs'

const tmp = () => mkdtempSync(join(tmpdir(), 'hooks-'))
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' })
const gitRepo = () => {
  const root = tmp()
  git(root, 'init', '-q')
  return root
}
const read = (root, p) => readFileSync(join(root, p), 'utf8')

test('hooksPath: appends block, keeps existing content first, idempotent', () => {
  const root = gitRepo()
  git(root, 'config', 'core.hooksPath', '.githooks')
  mkdirSync(join(root, '.githooks'))
  const old = '#!/bin/sh\necho old\n'
  writeFileSync(join(root, '.githooks/pre-push'), old)
  assert.deepEqual(detectHookMechanism(root), { kind: 'hooksPath', dir: '.githooks' })

  const r = installHooks(root)
  assert.deepEqual(r.manual, [])
  assert.deepEqual(r.changed.sort(), [
    '.githooks/kanban-reminder.sh',
    '.githooks/post-checkout',
    '.githooks/pre-push',
  ])
  const pre = read(root, '.githooks/pre-push')
  assert.ok(pre.startsWith(old))
  assert.ok(pre.indexOf('echo old') < pre.indexOf('# kanban:start'))
  assert.match(pre, /kanban-reminder\.sh" pre-push "\$@" \|\| true/)
  assert.match(read(root, '.githooks/post-checkout'), /^#!\/bin\/sh\n/)
  for (const f of ['post-checkout', 'pre-push', 'kanban-reminder.sh']) {
    assert.equal(statSync(join(root, '.githooks', f)).mode & 0o777, 0o755)
  }
  assert.deepEqual(installHooks(root).changed, [])
})

test('husky: files under .husky', () => {
  const root = gitRepo()
  mkdirSync(join(root, '.husky'))
  assert.deepEqual(detectHookMechanism(root), { kind: 'husky', dir: '.husky' })
  const r = installHooks(root)
  assert.ok(r.changed.includes('.husky/pre-push'))
  assert.ok(existsSync(join(root, '.husky/kanban-reminder.sh')))
})

test('lefthook: nothing written, manual snippet', () => {
  const root = gitRepo()
  writeFileSync(join(root, 'lefthook.yml'), 'pre-commit:\n')
  assert.equal(detectHookMechanism(root).kind, 'lefthook')
  const r = installHooks(root)
  assert.deepEqual(r.changed, [])
  assert.ok(r.manual.length > 0)
  assert.equal(read(root, 'lefthook.yml'), 'pre-commit:\n')
})

test('none: manual instructions', () => {
  const root = gitRepo()
  assert.equal(detectHookMechanism(root).kind, 'none')
  const r = installHooks(root)
  assert.deepEqual(r.changed, [])
  assert.ok(r.manual.length > 0)
})
