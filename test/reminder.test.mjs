import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'kanban-reminder.sh')
const tmp = () => mkdtempSync(join(tmpdir(), 'reminder-'))
const git = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  return r.stdout
}

function repo() {
  const root = tmp()
  git(root, 'init', '-q', '-b', 'main')
  git(root, 'config', 'user.email', 't@t')
  git(root, 'config', 'user.name', 't')
  git(root, 'commit', '-q', '--allow-empty', '-m', 'init')
  return root
}

function fakeGh() {
  const dir = tmp()
  writeFileSync(
    join(dir, 'gh'),
    `#!/bin/sh
case "$1 $2" in
  "auth status") exit \${FAKE_AUTH_EXIT:-0} ;;
  "api graphql") printf '%s\\n' "$FAKE_STATUS" ;;
esac
`,
  )
  chmodSync(join(dir, 'gh'), 0o755)
  return dir
}

function run(root, args, { env = {}, path } = {}) {
  const r = spawnSync('sh', [script, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, PATH: path ?? process.env.PATH, ...env },
  })
  return { status: r.status, stderr: r.stderr, stdout: r.stdout }
}

const checkout = (root, branch, flag = '1') => {
  git(root, 'checkout', '-q', '-b', branch)
  return run(root, ['post-checkout', 'x', 'y', flag])
}

test('new unlinked branch warns', () => {
  const r = checkout(repo(), 'perbaiki-login')
  assert.equal(r.status, 0)
  assert.match(r.stderr, /branch 'perbaiki-login' is not linked to an issue/)
  assert.match(r.stderr, /\/start-issue <n>/)
})

test('new linked branch is silent', () => {
  const r = checkout(repo(), 'feat/12-login')
  assert.equal(r.status, 0)
  assert.equal(r.stderr, '')
})

test('file checkout flag 0 is silent', () => {
  const root = repo()
  git(root, 'checkout', '-q', '-b', 'perbaiki-login')
  const r = run(root, ['post-checkout', 'x', 'y', '0'])
  assert.equal(r.stderr, '')
})

test('switching to an existing branch is silent', () => {
  const root = repo()
  git(root, 'checkout', '-q', '-b', 'perbaiki-login')
  git(root, 'checkout', '-q', 'main')
  git(root, 'checkout', '-q', 'perbaiki-login')
  const r = run(root, ['post-checkout', 'x', 'y', '1'])
  assert.equal(r.status, 0)
  assert.equal(r.stderr, '')
})

test('detached HEAD is silent', () => {
  const root = repo()
  git(root, 'checkout', '-q', '--detach')
  assert.equal(run(root, ['post-checkout', 'x', 'y', '1']).stderr, '')
})

test('default branch is silent', () => {
  const root = repo()
  assert.equal(run(root, ['post-checkout', 'x', 'y', '1']).stderr, '')
})

function pushRepo(branch = 'feat/12-login') {
  const root = repo()
  git(root, 'remote', 'add', 'origin', 'git@github.com:ksatu/sitakro.git')
  mkdirSync(join(root, '.github'))
  writeFileSync(
    join(root, '.github', 'kanban.json'),
    '{\n  "owner": "ksatu",\n  "projectNumber": 7,\n  "url": "https://github.com/orgs/ksatu/projects/7"\n}\n',
  )
  git(root, 'checkout', '-q', '-b', branch)
  return root
}
const withGh = () => `${fakeGh()}:${process.env.PATH}`

test('pre-push warns when status is not In progress', () => {
  const r = run(pushRepo(), ['pre-push'], { path: withGh(), env: { FAKE_STATUS: 'Ready' } })
  assert.equal(r.status, 0)
  assert.match(r.stderr, /issue #12 is 'Ready' on the board, expected In progress\. Run \/start-issue 12\./)
})

test('pre-push warns when issue is not on the board', () => {
  const r = run(pushRepo(), ['pre-push'], { path: withGh(), env: { FAKE_STATUS: '' } })
  assert.match(r.stderr, /issue #12 is 'not on board'/)
})

test('pre-push silent for In progress and In review', () => {
  for (const s of ['In progress', 'In review']) {
    const r = run(pushRepo(), ['pre-push'], { path: withGh(), env: { FAKE_STATUS: s } })
    assert.equal(r.stderr, '')
  }
})

test('pre-push silent for unlinked branch', () => {
  const r = run(pushRepo('perbaiki'), ['pre-push'], { path: withGh(), env: { FAKE_STATUS: 'Ready' } })
  assert.equal(r.stderr, '')
})

test('pre-push silent without gh', () => {
  const r = run(pushRepo(), ['pre-push'], { path: '/usr/bin:/bin', env: { FAKE_STATUS: 'Ready' } })
  assert.equal(r.status, 0)
  assert.equal(r.stderr, '')
})

test('pre-push silent when gh auth fails', () => {
  const r = run(pushRepo(), ['pre-push'], { path: withGh(), env: { FAKE_STATUS: 'Ready', FAKE_AUTH_EXIT: '1' } })
  assert.equal(r.status, 0)
  assert.equal(r.stderr, '')
})
