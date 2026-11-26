import { test } from 'node:test'
import assert from 'node:assert/strict'
import { upsertBlock, readBlock } from '../scripts/lib/markers.mjs'

const S = '<!-- kanban:start -->'
const E = '<!-- kanban:end -->'

test('creates block in empty text', () => {
  assert.equal(upsertBlock('', 'X', 'md'), `${S}\nX\n${E}\n`)
})

test('appends after existing text with one blank line', () => {
  assert.equal(upsertBlock('# Title\n', 'X', 'md'), `# Title\n\n${S}\nX\n${E}\n`)
})

test('replaces only the block body', () => {
  const t = `${S}\nold\n${E}\n\nafter\n`
  assert.equal(upsertBlock(t, 'new', 'md'), `${S}\nnew\n${E}\n\nafter\n`)
})

test('idempotent', () => {
  const t = '# Title\n'
  const once = upsertBlock(t, 'b', 'md')
  assert.equal(upsertBlock(once, 'b', 'md'), once)
})

test('sh style', () => {
  assert.equal(upsertBlock('', 'X', 'sh'), '# kanban:start\nX\n# kanban:end\n')
  assert.equal(readBlock('# kanban:start\nX\n# kanban:end\n', 'sh'), 'X')
})

test('keeps CRLF', () => {
  const out = upsertBlock('# T\r\n', 'X', 'md')
  assert.equal(out, `# T\r\n\r\n${S}\r\nX\r\n${E}\r\n`)
  assert.equal(upsertBlock(out, 'Y', 'md'), `# T\r\n\r\n${S}\r\nY\r\n${E}\r\n`)
})

test('readBlock returns body or null', () => {
  assert.equal(readBlock(`a\n${S}\nX\nY\n${E}\n`, 'md'), 'X\nY')
  assert.equal(readBlock('nothing\n', 'md'), null)
})

test('throws on unbalanced markers', () => {
  assert.throws(() => upsertBlock(`${S}\nx\n`, 'b', 'md'), /unbalanced markers/)
  assert.throws(() => upsertBlock(`x\n${E}\n`, 'b', 'md'), /unbalanced markers/)
  assert.throws(() => upsertBlock(`${S}\n${S}\n${E}\n`, 'b', 'md'), /unbalanced markers/)
  assert.throws(() => readBlock(`${S}\nx\n`, 'md'), /unbalanced markers/)
})

test('mixed line endings outside the block are preserved byte for byte', () => {
  const t = `a\r\nb\n${S}\nold\n${E}\r\nc\nd\r\n`
  assert.equal(upsertBlock(t, 'new', 'md'), `a\r\nb\n${S}\nnew\n${E}\r\nc\nd\r\n`)
  const crlf = `a\r\n${S}\r\nold\r\n${E}\r\nb`
  assert.equal(upsertBlock(crlf, 'x\ny', 'md'), `a\r\n${S}\r\nx\r\ny\r\n${E}\r\nb`)
})
