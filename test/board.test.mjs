import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fakeGh } from './fake-gh.mjs'
import { ensureBoard, pendingManualSteps, fieldIds, loadDefaults } from '../scripts/lib/board.mjs'

const org = { owner: 'ksatu', name: 'sitakro', ownerId: 'O_1', ownerType: 'Organization', repoId: 'R_1', defaultBranch: 'main' }
const user = { ...org, owner: 'jane', ownerType: 'User', ownerId: 'U_1' }

const sel = (id, name, options) => ({ __typename: 'ProjectV2SingleSelectField', id, name, options })
const opt = (id, name) => ({ id, name, color: 'GRAY', description: '' })
const plain = (id, name) => ({ __typename: 'ProjectV2Field', id, name })
const builtins = [plain('F_t', 'Title'), plain('F_p', 'Parent issue'), plain('F_s', 'Sub-issues progress')]
const freshStatus = sel('F_status', 'Status', [opt('o1', 'Todo'), opt('o2', 'In Progress'), opt('o3', 'Done')])

const q = (re) => (a) => a[1] === 'graphql' && re.test(a[2])
const labelList = (names) => [(a) => a[0] === 'label' && a[1] === 'list', names.map((name) => ({ name }))]

function routes({ projects = [], state = {}, labels = [] } = {}) {
  return [
    [q(/projectsV2/), { repositoryOwner: { projectsV2: { nodes: projects } } }],
    [q(/createProjectV2\(/), { createProjectV2: { projectV2: { id: 'P_new', number: 7 } } }],
    [q(/query\(\$id: ID!\) \{\s+node\(id: \$id\) \{\s+\.\.\. on ProjectV2 \{\s+repositories/), {
      node: { repositories: { nodes: [] }, fields: { nodes: [] }, views: { nodes: [] }, ...state },
    }],
    [q(/workflows\(/), { node: { workflows: { nodes: [] } } }],
    [q(/linkProjectV2ToRepository/), {}],
    [q(/updateProjectV2Field/), {}],
    [q(/createProjectV2Field/), (a) => {
      const name = /name: "(\w+)"/.exec(a[2])[1]
      return { createProjectV2Field: { projectV2Field: sel(`F_${name}`, name, []) } }
    }],
    [q(/createProjectV2View/), {}],
    [q(/updateProjectV2Collaborators/), {}],
    [q(/user\(login/), { user: { id: 'U_dev' } }],
    labelList(labels),
    [(a) => a[0] === 'label' && a[1] === 'create', ''],
  ]
}
const text = (gh) => gh.calls.map((c) => c.join(' '))
const mutations = (gh) => text(gh).filter((t) => /mutation|label create/.test(t))

test('fresh org repo creates everything', () => {
  const gh = fakeGh(routes({ state: { fields: { nodes: [...builtins, freshStatus] } } }))
  const r = ensureBoard(gh, org, { areas: ['web', 'shared'] })
  const t = text(gh)
  assert.match(t.find((x) => /createProjectV2\(/.test(x)), /"ownerId":"O_1"/)
  assert.ok(t.some((x) => /linkProjectV2ToRepository.*"R_1"/.test(x)))
  const upd = t.find((x) => /updateProjectV2Field/.test(x))
  const names = [...upd.matchAll(/name:"([^"]+)"/g)].map((m) => m[1])
  assert.deepEqual(names, ['Triage', 'Backlog', 'Ready', 'In progress', 'In review', 'Done'])
  assert.match(upd, /\{id:"o1",name:"Triage"/)
  assert.match(upd, /\{id:"o2",name:"In progress"/)
  assert.match(upd, /\{id:"o3",name:"Done"/)
  assert.equal((upd.match(/id:"/g) ?? []).length, 3) // only the three kept ids
  assert.match(upd, /name:"Backlog",color:BLUE,description:""/)
  const area = t.find((x) => /createProjectV2Field/.test(x) && /name: "Area"/.test(x))
  assert.match(area, /name:"web"[^]*name:"shared"/)
  assert.ok(t.some((x) => /createProjectV2Field/.test(x) && /name: "Size"/.test(x)))
  const views = t.filter((x) => /createProjectV2View/.test(x))
  assert.equal(views.length, 3)
  assert.match(views[0], /BOARD_LAYOUT/)
  assert.match(views[1], /TABLE_LAYOUT/)
  assert.match(views[1], /visibleFieldIds: \["F_t","F_status","F_p","F_s","F_Area","F_Size"\]/)
  assert.match(views[2], /ROADMAP_LAYOUT/)
  assert.doesNotMatch(views[2], /visibleFieldIds/)
  const labels = t.filter((x) => /^label create/.test(x))
  assert.deepEqual(labels.map((l) => l.split(' ')[2]), ['bug', 'finding', 'area:web', 'area:shared'])
  assert.deepEqual(r.binding, { owner: 'ksatu', projectNumber: 7, url: 'https://github.com/orgs/ksatu/projects/7' })
  assert.equal(r.projectId, 'P_new')
  assert.ok(r.created.includes('field Area') && r.created.includes('view Board'))
  assert.ok(r.manual.length >= 2)
})

test('user-owned repo uses User id and users url', () => {
  const gh = fakeGh(routes({ state: { fields: { nodes: [...builtins, freshStatus] } } }))
  const r = ensureBoard(gh, user, { areas: ['shared'] })
  assert.match(text(gh).find((x) => /createProjectV2\(/.test(x)), /"ownerId":"U_1"/)
  assert.equal(r.binding.url, 'https://github.com/users/jane/projects/7')
})

const fullState = () => {
  const d = loadDefaults()
  return {
    repositories: { nodes: [{ id: 'R_1' }] },
    fields: {
      nodes: [
        ...builtins,
        sel('F_status', 'Status', d.status.map((n, i) => opt(`s${i}`, n))),
        sel('F_Area', 'Area', [opt('a1', 'web'), opt('a2', 'shared')]),
        sel('F_Size', 'Size', d.size.map((n, i) => opt(`z${i}`, n))),
      ],
    },
    views: { nodes: d.views.map((v, i) => ({ id: `V${i}`, name: v.name, layout: v.layout })) },
  }
}
const fullLabels = () => ['bug', 'finding', 'area:web', 'area:shared']

test('second run with everything present makes no mutations', () => {
  const gh = fakeGh(routes({ projects: [{ id: 'P_1', number: 3, title: 'sitakro' }], state: fullState(), labels: fullLabels() }))
  const r = ensureBoard(gh, org, { areas: ['web', 'shared'], binding: { projectNumber: 3 } })
  assert.deepEqual(mutations(gh), [])
  assert.deepEqual(r.created, [])
  assert.equal(r.binding.projectNumber, 3)
})

test('finds the project via the existing binding even when the title differs', () => {
  const gh = fakeGh(routes({ projects: [{ id: 'P_9', number: 9, title: 'renamed' }], state: fullState(), labels: fullLabels() }))
  const r = ensureBoard(gh, org, { areas: ['web', 'shared'], binding: { projectNumber: 9 } })
  assert.equal(r.projectId, 'P_9')
  assert.deepEqual(mutations(gh), [])
})

test('partial state: adds missing Area option, keeps ids, leaves Size alone', () => {
  const state = fullState()
  state.fields.nodes[state.fields.nodes.length - 2] = sel('F_Area', 'Area', [opt('a1', 'web')])
  const gh = fakeGh(routes({ projects: [{ id: 'P_1', number: 3, title: 'sitakro' }], state, labels: fullLabels() }))
  const r = ensureBoard(gh, org, { areas: ['web', 'shared'], binding: { projectNumber: 3 } })
  const m = mutations(gh)
  assert.equal(m.length, 1)
  assert.match(m[0], /fieldId: "F_Area"/)
  assert.match(m[0], /\{id:"a1",name:"web"[^]*\{name:"shared"/)
  assert.deepEqual(r.created, ['options Area'])
})

test('status options never removed on re-run', () => {
  const state = fullState()
  state.fields.nodes[3] = sel('F_status', 'Status', [...loadDefaults().status.map((n, i) => opt(`s${i}`, n)), opt('x', 'Blocked')])
  const gh = fakeGh(routes({ projects: [{ id: 'P_1', number: 3, title: 'sitakro' }], state, labels: fullLabels() }))
  ensureBoard(gh, org, { areas: ['web', 'shared'] })
  assert.deepEqual(mutations(gh), [])
})

test('pagination: label limit, first: 100, 40 labels incl. bug', () => {
  const many = [...Array.from({ length: 39 }, (_, i) => `l${i}`), 'bug']
  const gh = fakeGh(routes({ projects: [{ id: 'P_1', number: 3, title: 'sitakro' }], state: fullState(), labels: many }))
  ensureBoard(gh, org, { areas: ['web', 'shared'] })
  const t = text(gh)
  assert.ok(t.some((x) => /^label list --limit 1000/.test(x)))
  const state = t.find((x) => /views\(first: 100\)/.test(x))
  assert.match(state, /fields\(first: 100\)/)
  assert.ok(!t.some((x) => /^label create bug /.test(x)))
  assert.ok(t.some((x) => /^label create finding /.test(x)))
})

test('dryRun makes no mutations but reports what would be created', () => {
  const gh = fakeGh(routes())
  const r = ensureBoard(gh, org, { areas: ['web'], dryRun: true })
  assert.deepEqual(mutations(gh), [])
  assert.ok(r.created.includes('project') && r.created.includes('view Board'))
  assert.equal(r.projectId, null)
})

test('collaborators: user id lookup and role mapping', () => {
  const gh = fakeGh(routes({ projects: [{ id: 'P_1', number: 3, title: 'sitakro' }], state: fullState(), labels: fullLabels() }))
  ensureBoard(gh, org, { areas: ['web', 'shared'], collaborators: [{ login: 'dev', role: 'WRITE' }] })
  const m = text(gh).find((x) => /updateProjectV2Collaborators/.test(x))
  assert.match(m, /userId: "U_dev", role: WRITER/)
})

test('pendingManualSteps: disabled auto-add and always the manual steps', () => {
  const gh = fakeGh([[q(/workflows/), { node: { workflows: { nodes: [
    { name: 'Auto-add to project', enabled: false },
    { name: 'Item closed', enabled: false },
    { name: 'Pull request linked to issue', enabled: true },
  ] } } }]])
  const steps = pendingManualSteps(gh, 'P_1', 'https://github.com/orgs/o/projects/1')
  assert.ok(steps.some((s) => s.includes('is:issue is:open') && s.endsWith('/workflows')))
  assert.ok(steps.some((s) => /Item closed/.test(s)))
  assert.ok(steps.some((s) => /In review/.test(s)))
  assert.ok(steps.some((s) => /group-by/.test(s)))
})

test('pendingManualSteps: enabled workflows only leave the always-manual steps', () => {
  const gh = fakeGh([[q(/workflows/), { node: { workflows: { nodes: [
    { name: 'Auto-add to project', enabled: true },
    { name: 'Item closed', enabled: true },
  ] } } }]])
  assert.equal(pendingManualSteps(gh, 'P_1', 'u').length, 2)
})

test('fieldIds maps names to ids and option ids', () => {
  const gh = fakeGh([[q(/fields\(first: 100\)/), { node: { fields: { nodes: [plain('F_t', 'Title'), freshStatus] } } }]])
  assert.deepEqual(fieldIds(gh, 'P_1'), {
    Title: { id: 'F_t', options: {} },
    Status: { id: 'F_status', options: { Todo: 'o1', 'In Progress': 'o2', Done: 'o3' } },
  })
})

test('labels compare case-insensitively', () => {
  const gh = fakeGh(routes({ projects: [{ id: 'P_1', number: 3, title: 'sitakro' }], state: fullState(), labels: ['Bug', 'Finding', 'area:web', 'Area:Shared'] }))
  const r = ensureBoard(gh, org, { areas: ['web', 'shared'], binding: { projectNumber: 3 } })
  assert.deepEqual(mutations(gh), [])
  assert.deepEqual(r.created, [])
})

test('collaborators are never reported as created (no readable collaborators)', () => {
  const gh = fakeGh(routes({ projects: [{ id: 'P_1', number: 3, title: 'sitakro' }], state: fullState(), labels: fullLabels() }))
  const r = ensureBoard(gh, org, { areas: ['web', 'shared'], collaborators: [{ login: 'dev', role: 'READ' }], binding: { projectNumber: 3 } })
  assert.deepEqual(r.created, [])
  assert.ok(text(gh).some((x) => /updateProjectV2Collaborators/.test(x)))
})

test('adopting an existing project by title without a binding is reported', () => {
  for (const dryRun of [false, true]) {
    const gh = fakeGh(routes({ projects: [{ id: 'P_1', number: 3, title: 'sitakro' }], state: fullState(), labels: fullLabels() }))
    const r = ensureBoard(gh, org, { areas: ['web', 'shared'], dryRun })
    assert.deepEqual(r.created, ["Using existing project #3 'sitakro'"])
  }
  const gh = fakeGh(routes({ projects: [{ id: 'P_1', number: 3, title: 'sitakro' }], state: fullState(), labels: fullLabels() }))
  assert.deepEqual(ensureBoard(gh, org, { areas: ['web', 'shared'], binding: { projectNumber: 3 } }).created, [])
})
