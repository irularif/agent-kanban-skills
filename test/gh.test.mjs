import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createGh, GhError } from '../scripts/lib/gh.mjs'
import { fakeGh } from './fake-gh.mjs'

test('graphql errors throw GhError', () => {
  const gh = createGh({ exec: () => ({ status: 0, stdout: '{"errors":[{"message":"x"}]}', stderr: '' }) })
  assert.throws(() => gh.graphql('query { a }'), (e) => e instanceof GhError && e.errors.length === 1)
})

test('graphql returns data and passes vars', () => {
  let seen
  const gh = createGh({ exec: (cmd, args) => { seen = [cmd, args]; return { status: 0, stdout: '{"data":{"a":1}}', stderr: '' } } })
  assert.deepEqual(gh.graphql('query { a }', { n: 5 }), { a: 1 })
  assert.deepEqual(seen[1], ['api', 'graphql', '-f', 'query=query { a }', '-F', 'n=5'])
})

test('non-zero status throws with stderr', () => {
  const gh = createGh({ exec: () => ({ status: 1, stdout: '', stderr: 'boom' }) })
  assert.throws(() => gh.run(['x']), (e) => e instanceof GhError && /boom/.test(e.message))
  assert.throws(() => gh.json(['x']), GhError)
})

test('json parses stdout', () => {
  const gh = createGh({ exec: () => ({ status: 0, stdout: '[1,2]', stderr: '' }) })
  assert.deepEqual(gh.json(['x']), [1, 2])
})

test('fakeGh routes and records', () => {
  const gh = fakeGh([[/repo view/, { a: 1 }], [(a) => a.includes('q'), 'ok']])
  assert.deepEqual(gh.json(['repo', 'view']), { a: 1 })
  assert.equal(gh.run(['q']), 'ok')
  assert.equal(gh.calls.length, 2)
  assert.throws(() => gh.json(['nope']), /no route/)
})

test('graphql types vars: strings via -f, numbers/booleans via -F', () => {
  let args
  const gh = createGh({ exec: (_c, a) => { args = a; return { status: 0, stdout: '{"data":{}}', stderr: '' } } })
  gh.graphql('q', { id: '98236657', n: 3, ok: true })
  assert.deepEqual(args.slice(4), ['-f', 'id=98236657', '-F', 'n=3', '-F', 'ok=true'])
  assert.throws(() => gh.graphql('q', { o: {} }), /must be scalar/)
})
