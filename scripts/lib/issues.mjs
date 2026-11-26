import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { readBinding } from './binding.mjs'
import { fieldIds } from './board.mjs'
import { readBlock, upsertBlock } from './markers.mjs'

const MAP_PREFIX = 'kanban-issues:'
const PENDING_PREFIX = 'kanban-pending:'
const STATUSES = ['Ready', 'Backlog']
const SIZES = ['S', 'M', 'L']
const str = JSON.stringify

export function sleep(ms) {
  if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function readState(text) {
  const lines = (readBlock(text, 'md') ?? '').split('\n')
  const parse = (prefix, fallback) => {
    const line = lines.find((l) => l.startsWith(prefix))
    if (!line) return fallback
    try {
      return JSON.parse(line.slice(prefix.length))
    } catch (e) {
      throw new Error(`kanban: invalid ${prefix.slice(0, -1)} line: ${e.message}`)
    }
  }
  return { map: parse(MAP_PREFIX, {}), pending: parse(PENDING_PREFIX, []) }
}

const blockBody = (map, pending) =>
  [`${MAP_PREFIX} ${str(map)}`, ...(pending.length ? [`${PENDING_PREFIX} ${str(pending)}`] : [])].join('\n')

export function findProjectId(gh, binding) {
  const nodes =
    gh.graphql(
      `query($login: String!) {
        repositoryOwner(login: $login) {
          ... on ProjectV2Owner { projectsV2(first: 100) { nodes { id number } } }
        }
      }`,
      { login: binding.owner },
    ).repositoryOwner?.projectsV2?.nodes ?? []
  const project = nodes.find((p) => p.number === binding.projectNumber)
  if (!project) throw new Error(`kanban: project #${binding.projectNumber} not found; run /init-kanban`)
  return project.id
}

export function addItem(gh, projectId, contentId, retryDelayMs = 3000) {
  for (let attempt = 1; ; attempt++) {
    try {
      return gh.graphql(
        `mutation { addProjectV2ItemById(input: {projectId: ${str(projectId)}, contentId: ${str(contentId)}}) { item { id } } }`,
      ).addProjectV2ItemById.item.id
    } catch (e) {
      if (attempt >= 3 || !/conflict/i.test(e.message)) throw e
      sleep(retryDelayMs)
    }
  }
}

export function setItemField(gh, projectId, fields, itemId, name, option) {
  const f = fields[name]
  gh.graphql(
    `mutation { updateProjectV2ItemFieldValue(input: {projectId: ${str(projectId)}, itemId: ${str(itemId)}, fieldId: ${str(f.id)}, value: {singleSelectOptionId: ${str(f.options[option])}}}) { projectV2Item { id } } }`,
  )
}

function validate(plan, items, fields) {
  if (!plan.parent?.key) throw new Error('kanban: units file has no parent')
  const seen = new Set()
  for (const it of items) {
    if (seen.has(it.key)) throw new Error(`kanban: duplicate key '${it.key}'`)
    seen.add(it.key)
  }
  for (const it of items) {
    const where = `'${it.key}'`
    if (it.area !== undefined && fields.Area?.options[it.area] === undefined) {
      throw new Error(`kanban: unknown area '${it.area}' for ${where}`)
    }
    if (it.size !== undefined && !SIZES.includes(it.size)) {
      throw new Error(`kanban: invalid size '${it.size}' for ${where} (use S, M or L)`)
    }
    if (it.status !== undefined && !STATUSES.includes(it.status)) {
      throw new Error(`kanban: invalid status '${it.status}' for ${where} (use Ready or Backlog)`)
    }
  }
}

export function addIssues(gh, root, plan, { dryRun = false, retryDelayMs = 3000 } = {}) {
  const binding = readBinding(root)
  if (!binding) throw new Error('kanban: run /init-kanban first')
  const sourcePath = join(root, plan.source)
  let text = readFileSync(sourcePath, 'utf8')
  const { map, pending: savedPending } = readState(text)
  const pending = new Set(savedPending)

  const parent = plan.parent
  const items = [parent, ...(plan.units ?? []).map((x) => ({ status: 'Ready', ...x }))]
  const projectId = findProjectId(gh, binding)
  const fields = fieldIds(gh, projectId)
  validate(plan, items, fields)

  const parentIsNew = map[parent.key] === undefined
  const created = items.filter((i) => map[i.key] === undefined)
  // Mapped units must be (re)linked when they never finished wiring or the parent is brand new.
  const rewire = items.filter(
    (i) => map[i.key] !== undefined && (pending.has(i.key) || (parentIsNew && i !== parent)),
  )
  const existing = items.filter((i) => map[i.key] !== undefined).map((i) => map[i.key])
  const result = { created: [], existing, parent: map[parent.key] ?? null }
  if (dryRun) return { ...result, planned: created.map((i) => i.key), rewire: rewire.map((i) => i.key) }

  const nodeId = (n) => gh.json(['issue', 'view', String(n), '--json', 'id']).id

  const addToProject = (contentId) => addItem(gh, projectId, contentId, retryDelayMs)

  const setField = (itemId, name, option) => setItemField(gh, projectId, fields, itemId, name, option)

  const save = () => {
    text = upsertBlock(text, blockBody(map, [...pending]), 'md')
    writeFileSync(sourcePath, text)
  }

  const wire = (it) => {
    const id = nodeId(map[it.key])
    const itemId = addToProject(id)
    if (it.status) setField(itemId, 'Status', it.status)
    if (it.area) setField(itemId, 'Area', it.area)
    if (it.size) setField(itemId, 'Size', it.size)
    if (it !== parent) {
      gh.graphql(
        `mutation { addSubIssue(input: {issueId: ${str(nodeId(result.parent))}, subIssueId: ${str(id)}}) { issue { id } } }`,
      )
    }
    pending.delete(it.key)
    save()
  }

  for (const it of items) {
    if (map[it.key] === undefined) {
      const args = ['issue', 'create', '--title', it.title, '--body', `${it.body}\n\nSource: ${plan.source}`]
      if (it.area) args.push('--label', `area:${it.area}`)
      const url = gh.run(args).trim().split('\n').pop()
      const number = Number(url.match(/\/issues\/(\d+)$/)?.[1])
      if (!number) throw new Error(`kanban: could not read issue number from '${url}'`)
      map[it.key] = number
      result.created.push(number)
      if (it === parent) result.parent = number
      pending.add(it.key)
      save()
      wire(it)
    } else if (rewire.includes(it)) {
      wire(it)
    }
  }
  return result
}
