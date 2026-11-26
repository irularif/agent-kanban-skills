import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fakeGh } from './fake-gh.mjs'
import { startIssue, openPr, closeParents } from '../scripts/lib/work.mjs'

const q = (re) => (a) => a[1] === 'graphql' && re.test(a[2])
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

function repo() {
  const root = mkdtempSync(join(tmpdir(), 'work-'))
  mkdirSync(join(root, '.github'))
  writeFileSync(join(root, '.github', 'kanban.json'), JSON.stringify({ owner: 'ksatu', projectNumber: 3 }))
  git(root, 'init', '-q', '-b', 'main')
  git(root, 'config', 'user.email', 't@t')
  git(root, 'config', 'user.name', 't')
  git(root, 'commit', '-q', '--allow-empty', '-m', 'init')
  return root
}

function board({ title = 'Perbaiki Login: CSRF!', labels = [], parents = [], statusNow = 'In review' } = {}) {
  const status = { current: statusNow }
  const gh = fakeGh([
    [(a) => a[0] === 'repo' && a[1] === 'view', { owner: { login: 'ksatu' }, name: 'sitakro', id: 'R_1', defaultBranchRef: { name: 'main' } }],
    [q(/repositoryOwner\(login: \$login\) \{ id/), { repositoryOwner: { id: 'O_1', __typename: 'Organization' } }],
    [q(/projectsV2/), { repositoryOwner: { projectsV2: { nodes: [{ id: 'P_1', number: 3 }] } } }],
    [q(/fields\(first/), {
      node: {
        fields: {
          nodes: [
            {
              id: 'F_st',
              name: 'Status',
              options: ['Triage', 'Backlog', 'Ready', 'In progress', 'In review', 'Done'].map((n) => ({ id: `S_${n}`, name: n })),
            },
          ],
        },
      },
    }],
    [q(/items\(first/), { node: { items: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: parents.map((p) => ({ content: p })) } } }],
    [(a) => a[0] === 'issue' && a[1] === 'view', (a) => ({ id: `I_${a[2]}`, title, body: 'Isi issue', url: `https://github.com/ksatu/sitakro/issues/${a[2]}`, labels: labels.map((name) => ({ name })) })],
    [(a) => a[0] === 'issue' && a[1] === 'close', ''],
    [q(/addProjectV2ItemById/), { addProjectV2ItemById: { item: { id: 'ITEM' } } }],
    [q(/updateProjectV2ItemFieldValue/), () => ({})],
    [q(/fieldValueByName/), () => ({ node: { fieldValueByName: { name: status.current } } })],
    [(a) => a[0] === 'pr' && a[1] === 'create', 'https://github.com/ksatu/sitakro/pull/50\n'],
  ])
  return { gh, status }
}

const calls = (gh, re) => gh.calls.filter((a) => re.test(a.join(' ')))
const idx = (gh, re) => gh.calls.findIndex((a) => re.test(a.join(' ')))

test('startIssue creates feat branch from slug and sets In progress', () => {
  const root = repo()
  const { gh } = board()
  const r = startIssue(gh, root, 12, { retryDelayMs: 0 })
  assert.equal(r.branch, 'feat/12-perbaiki-login-csrf')
  assert.equal(git(root, 'branch', '--show-current'), 'feat/12-perbaiki-login-csrf')
  assert.deepEqual(r.issue, { title: 'Perbaiki Login: CSRF!', body: 'Isi issue', url: 'https://github.com/ksatu/sitakro/issues/12' })
  const upd = calls(gh, /updateProjectV2ItemFieldValue/)
  assert.equal(upd.length, 1)
  assert.match(upd[0].join(' '), /S_In progress/)
})

test('startIssue uses fix prefix for bug label and explicit prefix wins', () => {
  assert.equal(startIssue(board({ labels: ['bug'] }).gh, repo(), 12, { retryDelayMs: 0 }).branch, 'fix/12-perbaiki-login-csrf')
  assert.equal(startIssue(board({ labels: ['bug'] }).gh, repo(), 12, { prefix: 'chore', retryDelayMs: 0 }).branch, 'chore/12-perbaiki-login-csrf')
})

test('startIssue truncates slug to 40 chars without trailing dash', () => {
  const { gh } = board({ title: 'Satu dua tiga empat lima enam tujuh delapan sembilan sepuluh' })
  const slug = startIssue(gh, repo(), 5, { retryDelayMs: 0 }).branch.replace(/^feat\/5-/, '')
  assert.ok(slug.length <= 40 && !slug.endsWith('-'), slug)
})

test('startIssue adds the issue to the board before setting Status', () => {
  const { gh } = board()
  startIssue(gh, repo(), 12, { retryDelayMs: 0 })
  assert.ok(idx(gh, /addProjectV2ItemById/) >= 0)
  assert.ok(idx(gh, /addProjectV2ItemById/) < idx(gh, /updateProjectV2ItemFieldValue/))
})

test('startIssue retries add on temporary conflict', () => {
  let n = 0
  const { gh } = board()
  const orig = gh.graphql
  gh.graphql = (query, vars) => {
    if (/addProjectV2ItemById/.test(query) && n++ < 2) throw new Error('kanban: GraphQL error: temporary conflict')
    return orig(query, vars)
  }
  startIssue(gh, repo(), 12, { retryDelayMs: 0 })
  assert.equal(n, 3)
})

test('startIssue switches to an existing branch without creating it', () => {
  const root = repo()
  git(root, 'switch', '-q', '-c', 'feat/12-lama')
  git(root, 'commit', '-q', '--allow-empty', '-m', 'work')
  git(root, 'switch', '-q', 'main')
  const { gh } = board()
  const r = startIssue(gh, root, 12, { retryDelayMs: 0 })
  assert.equal(r.branch, 'feat/12-lama')
  assert.equal(git(root, 'branch', '--show-current'), 'feat/12-lama')
  assert.equal(git(root, 'log', '-1', '--format=%s'), 'work')
})

test('startIssue runs closeParents first', () => {
  const { gh } = board({ parents: [{ number: 9, state: 'OPEN', subIssues: { nodes: [{ state: 'CLOSED' }] }, subIssuesSummary: { total: 1 } }] })
  startIssue(gh, repo(), 12, { retryDelayMs: 0 })
  assert.ok(idx(gh, /^issue close 9/) >= 0)
  assert.ok(idx(gh, /^issue close 9/) < idx(gh, /updateProjectV2ItemFieldValue/))
})

test('openPr refuses when branch number differs', () => {
  const root = repo()
  git(root, 'switch', '-q', '-c', 'feat/13-x')
  const { gh } = board()
  assert.throws(() => openPr(gh, root, 12, { recheckMs: 0 }), /#13/)
  assert.equal(calls(gh, /^pr create/).length, 0)
})

test('openPr refuses on a branch without issue number', () => {
  const { gh } = board()
  assert.throws(() => openPr(gh, repo(), 12, { recheckMs: 0 }), /branch/)
})

test('openPr pushes, creates PR with Closes, sets In review', () => {
  const root = repo()
  git(root, 'switch', '-q', '-c', 'feat/12-x')
  const remote = mkdtempSync(join(tmpdir(), 'remote-'))
  git(remote, 'init', '-q', '--bare')
  git(root, 'remote', 'add', 'origin', remote)
  const { gh } = board()
  const r = openPr(gh, root, 12, { recheckMs: 0 })
  assert.equal(r.url, 'https://github.com/ksatu/sitakro/pull/50')
  assert.match(git(remote, 'branch', '--list', 'feat/12-x'), /feat\/12-x/)
  const create = calls(gh, /^pr create/)[0]
  assert.match(create.join(' '), /Closes #12/)
  assert.ok(create.includes('Perbaiki Login: CSRF!'))
  assert.ok(!create.includes('--draft'))
  assert.match(calls(gh, /updateProjectV2ItemFieldValue/)[0].join(' '), /S_In review/)
})

test('openPr re-sets Status when a workflow moved it', () => {
  const root = repo()
  git(root, 'switch', '-q', '-c', 'feat/12-x')
  const remote = mkdtempSync(join(tmpdir(), 'remote-'))
  git(remote, 'init', '-q', '--bare')
  git(root, 'remote', 'add', 'origin', remote)
  const { gh } = board({ statusNow: 'In progress' })
  openPr(gh, root, 12, { recheckMs: 0, draft: true, title: 'Judul' })
  assert.equal(calls(gh, /updateProjectV2ItemFieldValue/).length, 2)
  const create = calls(gh, /^pr create/)[0]
  assert.ok(create.includes('--draft') && create.includes('Judul'))
})

test('openPr does not re-set Status when it already holds', () => {
  const root = repo()
  git(root, 'switch', '-q', '-c', 'feat/12-x')
  const remote = mkdtempSync(join(tmpdir(), 'remote-'))
  git(remote, 'init', '-q', '--bare')
  git(root, 'remote', 'add', 'origin', remote)
  const { gh } = board({ statusNow: 'In review' })
  openPr(gh, root, 12, { recheckMs: 0 })
  assert.equal(calls(gh, /updateProjectV2ItemFieldValue/).length, 1)
})

const parent = (number, states, state = 'OPEN') => ({
  number,
  state,
  subIssues: { nodes: states.map((s) => ({ state: s })) },
  subIssuesSummary: { total: states.length },
})

test('closeParents closes parents whose sub-issues are all closed', () => {
  const { gh } = board({ parents: [parent(1, ['CLOSED', 'CLOSED']), parent(2, ['CLOSED', 'OPEN']), parent(3, []), parent(4, ['CLOSED'], 'CLOSED')] })
  const binding = { owner: 'ksatu', projectNumber: 3 }
  assert.deepEqual(closeParents(gh, binding), [1])
  const close = calls(gh, /^issue close/)
  assert.equal(close.length, 1)
  assert.match(close[0].join(' '), /issue close 1 .*All sub-issues are done\./)
})

function prRepo() {
  const root = repo()
  git(root, 'switch', '-q', '-c', 'feat/12-x')
  const remote = mkdtempSync(join(tmpdir(), 'remote-'))
  git(remote, 'init', '-q', '--bare')
  git(root, 'remote', 'add', 'origin', remote)
  return root
}
const createBody = (gh) => {
  const a = gh.calls.find((c) => c[0] === 'pr' && c[1] === 'create')
  return a[a.indexOf('--body') + 1]
}

test('openPr --body-file appends Closes when missing', () => {
  const root = prRepo()
  const f = join(root, 'body.md')
  writeFileSync(f, 'Ringkasan\n')
  const { gh } = board()
  openPr(gh, root, 12, { recheckMs: 0, retryDelayMs: 0, bodyFile: f })
  assert.equal(createBody(gh), 'Ringkasan\n\nCloses #12')
})

test('openPr --body-file keeps body when Closes already present', () => {
  const root = prRepo()
  const f = join(root, 'body.md')
  writeFileSync(f, 'Ringkasan\n\nCloses #12\n')
  const { gh } = board()
  openPr(gh, root, 12, { recheckMs: 0, retryDelayMs: 0, bodyFile: f })
  assert.equal(createBody(gh).match(/Closes #12/g).length, 1)
})

test('openPr without body file uses Closes only', () => {
  const { gh } = board()
  openPr(gh, prRepo(), 12, { recheckMs: 0, retryDelayMs: 0 })
  assert.equal(createBody(gh), 'Closes #12')
})

test('openPr reuses an existing PR and still sets In review', () => {
  const { gh } = board()
  const orig = gh.run
  gh.json = (a) => (a[0] === 'pr' && a[1] === 'view' ? (gh.calls.push(a), { url: 'https://github.com/ksatu/sitakro/pull/49' }) : orig(a))
  const r = openPr(gh, prRepo(), 12, { recheckMs: 0, retryDelayMs: 0 })
  assert.equal(r.url, 'https://github.com/ksatu/sitakro/pull/49')
  assert.equal(calls(gh, /^pr create/).length, 0)
  assert.match(calls(gh, /updateProjectV2ItemFieldValue/)[0].join(' '), /S_In review/)
})
