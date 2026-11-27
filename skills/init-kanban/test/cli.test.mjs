import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { main } from '../scripts/kanban.mjs'
import { GhError } from '../scripts/lib/gh.mjs'

const here = dirname(fileURLToPath(import.meta.url))

test('runs as entry point through a symlinked directory', () => {
  const link = join(mkdtempSync(join(tmpdir(), 'kanban-')), 'skill')
  symlinkSync(join(here, '..'), link)
  const r = spawnSync('node', [join(link, 'scripts', 'kanban.mjs'), 'bogus'], { encoding: 'utf8' })
  assert.equal(r.status, 1)
  assert.match(r.stderr, /unknown command 'bogus'/)
})

test('main: unknown command exits 1', async () => {
  assert.equal(await main(['bogus'], { commands: {} }), 1)
})

test('main: GhError exits 2, other error exits 1', async () => {
  const commands = {
    a: () => { throw new GhError('kanban: api down') },
    b: () => { throw new Error('bad') },
  }
  assert.equal(await main(['a'], { commands }), 2)
  assert.equal(await main(['b'], { commands }), 1)
})

test('main: passes raw args after the command name', async () => {
  let got
  const commands = { start: (args) => { got = args; return 0 } }
  assert.equal(await main(['start', '--issue', '5'], { commands }), 0)
  assert.deepEqual(got, ['--issue', '5'])
})

test('init --dry-run prints Would write lines and writes nothing', async () => {
  const { mkdirSync, writeFileSync, readdirSync, chmodSync } = await import('node:fs')
  const { execFileSync } = await import('node:child_process')
  const root = mkdtempSync(join(tmpdir(), 'initdry-'))
  execFileSync('git', ['init', '-q'], { cwd: root })
  const bin = join(root, '..', `bin-${Date.now()}`)
  mkdirSync(bin)
  const script = `#!/usr/bin/env node
const a = process.argv.slice(2)
const j = a.join(' ')
const out = (o) => process.stdout.write(JSON.stringify(o))
if (a[0] === 'repo') out({ owner: { login: 'ksatu' }, name: 'demo', id: 'R_1', defaultBranchRef: { name: 'main' } })
else if (a[0] === 'label') out([])
else if (/projectsV2/.test(j)) out({ data: { repositoryOwner: { projectsV2: { nodes: [] } } } })
else out({ data: { repositoryOwner: { id: 'O_1', __typename: 'Organization' } } })
`
  writeFileSync(join(bin, 'gh'), script)
  chmodSync(join(bin, 'gh'), 0o755)
  const r = spawnSync('node', [join(here, '..', 'scripts', 'kanban.mjs'), 'init', '--dry-run', '--area', 'api'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  })
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /Would write:/)
  assert.match(r.stdout, /CONTRIBUTING\.md/)
  assert.match(r.stdout, /\.github\/kanban\.json/)
  assert.deepEqual(readdirSync(root).filter((f) => f !== '.git'), [])
})

test('main: non-Error throws are handled', async () => {
  const origErr = console.error
  const seen = []
  console.error = (m) => seen.push(m)
  try {
    assert.equal(await main(['a'], { commands: { a: () => { throw 'plain text' } } }), 1)
    assert.equal(await main(['a'], { commands: { a: () => { throw undefined } } }), 1)
  } finally {
    console.error = origErr
  }
  assert.equal(seen[0], 'kanban: plain text')
})

// ---- CLI-level tests with a routed fake gh on PATH ----
const cliSetup = async (routes, { binding = true, files } = {}) => {
  const fs = await import('node:fs')
  const { execFileSync } = await import('node:child_process')
  const root = fs.mkdtempSync(join(tmpdir(), 'clirepo-'))
  execFileSync('git', ['init', '-q'], { cwd: root })
  const bin = fs.mkdtempSync(join(tmpdir(), 'clibin-'))
  fs.writeFileSync(join(bin, 'routes.json'), JSON.stringify(routes))
  fs.writeFileSync(
    join(bin, 'gh'),
    `#!/usr/bin/env node
const fs = require('node:fs')
const a = process.argv.slice(2)
const j = a.join(' ')
const routes = JSON.parse(fs.readFileSync(__dirname + '/routes.json', 'utf8'))
const r = routes.find((x) => new RegExp(x.match, 's').test(j))
if (!r) { process.stderr.write('fake gh: no route for ' + j.slice(0, 200)); process.exit(1) }
if (typeof r.raw === 'string') process.stdout.write(r.raw)
else process.stdout.write(JSON.stringify(a[0] === 'api' ? { data: r.out } : r.out))
`,
  )
  fs.chmodSync(join(bin, 'gh'), 0o755)
  if (binding) {
    fs.mkdirSync(join(root, '.github'))
    fs.writeFileSync(
      join(root, '.github', 'kanban.json'),
      JSON.stringify({ owner: 'ksatu', projectNumber: 3, url: 'https://github.com/orgs/ksatu/projects/3' }),
    )
  }
  for (const [p, c] of Object.entries(files ?? {})) fs.writeFileSync(join(root, p), c)
  const cli = (...args) => {
    const r = spawnSync('node', [join(here, '..', 'scripts', 'kanban.mjs'), ...args], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    })
    return { status: r.status, stdout: r.stdout, stderr: r.stderr }
  }
  return { root, cli }
}

