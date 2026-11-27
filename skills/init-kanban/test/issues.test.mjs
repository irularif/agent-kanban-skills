import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fakeGh } from './fake-gh.mjs'
import { addIssues, addItem } from '../scripts/lib/issues.mjs'

const S = '<!-- kanban:start -->'
const E = '<!-- kanban:end -->'
const q = (re) => (a) => a[1] === 'graphql' && re.test(a[2])

function setup({ source = '# Plan\n', failCreateAt = null, conflicts = 0, start = 100, alreadyInBoard = false, failAddSub = false, addSubMessage = 'nope' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'issues-'))
  mkdirSync(join(root, '.github'))
  writeFileSync(join(root, '.github', 'kanban.json'), JSON.stringify({ owner: 'ksatu', projectNumber: 3, url: 'https://github.com/orgs/ksatu/projects/3' }))
  writeFileSync(join(root, 'plan.md'), source)
  let next = start
  let conflictsLeft = conflicts
  let creates = 0
  const gh = fakeGh([
    [q(/projectV2\(number/), { repositoryOwner: { projectV2: { id: 'P_1' } } }],
    [q(/fields\(first/), {
      node: {
        fields: {
          nodes: [
            { id: 'F_st', name: 'Status', options: [{ id: 'S_ready', name: 'Ready' }, { id: 'S_back', name: 'Backlog' }] },
            { id: 'F_ar', name: 'Area', options: [{ id: 'A_web', name: 'web' }, { id: 'A_api', name: 'api' }] },
            { id: 'F_sz', name: 'Size', options: [{ id: 'Z_S', name: 'S' }, { id: 'Z_M', name: 'M' }, { id: 'Z_L', name: 'L' }] },
          ],
        },
      },
    }],
    [(a) => a[0] === 'issue' && a[1] === 'create', () => {
      creates += 1
      if (failCreateAt === creates) throw new Error('kanban: gh issue failed: boom')
      next += 1
      return `https://github.com/ksatu/sitakro/issues/${next}\n`
    }],
    [(a) => a[0] === 'issue' && a[1] === 'view', (a) => ({ id: `I_${a[2]}` })],
    [q(/projectItems\(first: 20\)/), { node: { projectItems: { nodes: [{ id: 'ITEM_other', project: { id: 'P_x' } }, { id: 'ITEM_auto', project: { id: 'P_1' } }] } } }],
    [q(/addProjectV2ItemById/), () => {
      if (alreadyInBoard) throw new Error('kanban: GraphQL error: Content already exists in this project')
      if (conflictsLeft > 0) {
        conflictsLeft -= 1
        throw new Error('kanban: GraphQL error: temporary conflict, try again')
      }
      return { addProjectV2ItemById: { item: { id: 'ITEM' } } }
    }],
    [q(/updateProjectV2ItemFieldValue/), {}],
    [q(/addSubIssue/), () => {
      if (failAddSub) throw new Error(`kanban: GraphQL error: ${addSubMessage}`)
      return {}
    }],
  ])
  return { root, gh }
}

const plan = (units) => ({
  source: 'plan.md',
  parent: { key: 'epic', title: 'Surat arsip', body: 'Epic body' },
  units,
})
const u = (key, extra = {}) => ({ key, title: `T ${key}`, body: `B ${key}`, area: 'web', size: 'M', ...extra })
const opts = { retryDelayMs: 0 }
const creates = (gh) => gh.calls.filter((a) => a[0] === 'issue' && a[1] === 'create')
const withGql = (gh, re) => gh.calls.filter((a) => a[1] === 'graphql' && re.test(a[2]))

test('fresh run creates parent and units, wires board, writes map', () => {
  const { root, gh } = setup()
  const r = addIssues(gh, root, plan([u('u1'), u('u2', { area: 'api', size: 'S', status: 'Backlog' })]), opts)
  assert.deepEqual(r, { created: [101, 102, 103], existing: [], parent: 101 })
  assert.equal(creates(gh).length, 3)
  const parentCall = creates(gh)[0]
  assert.ok(!parentCall.includes('--label'))
  assert.ok(parentCall.join(' ').includes('Epic body\n\nSource: plan.md'))
  const unit1 = creates(gh)[1]
  assert.equal(unit1[unit1.indexOf('--label') + 1], 'area:web')
  assert.equal(unit1[unit1.indexOf('--body') + 1], 'B u1\n\nSource: plan.md')
  assert.equal(withGql(gh, /addSubIssue/).length, 2)
  assert.match(withGql(gh, /addSubIssue/)[0][2], /issueId: "I_101", subIssueId: "I_102"/)
  assert.equal(withGql(gh, /addProjectV2ItemById/).length, 3)
  const upd = withGql(gh, /updateProjectV2ItemFieldValue/).map((a) => a[2])
  assert.ok(upd.some((m) => m.includes('"F_st"') && m.includes('"S_ready"')))
  assert.ok(upd.some((m) => m.includes('"F_st"') && m.includes('"S_back"')))
  assert.ok(upd.some((m) => m.includes('"F_ar"') && m.includes('"A_api"')))
  assert.ok(upd.some((m) => m.includes('"F_sz"') && m.includes('"Z_S"')))
  const text = readFileSync(join(root, 'plan.md'), 'utf8')
  assert.equal(text, `# Plan\n\n${S}\nkanban-issues: {"epic":101,"u1":102,"u2":103}\n${E}\n`)
})

test('re-run only creates missing units and never touches existing', () => {
  const source = `# Plan\n\n${S}\nkanban-issues: {"epic":101,"u1":102}\n${E}\n`
  const { root, gh } = setup({ source, start: 102 })
  const r = addIssues(gh, root, plan([u('u1', { title: 'renamed' }), u('u2')]), opts)
  assert.deepEqual(r, { created: [103], existing: [101, 102], parent: 101 })
  assert.equal(creates(gh).length, 1)
  assert.ok(!gh.calls.some((a) => a[0] === 'issue' && a[1] === 'edit'))
  assert.match(withGql(gh, /addSubIssue/)[0][2], /issueId: "I_101", subIssueId: "I_103"/)
  assert.equal(withGql(gh, /addSubIssue/).length, 1)
  assert.match(readFileSync(join(root, 'plan.md'), 'utf8'), /\{"epic":101,"u1":102,"u2":103\}/)
})

test('invalid area, size or status throws before any write', () => {
  for (const bad of [{ area: 'mobile' }, { size: 'XL' }, { status: 'Done' }]) {
    const { root, gh } = setup()
    assert.throws(() => addIssues(gh, root, plan([u('u1', bad)]), opts), /kanban:/)
    assert.equal(creates(gh).length, 0)
  }
})

test('failure on 2nd unit keeps partial map', () => {
  const { root, gh } = setup({ failCreateAt: 3 })
  assert.throws(() => addIssues(gh, root, plan([u('u1'), u('u2')]), opts), /boom/)
  assert.match(readFileSync(join(root, 'plan.md'), 'utf8'), /kanban-issues: \{"epic":101,"u1":102\}/)
})

test('dryRun makes no create call and leaves the file alone', () => {
  const { root, gh } = setup()
  const r = addIssues(gh, root, plan([u('u1')]), { ...opts, dryRun: true })
  assert.equal(creates(gh).length, 0)
  assert.equal(withGql(gh, /addProjectV2ItemById/).length, 0)
  assert.equal(readFileSync(join(root, 'plan.md'), 'utf8'), '# Plan\n')
  assert.deepEqual(r.planned, ['epic', 'u1'])
})

test('retries addProjectV2ItemById on temporary conflict', () => {
  const { root, gh } = setup({ conflicts: 2 })
  addIssues(gh, root, { ...plan([]), units: [] }, opts)
  assert.equal(withGql(gh, /addProjectV2ItemById/).length, 3)
})

test('gives up after 3 conflicts', () => {
  const { root, gh } = setup({ conflicts: 5 })
  assert.throws(() => addIssues(gh, root, plan([]), opts), /temporary conflict/)
  assert.equal(withGql(gh, /addProjectV2ItemById/).length, 3)
})

test('failure after create keeps key pending; re-run rewires without creating', () => {
  const first = setup({ failAddSub: true })
  assert.throws(() => addIssues(first.gh, first.root, plan([u('u1')]), opts), /nope/)
  const text = readFileSync(join(first.root, 'plan.md'), 'utf8')
  assert.match(text, /kanban-issues: \{"epic":101,"u1":102\}\nkanban-pending: \["u1"\]/)

  const second = setup({ source: text, start: 102 })
  const r = addIssues(second.gh, second.root, plan([u('u1')]), opts)
  assert.equal(creates(second.gh).length, 0)
  assert.equal(r.created.length, 0)
  assert.equal(withGql(second.gh, /addProjectV2ItemById/).length, 1)
  assert.equal(withGql(second.gh, /updateProjectV2ItemFieldValue/).length, 3)
  assert.equal(withGql(second.gh, /addSubIssue/).length, 1)
  assert.doesNotMatch(readFileSync(join(second.root, 'plan.md'), 'utf8'), /kanban-pending/)
})

test('new parent links units that already exist', () => {
  const source = `# Plan\n\n${S}\nkanban-issues: {"u1":102}\n${E}\n`
  const { root, gh } = setup({ source, start: 110 })
  const r = addIssues(gh, root, plan([u('u1')]), opts)
  assert.equal(r.parent, 111)
  assert.equal(creates(gh).length, 1)
  assert.match(withGql(gh, /addSubIssue/)[0][2], /issueId: "I_111", subIssueId: "I_102"/)
})

test('duplicate keys and missing parent are rejected before writes', () => {
  const { root, gh } = setup()
  assert.throws(() => addIssues(gh, root, plan([u('u1'), u('u1')]), opts), /duplicate key/)
  assert.throws(() => addIssues(gh, root, { source: 'plan.md', units: [] }, opts), /no parent/)
  assert.equal(creates(gh).length, 0)
})

test('parent defaults to Status Ready', () => {
  const { root, gh } = setup()
  addIssues(gh, root, plan([]), opts)
  const upd = withGql(gh, /updateProjectV2ItemFieldValue/).map((a) => a[2])
  assert.ok(upd.some((m) => m.includes('"F_st"') && m.includes('"S_ready"')))
})

test('title and body are required for parent and units', () => {
  for (const bad of [{ title: '' }, { body: '  ' }, { title: 5 }, { body: undefined }]) {
    const { root, gh } = setup()
    assert.throws(() => addIssues(gh, root, plan([u('u1', bad)]), opts), /kanban: .*(title|body)/)
    assert.equal(creates(gh).length, 0)
    const p = plan([])
    p.parent = { ...p.parent, ...bad }
    assert.throws(() => addIssues(gh, root, p, opts), /kanban: .*(title|body)/)
    assert.equal(creates(gh).length, 0)
  }
})

test('unknown area error lists the valid areas', () => {
  const { root, gh } = setup()
  assert.throws(() => addIssues(gh, root, plan([u('u1', { area: 'mobile' })]), opts), /valid: web, api/)
})

test('addSubIssue "already" error counts as success', () => {
  const { root, gh } = setup({ failAddSub: true, addSubMessage: 'Issue is already a sub-issue of that parent' })
  const r = addIssues(gh, root, plan([u('u1')]), opts)
  assert.deepEqual(r.created, [101, 102])
  assert.doesNotMatch(readFileSync(join(root, 'plan.md'), 'utf8'), /kanban-pending/)
})

test('other addSubIssue errors still fail', () => {
  const { root, gh } = setup({ failAddSub: true })
  assert.throws(() => addIssues(gh, root, plan([u('u1')]), opts), /nope/)
})

test('addItem resolves an "already exists" error to the existing item id', () => {
  const { gh } = setup({ alreadyInBoard: true })
  assert.equal(addItem(gh, 'P_1', 'I_5', 0), 'ITEM_auto')
  assert.throws(() => addItem(gh, 'P_none', 'I_5', 0), /already exists/)
})

test('add-issues with Auto-add already holding the items leaves nothing pending and sets fields', () => {
  const { root, gh } = setup({ alreadyInBoard: true })
  const r = addIssues(gh, root, plan([u('u1')]), opts)
  assert.deepEqual(r.created, [101, 102])
  assert.doesNotMatch(readFileSync(join(root, 'plan.md'), 'utf8'), /kanban-pending/)
  const upd = withGql(gh, /updateProjectV2ItemFieldValue/).map((a) => a[2])
  assert.ok(upd.length >= 4 && upd.every((m) => m.includes('"ITEM_auto"')))
})

test('units re-linked because the parent is new are recorded as pending before wiring', () => {
  const source = `# Plan\n\n${S}\nkanban-issues: {"u1":102}\n${E}\n`
  const { root, gh } = setup({ source, start: 102, failAddSub: true })
  assert.throws(() => addIssues(gh, root, plan([u('u1')]), opts), /nope/)
  const text = readFileSync(join(root, 'plan.md'), 'utf8')
  assert.match(text, /kanban-pending: \[[^\]]*"u1"/)
})

test('project is looked up by number, once', () => {
  const { root, gh } = setup()
  addIssues(gh, root, plan([u('u1')]), opts)
  assert.equal(withGql(gh, /projectV2\(number/).length, 1)
  assert.equal(withGql(gh, /projectsV2/).length, 0)
})
