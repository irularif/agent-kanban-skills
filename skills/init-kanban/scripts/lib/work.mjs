import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { readBinding } from './binding.mjs'
import { fieldIds } from './board.mjs'
import { repoInfo } from './gh.mjs'
import { addItem, findProjectId, setItemField, sleep } from './issues.mjs'

const BRANCH_NUMBER = /^[a-z]+\/(\d+)-/

const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const gitOk = (root, ...args) => {
  try {
    return git(root, ...args)
  } catch {
    return null
  }
}

const slugify = (title, n) =>
  title
    .toLowerCase()
    .replace(/^[a-z]+(\([^)]*\))?!?:\s*/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, 40)
    .replace(/-+$/, '') || `issue-${n}`

function loadBoard(gh, root) {
  const binding = readBinding(root)
  if (!binding) throw new Error('kanban: run /init-kanban first')
  const projectId = findProjectId(gh, binding)
  return { binding, projectId, fields: fieldIds(gh, projectId) }
}

function setStatus(gh, board, itemId, option) {
  if (board.fields.Status?.options[option] === undefined) {
    throw new Error(`kanban: Status option '${option}' missing on the board; run /init-kanban`)
  }
  setItemField(gh, board.projectId, board.fields, itemId, 'Status', option)
}

const viewIssue = (gh, n) => gh.json(['issue', 'view', String(n), '--json', 'id,title,body,url,labels'])

const ITEMS_QUERY = `query($id: ID!, $cursor: String) {
  node(id: $id) {
    ... on ProjectV2 {
      items(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes { content { ... on Issue { number state subIssues(first: 50) { nodes { state } } subIssuesSummary { total completed } } } }
      }
    }
  }
}`

export function closeParents(gh, projectId) {
  const closed = []
  let cursor = null
  do {
    const items = gh.graphql(ITEMS_QUERY, cursor ? { id: projectId, cursor } : { id: projectId }).node?.items
    for (const { content: c } of items?.nodes ?? []) {
      const total = c?.subIssuesSummary?.total ?? 0
      const subs = c?.subIssues?.nodes ?? []
      if (c?.state !== 'OPEN' || total === 0 || subs.length !== total) continue
      if (!subs.every((s) => s.state === 'CLOSED')) continue
      gh.run(['issue', 'close', String(c.number), '--comment', 'All sub-issues are done.'])
      closed.push(c.number)
    }
    cursor = items?.pageInfo?.hasNextPage ? items.pageInfo.endCursor : null
  } while (cursor)
  return closed
}

export function startIssue(gh, root, n, { prefix, retryDelayMs = 3000 } = {}) {
  const board = loadBoard(gh, root)
  const issue = viewIssue(gh, n)

  // Switch first: a failed switch (e.g. a dirty tree) must leave the board untouched.
  const pfx = prefix ?? (issue.labels.some((l) => l.name === 'bug') ? 'fix' : 'feat')
  const existing = git(root, 'branch', '--format=%(refname:short)')
    .split('\n')
    .find((b) => BRANCH_NUMBER.exec(b)?.[1] === String(n))
  const branch = existing ?? `${pfx}/${n}-${slugify(issue.title, n)}`
  try {
    if (existing) {
      git(root, 'switch', branch)
    } else {
      const def = repoInfo(gh).defaultBranch
      const base = gitOk(root, 'fetch', 'origin', def) !== null ? `origin/${def}` : def
      git(root, 'switch', '-c', branch, '--no-track', base)
    }
  } catch (e) {
    throw new Error(`kanban: cannot switch to branch '${branch}': ${String(e.stderr || e.message).trim()}`)
  }

  const closedParents = closeParents(gh, board.projectId)
  setStatus(gh, board, addItem(gh, board.projectId, issue.id, retryDelayMs), 'In progress')
  return { branch, closedParents, issue: { title: issue.title, body: issue.body, url: issue.url } }
}

export function openPr(gh, root, n, { title, draft = false, bodyFile, recheckMs = 10000, retryDelayMs = 3000 } = {}) {
  const current = git(root, 'branch', '--show-current')
  const m = BRANCH_NUMBER.exec(current)
  if (!m) throw new Error(`kanban: branch '${current}' has no issue number; use <prefix>/<n>-<slug>`)
  if (Number(m[1]) !== Number(n)) {
    throw new Error(`kanban: branch '${current}' belongs to issue #${m[1]}, not #${n}`)
  }
  const board = loadBoard(gh, root)
  const issue = viewIssue(gh, n)
  git(root, 'push', '-u', 'origin', 'HEAD')
  let url = null
  try {
    const existingPr = gh.json(['pr', 'view', '--json', 'url,state'])
    if (existingPr.state === 'OPEN') url = existingPr.url ?? null
  } catch {}
  if (!url) {
    const closes = `Closes #${n}`
    let body = closes
    if (bodyFile) {
      const text = readFileSync(bodyFile, 'utf8').trimEnd()
      body = new RegExp(`^\\s*closes #${n}\\b`, 'im').test(text) ? text : `${text}\n\n${closes}`
    }
    const args = ['pr', 'create', '--title', title ?? issue.title, '--body', body]
    if (draft) args.push('--draft')
    url = gh.run(args).trim().split('\n').pop()
  }

  const itemId = addItem(gh, board.projectId, issue.id, retryDelayMs)
  setStatus(gh, board, itemId, 'In review')
  // The board's "Pull request linked" workflow may move the item to In progress shortly after.
  sleep(recheckMs)
  const now = gh.graphql(
    `query($id: ID!) { node(id: $id) { ... on ProjectV2Item { fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { name } } } } }`,
    { id: itemId },
  ).node?.fieldValueByName?.name
  if (now !== 'In review') setStatus(gh, board, itemId, 'In review')
  return { url }
}
