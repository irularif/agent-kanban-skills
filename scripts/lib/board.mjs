import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const defaultsPath = fileURLToPath(new URL('../../defaults.json', import.meta.url))

export function loadDefaults() {
  const d = JSON.parse(readFileSync(defaultsPath, 'utf8'))
  return { ...d, labels: d.labels.map((l) => ({ ...l })) }
}

// GitHub's default Status options, renamed in place so existing ids survive.
const RENAMES = { Todo: 'Triage', 'In Progress': 'In progress' }
const STATUS_COLORS = {
  Triage: 'GRAY',
  Backlog: 'BLUE',
  Ready: 'GREEN',
  'In progress': 'YELLOW',
  'In review': 'ORANGE',
  Done: 'PURPLE',
}
const ROLES = { READ: 'READER', WRITE: 'WRITER' }

const str = JSON.stringify
const enumName = (c) => (/^[A-Z_]+$/.test(c ?? '') ? c : 'GRAY')

function optionsLiteral(options) {
  const items = options.map(
    (o) =>
      `{${o.id ? `id:${str(o.id)},` : ''}name:${str(o.name)},color:${enumName(o.color)},description:${str(o.description ?? '')}}`,
  )
  return `[${items.join(',')}]`
}

// Desired names first (in order), existing extras kept after; null when nothing changes.
function mergeOptions(existing, desired, colorFor) {
  const used = new Set()
  const merged = desired.map((name) => {
    let found = existing.find((o) => o.name === name)
    found ??= existing.find((o) => RENAMES[o.name] === name && !desired.includes(o.name))
    if (found) {
      used.add(found.id)
      return { id: found.id, name, color: found.color, description: found.description }
    }
    return { name, color: colorFor(name), description: '' }
  })
  const extras = existing.filter((o) => !used.has(o.id))
  const result = [...merged, ...extras.map((o) => ({ id: o.id, name: o.name, color: o.color, description: o.description }))]
  const same =
    result.length === existing.length && result.every((o, i) => o.id === existing[i].id && o.name === existing[i].name)
  return same ? null : result
}

const PROJECT_LIST = `query($login: String!) {
  repositoryOwner(login: $login) {
    ... on ProjectV2Owner { projectsV2(first: 100) { nodes { id number title } } }
  }
}`

const PROJECT_STATE = `query($id: ID!) {
  node(id: $id) {
    ... on ProjectV2 {
      repositories(first: 100) { nodes { id } }
      fields(first: 100) {
        nodes {
          __typename
          ... on ProjectV2Field { id name }
          ... on ProjectV2IterationField { id name }
          ... on ProjectV2SingleSelectField { id name options { id name color description } }
        }
      }
      views(first: 100) { nodes { id name layout } }
    }
  }
}`

const WORKFLOWS = `query($id: ID!) {
  node(id: $id) { ... on ProjectV2 { workflows(first: 20) { nodes { name enabled } } } }
}`

const FIELD_SELECT = '... on ProjectV2SingleSelectField { id name options { id name } }'

export const projectUrl = (repo, number) =>
  `https://github.com/${repo.ownerType === 'User' ? 'users' : 'orgs'}/${repo.owner}/projects/${number}`

