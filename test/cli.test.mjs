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
