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