export function ensureBoard(gh, repo, { areas = [], collaborators = [], dryRun = false, binding = null } = {}) {
  const defaults = loadDefaults()
  const created = []

  // 1. project
  const projects = gh.graphql(PROJECT_LIST, { login: repo.owner }).repositoryOwner?.projectsV2?.nodes ?? []
  let project = binding?.projectNumber != null ? projects.find((p) => p.number === binding.projectNumber) : null
  if (!project) {
    project = projects.find((p) => p.title === repo.name)
    if (project) created.push(`Using existing project #${project.number} '${project.title}'`)
  }
  if (!project) {
    created.push('project')
    if (!dryRun) {
      project = gh.graphql(
        `mutation($ownerId: ID!, $title: String!) {
          createProjectV2(input: {ownerId: $ownerId, title: $title}) { projectV2 { id number } }
        }`,
        { ownerId: repo.ownerId, title: repo.name },
      ).createProjectV2.projectV2
    }
  }
  const projectId = project?.id ?? null

  let state = { repositories: [], fields: [], views: [] }
  if (projectId) {
    const node = gh.graphql(PROJECT_STATE, { id: projectId }).node
    state = {
      repositories: node.repositories?.nodes ?? [],
      fields: node.fields?.nodes ?? [],
      views: node.views?.nodes ?? [],
    }
  }
  const fields = new Map(state.fields.map((f) => [f.name, f]))
  const mutate = (query) => gh.graphql(query)

  // 2. link repo
  if (!state.repositories.some((r) => r.id === repo.repoId)) {
    created.push('repo link')
    if (!dryRun) {
      mutate(`mutation { linkProjectV2ToRepository(input: {projectId: ${str(projectId)}, repositoryId: ${str(repo.repoId)}}) { repository { id } } }`)
    }
  }

  // 3. single-select fields
  const syncSelect = (name, desired, colorFor) => {
    const field = fields.get(name)
    if (!field) {
      if (!desired.length) {
        if (dryRun) return void created.push(`field ${name}`)
        throw new Error(`kanban: no options given for field ${name}`)
      }
      created.push(`field ${name}`)
      if (dryRun) return
      const opts = desired.map((n) => ({ name: n, color: colorFor(n), description: '' }))
      const f = gh.graphql(
        `mutation { createProjectV2Field(input: {projectId: ${str(projectId)}, dataType: SINGLE_SELECT, name: ${str(name)}, singleSelectOptions: ${optionsLiteral(opts)}}) { projectV2Field { ${FIELD_SELECT} } } }`,
      ).createProjectV2Field.projectV2Field
      fields.set(name, f)
      return
    }
    const merged = mergeOptions(field.options ?? [], desired, colorFor)
    if (!merged) return
    created.push(`options ${name}`)
    if (dryRun) return
    mutate(
      `mutation { updateProjectV2Field(input: {fieldId: ${str(field.id)}, singleSelectOptions: ${optionsLiteral(merged)}}) { projectV2Field { ${FIELD_SELECT} } } }`,
    )
  }
  const statusField = fields.get('Status')
  if (!statusField && !dryRun) throw new Error('kanban: project has no Status field')
  if (statusField) syncSelect('Status', defaults.status, (n) => STATUS_COLORS[n] ?? 'GRAY')
  syncSelect('Area', areas, () => 'GRAY')
  syncSelect('Size', defaults.size, () => 'GRAY')

  // 4. views
  const haveViews = new Set(state.views.map((v) => v.name))
  for (const view of defaults.views) {
    if (haveViews.has(view.name)) continue
    created.push(`view ${view.name}`)
    if (dryRun) continue
    // Roadmap views reject visibleFieldIds, so only send a configuration when fields are listed.
    const ids = (view.fields ?? []).map((n) => fields.get(n)?.id).filter(Boolean)
    const config = view.fields ? `, configuration: {visibleFieldIds: ${str(ids)}}` : ''
    mutate(
      `mutation { createProjectV2View(input: {projectId: ${str(projectId)}, name: ${str(view.name)}, layout: ${view.layout}${config}}) { projectV2View { id } } }`,
    )
  }

  // 5. labels
  const have = new Set(gh.json(['label', 'list', '--limit', '1000', '--json', 'name']).map((l) => l.name.toLowerCase()))
  const wanted = [
    ...defaults.labels,
    ...areas.map((a) => ({ name: `area:${a}`, ...defaults.areaLabel })),
  ]
  for (const l of wanted) {
    if (have.has(l.name.toLowerCase())) continue
    created.push(`label ${l.name}`)
    if (!dryRun) gh.run(['label', 'create', l.name, '--color', l.color, '--description', l.description])
  }

  // 6. collaborators. ProjectV2 exposes no readable collaborators, so the role is applied every run
  // and never reported as created. Callers must not pass a lower role than the user already has.
  if (collaborators.length) {
    if (!dryRun) {
      const entries = collaborators.map((c) => {
        const role = ROLES[c.role]
        if (!role) throw new Error(`kanban: invalid collaborator role '${c.role}' (use READ or WRITE)`)
        const id = gh.graphql('query($l: String!) { user(login: $l) { id } }', { l: c.login }).user?.id
        if (!id) throw new Error(`kanban: GitHub user '${c.login}' not found`)
        return `{userId: ${str(id)}, role: ${role}}`
      })
      mutate(
        `mutation { updateProjectV2Collaborators(input: {projectId: ${str(projectId)}, collaborators: [${entries.join(',')}]}) { clientMutationId } }`,
      )
    }
  }

  const url = project?.number != null ? projectUrl(repo, project.number) : null
  const out = {
    binding: { owner: repo.owner, projectNumber: project?.number ?? null, url },
    projectId,
    created,
  }
  out.manual = projectId ? pendingManualSteps(gh, projectId, url) : staticSteps(url)
  return out
}

function staticSteps(url) {
  const at = url ?? '<project url>'
  return [
    `Set "Pull request linked to issue" workflow target status to In review: ${at}/workflows`,
    `Set group-by on views: Board by Status, By epic by Parent issue: ${at}`,
  ]
}

export function pendingManualSteps(gh, projectId, url) {
  const nodes = gh.graphql(WORKFLOWS, { id: projectId }).node?.workflows?.nodes ?? []
  const byName = new Map(nodes.map((w) => [w.name, w]))
  const steps = []
  if (!byName.get('Auto-add to project')?.enabled) {
    steps.push(`Enable Auto-add workflow with filter is:issue is:open: ${url}/workflows`)
  }
  const closed = byName.get('Item closed')
  if (closed && !closed.enabled) steps.push(`Enable Item closed workflow (set status Done): ${url}/workflows`)
  return [...steps, ...staticSteps(url)]
}

export function fieldIds(gh, projectId) {
  const nodes = gh.graphql(PROJECT_STATE, { id: projectId }).node?.fields?.nodes ?? []
  return Object.fromEntries(
    nodes.map((f) => [f.name, { id: f.id, options: Object.fromEntries((f.options ?? []).map((o) => [o.name, o.id])) }]),
  )
}