const opt = (id, name) => ({ id, name, color: 'GRAY', description: '' })
const sel = (id, name, options) => ({ __typename: 'ProjectV2SingleSelectField', id, name, options })
const boardRoutes = async ({ workflows = [], labels } = {}) => {
  const { loadDefaults } = await import('../scripts/lib/board.mjs')
  const d = loadDefaults()
  const plain = (id, name) => ({ __typename: 'ProjectV2Field', id, name })
  return [
    { match: '^repo view', out: { owner: { login: 'ksatu' }, name: 'demo', id: 'R_1', defaultBranchRef: { name: 'main' } } },
    { match: 'repositoryOwner\\(login: \\$login\\) \\{ id', out: { repositoryOwner: { id: 'O_1', __typename: 'Organization' } } },
    { match: 'projectsV2\\(first', out: { repositoryOwner: { projectsV2: { nodes: [{ id: 'P_1', number: 3, title: 'demo' }] } } } },
    {
      match: 'repositories\\(first',
      out: {
        node: {
          repositories: { nodes: [{ id: 'R_1' }] },
          fields: {
            nodes: [
              plain('F_t', 'Title'),
              plain('F_p', 'Parent issue'),
              plain('F_s', 'Sub-issues progress'),
              sel('F_status', 'Status', d.status.map((n, i) => opt(`s${i}`, n))),
              sel('F_Area', 'Area', [opt('a1', 'api'), opt('a2', 'shared')]),
              sel('F_Size', 'Size', d.size.map((n, i) => opt(`z${i}`, n))),
            ],
          },
          views: { nodes: d.views.map((v, i) => ({ id: `V${i}`, name: v.name, layout: v.layout })) },
        },
      },
    },
    { match: 'workflows\\(first', out: { node: { workflows: { nodes: workflows } } } },
    { match: '^label list', out: (labels ?? ['bug', 'finding', 'area:api', 'area:shared']).map((name) => ({ name })) },
  ]
}

test('cli init: a second run prints nothing created and no Files written', async () => {
  const { writeBinding } = await import('../scripts/lib/binding.mjs')
  const { writeRepoFiles } = await import('../scripts/lib/repo-files.mjs')
  const { root, cli } = await cliSetup(await boardRoutes(), { binding: false })
  const binding = { owner: 'ksatu', projectNumber: 3, url: 'https://github.com/orgs/ksatu/projects/3' }
  writeBinding(root, binding)
  writeRepoFiles(root, binding, { areas: ['api', 'shared'], language: 'en' })
  const r = cli('init', '--area', 'api')
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /Created: nothing/)
  assert.doesNotMatch(r.stdout, /Files written/)
})

test('cli check prints the pending manual steps', async () => {
  const { cli } = await cliSetup(await boardRoutes())
  const r = cli('check')
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /Manual steps:/)
  assert.match(r.stdout, /Auto-add/)
})

test('cli add-issues: missing units file exits 1', async () => {
  const { cli } = await cliSetup([])
  const r = cli('add-issues', '/no/such/units.json')
  assert.equal(r.status, 1)
  assert.match(r.stderr, /^kanban: cannot read/)
})

const issueRoutes = () => [
  { match: 'projectV2\\(number', out: { repositoryOwner: { projectV2: { id: 'P_1' } } } },
  {
    match: 'fields\\(first',
    out: {
      node: {
        fields: {
          nodes: [
            sel('F_st', 'Status', [opt('S_ready', 'Ready'), opt('S_back', 'Backlog')]),
            sel('F_ar', 'Area', [opt('A_web', 'web')]),
            sel('F_sz', 'Size', [opt('Z_M', 'M')]),
          ],
        },
      },
    },
  },
]
const plan = JSON.stringify({
  source: 'plan.md',
  parent: { key: 'epic', title: 'Epic', body: 'B' },
  units: [{ key: 'u1', title: 'U', body: 'B', area: 'web', size: 'M' }],
})

test('cli add-issues --dry-run prints Would create', async () => {
  const { root, cli } = await cliSetup(issueRoutes(), { files: { 'plan.md': '# Plan\n', 'units.json': plan } })
  const r = cli('add-issues', join(root, 'units.json'), '--dry-run')
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /Would create: epic, u1/)
})

test('cli add-issues prints "Update recorded" only when the doc changed', async () => {
  const wiring = [
    { match: '^issue create', raw: 'https://github.com/ksatu/demo/issues/5\n' },
    { match: '^issue view', out: { id: 'I_5' } },
    { match: 'addProjectV2ItemById', out: { addProjectV2ItemById: { item: { id: 'ITEM' } } } },
    { match: 'updateProjectV2ItemFieldValue', out: {} },
    { match: 'addSubIssue', out: {} },
  ]
  const { root, cli } = await cliSetup([...wiring, ...issueRoutes()], { files: { 'plan.md': '# Plan\n', 'units.json': plan } })
  const first = cli('add-issues', join(root, 'units.json'))
  assert.equal(first.status, 0, first.stderr)
  assert.match(first.stdout, /Update recorded in plan\.md/)
  const again = cli('add-issues', join(root, 'units.json'))
  assert.equal(again.status, 0, again.stderr)
  assert.doesNotMatch(again.stdout, /Update recorded/)
})
