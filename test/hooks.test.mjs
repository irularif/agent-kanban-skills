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

test('husky v9 hooksPath .husky/_ installs into .husky', () => {
  for (const p of ['.husky/_', '.husky/_/']) {
    const root = gitRepo()
    git(root, 'config', 'core.hooksPath', p)
    assert.deepEqual(detectHookMechanism(root), { kind: 'husky', dir: '.husky' })
    const r = installHooks(root)
    assert.ok(r.changed.includes('.husky/pre-push'))
    assert.ok(!existsSync(join(root, '.husky/_')))
  }
})

test('hooksPath outside the repo: nothing written, manual note', () => {
  const shared = tmp()
  for (const p of [shared, '~/kanban-test-hooks-dir']) {
    const root = gitRepo()
    git(root, 'config', 'core.hooksPath', p)
    const r = installHooks(root)
    assert.deepEqual(r.changed, [])
    assert.ok(r.manual.length > 0)
    assert.ok(!existsSync(join(root, p)))
    assert.ok(!existsSync(join(shared, 'pre-push')))
  }
})

test('hooksPath as absolute path inside the repo works', () => {
  const root = gitRepo()
  git(root, 'config', 'core.hooksPath', join(root, '.githooks'))
  const r = installHooks(root)
  assert.ok(r.changed.includes('.githooks/pre-push'))
})

test('existing hook with exit/exec warns the block may never run, and dryRun writes nothing', () => {
  const root = gitRepo()
  git(root, 'config', 'core.hooksPath', '.githooks')
  mkdirSync(join(root, '.githooks'))
  writeFileSync(join(root, '.githooks/pre-push'), '#!/bin/sh\nnpm test\nexec node x.js\n')
  writeFileSync(join(root, '.githooks/post-checkout'), '#!/bin/sh\n  exit 0\n')
  const dry = installHooks(root, { dryRun: true })
  assert.ok(dry.changed.includes('.githooks/pre-push'))
  assert.ok(!existsSync(join(root, '.githooks/kanban-reminder.sh')))
  assert.ok(!read(root, '.githooks/pre-push').includes('kanban:start'))
  const r = installHooks(root)
  assert.equal(r.manual.length, 2)
  assert.ok(r.manual.some((m) => /pre-push/.test(m) && /never run/.test(m)))
  assert.ok(r.manual.some((m) => /post-checkout/.test(m)))
})

test('plain existing hook gives no manual note', () => {
  const root = gitRepo()
  git(root, 'config', 'core.hooksPath', '.githooks')
  mkdirSync(join(root, '.githooks'))
  writeFileSync(join(root, '.githooks/pre-push'), '#!/bin/sh\necho old\n')
  assert.deepEqual(installHooks(root).manual, [])
})
