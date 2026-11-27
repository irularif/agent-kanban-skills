import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeRepoFiles } from '../scripts/lib/repo-files.mjs'

const binding = { owner: 'ksatu', projectNumber: 7, url: 'https://github.com/orgs/ksatu/projects/7' }
const opts = { areas: ['api', 'web', 'shared'], language: 'en' }
const tmp = () => mkdtempSync(join(tmpdir(), 'repofiles-'))
const read = (root, p) => readFileSync(join(root, p), 'utf8')

test('empty repo: writes forms, CONTRIBUTING and AGENTS', () => {
  const root = tmp()
  const r = writeRepoFiles(root, binding, opts)
  assert.deepEqual(r.changed.sort(), [
    '.github/ISSUE_TEMPLATE/bug.yml',
    '.github/ISSUE_TEMPLATE/finding.yml',
    'AGENTS.md',
    'CONTRIBUTING.md',
  ])
  const bug = read(root, '.github/ISSUE_TEMPLATE/bug.yml')
  assert.ok(bug.startsWith('# kanban:managed\n'))
  assert.match(bug, /projects: \["ksatu\/7"\]/)
  assert.match(bug, /labels: \["bug"\]/)
  assert.match(read(root, '.github/ISSUE_TEMPLATE/finding.yml'), /labels: \["finding"\]/)
  assert.match(read(root, 'AGENTS.md'), /\/start-issue <n>/)
  assert.match(read(root, 'CONTRIBUTING.md'), /Triage/)
})

test('human text around the block is preserved', () => {
  const root = tmp()
  writeFileSync(join(root, 'CONTRIBUTING.md'), 'before\n')
  writeRepoFiles(root, binding, opts)
  const first = read(root, 'CONTRIBUTING.md')
  const edited = `${first}\nafter human text\n`
  writeFileSync(join(root, 'CONTRIBUTING.md'), edited)
  writeRepoFiles(root, binding, { ...opts, language: 'id' })
  const out = read(root, 'CONTRIBUTING.md')
  assert.ok(out.startsWith('before\n'))
  assert.ok(out.endsWith('\nafter human text\n'))
})

test('only CLAUDE.md present: block goes there, no AGENTS.md', () => {
  const root = tmp()
  writeFileSync(join(root, 'CLAUDE.md'), '# Claude\n')
  writeRepoFiles(root, binding, opts)
  assert.match(read(root, 'CLAUDE.md'), /kanban:start/)
  assert.equal(existsSync(join(root, 'AGENTS.md')), false)
})

test('second call changes nothing', () => {
  const root = tmp()
  writeRepoFiles(root, binding, opts)
  assert.deepEqual(writeRepoFiles(root, binding, opts), { changed: [], warnings: [] })
})

test('unmanaged issue form is left alone with a warning', () => {
  const root = tmp()
  mkdirSync(join(root, '.github/ISSUE_TEMPLATE'), { recursive: true })
  const mine = 'name: Mine\n'
  writeFileSync(join(root, '.github/ISSUE_TEMPLATE/bug.yml'), mine)
  const r = writeRepoFiles(root, binding, opts)
  assert.equal(read(root, '.github/ISSUE_TEMPLATE/bug.yml'), mine)
  assert.ok(!r.changed.includes('.github/ISSUE_TEMPLATE/bug.yml'))
  assert.equal(r.warnings.length, 1)
})

test('language id picks the Indonesian section', () => {
  const root = tmp()
  writeRepoFiles(root, binding, { ...opts, language: 'id' })
  assert.match(read(root, 'CONTRIBUTING.md'), /Kotak masuk|kotak masuk/)
})

test('dryRun lists what would be written without writing', () => {
  const root = tmp()
  const r = writeRepoFiles(root, binding, { ...opts, dryRun: true })
  assert.deepEqual(r.changed.sort(), [
    '.github/ISSUE_TEMPLATE/bug.yml',
    '.github/ISSUE_TEMPLATE/finding.yml',
    'AGENTS.md',
    'CONTRIBUTING.md',
  ])
  assert.equal(existsSync(join(root, 'CONTRIBUTING.md')), false)
})

test('contributing text says /init-kanban installs hooks and describes the real warnings', () => {
  for (const language of ['en', 'id']) {
    const root = tmp()
    writeRepoFiles(root, binding, { ...opts, language })
    const text = read(root, 'CONTRIBUTING.md')
    assert.match(text, /\/init-kanban/)
    assert.doesNotMatch(text, /installed by `\/start-issue`|dipasang oleh `\/start-issue`/)
    assert.match(text, /In progress/)
  }
})

test('managed form detection accepts CRLF', () => {
  const root = tmp()
  mkdirSync(join(root, '.github/ISSUE_TEMPLATE'), { recursive: true })
  writeFileSync(join(root, '.github/ISSUE_TEMPLATE/bug.yml'), '# kanban:managed\r\nold\r\n')
  const r = writeRepoFiles(root, binding, opts)
  assert.deepEqual(r.warnings, [])
  assert.ok(r.changed.includes('.github/ISSUE_TEMPLATE/bug.yml'))
})

test('missing binding url is an error unless dry-run', () => {
  for (const url of ['', undefined, null]) {
    assert.throws(() => writeRepoFiles(tmp(), { ...binding, url }, opts), /^Error: kanban: .*url/)
  }
  assert.doesNotThrow(() => writeRepoFiles(tmp(), { ...binding, url: null }, { ...opts, dryRun: true }))
})
