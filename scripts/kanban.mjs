#!/usr/bin/env node
import { readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { GhError, createGh, repoInfo, repoRoot } from './lib/gh.mjs'
import { bindingChanged, readBinding, writeBinding } from './lib/binding.mjs'
import { ensureBoard } from './lib/board.mjs'
import { writeRepoFiles } from './lib/repo-files.mjs'
import { installHooks } from './lib/hooks.mjs'
import { addIssues } from './lib/issues.mjs'
import { closeParents, openPr, startIssue } from './lib/work.mjs'

const USAGE = `Usage: kanban.mjs <command> [options]

Commands:
  init           create or bind the GitHub Project and repo files
  check          verify the binding and project setup
  add-issues     create issues from a plan and add them to the project
  start          move an issue to In progress and switch to its branch
  pr             push, open a pull request for the issue, set In review
  close-parents  close parent issues whose sub-issues are done
`

function init(args) {
  const { values } = parseArgs({
    args,
    options: {
      area: { type: 'string' },
      collaborator: { type: 'string', multiple: true },
      'dry-run': { type: 'boolean' },
      language: { type: 'string', default: 'en' },
    },
  })
  if (!['en', 'id'].includes(values.language)) {
    throw new Error(`kanban: invalid --language '${values.language}' (expected en or id)`)
  }
  const areas = [...new Set([...(values.area ?? '').split(',').map((a) => a.trim()).filter(Boolean), 'shared'])]
  const collaborators = (values.collaborator ?? []).map((c) => {
    const [login, role] = c.split(':')
    if (!login || !['READ', 'WRITE'].includes(role)) {
      throw new Error(`kanban: invalid --collaborator '${c}' (expected user:READ or user:WRITE)`)
    }
    return { login, role }
  })
  const dryRun = values['dry-run'] ?? false
  const root = repoRoot()
  const gh = createGh({ cwd: root })
  const r = ensureBoard(gh, repoInfo(gh), { areas, collaborators, dryRun, binding: readBinding(root) })
  const changedBinding = dryRun ? bindingChanged(root, r.binding) : writeBinding(root, r.binding)
  const files = writeRepoFiles(root, r.binding, { areas, language: values.language, dryRun })
  if (changedBinding) files.changed.unshift('.github/kanban.json')
  const hooks = installHooks(root, { dryRun })
  files.changed.push(...hooks.changed)
  r.manual.push(...hooks.manual)
  console.log(`${dryRun ? 'Would create' : 'Created'}: ${r.created.length ? r.created.join(', ') : 'nothing (board up to date)'}`)
  if (r.binding.url) console.log(`Board: ${r.binding.url}`)
  if (files.changed.length) console.log(`${dryRun ? 'Would write' : 'Files written'}:\n${files.changed.map((f) => `  - ${f}`).join('\n')}`)
  for (const w of files.warnings) console.log(`Warning: ${w}`)
  if (r.manual.length) console.log(`Manual steps:\n${r.manual.map((m) => `  - ${m}`).join('\n')}`)
  if (!dryRun) console.log('Review and commit the files above.')
  return 0
}

function check(args) {
  parseArgs({ args, options: {} })
  const root = repoRoot()
  const binding = readBinding(root)
  if (!binding) {
    console.error('kanban: run /init-kanban first')
    return 1
  }
  const gh = createGh({ cwd: root })
  const r = ensureBoard(gh, repoInfo(gh), { dryRun: true, binding })
  if (r.created.length) console.log(`Missing: ${r.created.join(', ')}`)
  if (r.manual.length) console.log(`Manual steps:\n${r.manual.map((m) => `  - ${m}`).join('\n')}`)
  return r.created.length ? 1 : 0
}

function addIssuesCommand(args) {
  const { values, positionals } = parseArgs({
    args,
    options: { 'dry-run': { type: 'boolean' } },
    allowPositionals: true,
  })
  if (positionals.length !== 1) throw new Error('kanban: usage: add-issues <units.json> [--dry-run]')
  const root = repoRoot()
  if (!readBinding(root)) {
    console.error('kanban: run /init-kanban first')
    return 1
  }
  let plan
  try {
    plan = JSON.parse(readFileSync(positionals[0], 'utf8'))
  } catch (e) {
    throw new Error(`kanban: cannot read ${positionals[0]}: ${e.message}`)
  }
  const dryRun = values['dry-run'] ?? false
  const r = addIssues(createGh({ cwd: root }), root, plan, { dryRun })
  if (dryRun) {
    console.log(`Would create: ${r.planned.length ? r.planned.join(', ') : 'nothing (all issues exist)'}`)
  } else {
    console.log(`Created: ${r.created.length ? r.created.map((n) => `#${n}`).join(', ') : 'nothing'}`)
    console.log(`Parent: #${r.parent}`)
    console.log(`Update recorded in ${plan.source}; commit it.`)
  }
  if (r.existing.length) console.log(`Already existed: ${r.existing.map((n) => `#${n}`).join(', ')}`)
  return 0
}

function issueNumber(positionals, usage) {
  if (positionals.length !== 1 || !/^\d+$/.test(positionals[0])) throw new Error(`kanban: usage: ${usage}`)
  return Number(positionals[0])
}

function requireBinding() {
  const root = repoRoot()
  if (!readBinding(root)) throw new Error('kanban: run /init-kanban first')
  return root
}

function start(args) {
  const { values, positionals } = parseArgs({
    args,
    options: { prefix: { type: 'string' } },
    allowPositionals: true,
  })
  const n = issueNumber(positionals, 'start <n> [--prefix feat|fix|...]')
  const root = requireBinding()
  const r = startIssue(createGh({ cwd: root }), root, n, { prefix: values.prefix })
  for (const p of r.closedParents) console.log(`Closed parent #${p} (all sub-issues done)`)
  console.log(`Branch: ${r.branch}`)
  console.log(`Issue #${n}: ${r.issue.title}`)
  console.log(`URL: ${r.issue.url}`)
  console.log(`\n${r.issue.body ?? ''}`)
  return 0
}

function pr(args) {
  const { values, positionals } = parseArgs({
    args,
    options: { title: { type: 'string' }, draft: { type: 'boolean' }, 'body-file': { type: 'string' } },
    allowPositionals: true,
  })
  const n = issueNumber(positionals, 'pr <n> [--title <title>] [--draft] [--body-file <path>]')
  const root = requireBinding()
  const r = openPr(createGh({ cwd: root }), root, n, { title: values.title, draft: values.draft, bodyFile: values['body-file'] })
  console.log(`PR: ${r.url}`)
  return 0
}

function closeParentsCommand(args) {
  parseArgs({ args, options: {} })
  const root = requireBinding()
  const closed = closeParents(createGh({ cwd: root }), readBinding(root))
  console.log(closed.length ? `Closed: ${closed.map((n) => `#${n}`).join(', ')}` : 'Closed: nothing')
  return 0
}

export const commands = {
  init,
  check,
  'add-issues': addIssuesCommand,
  start,
  pr,
  'close-parents': closeParentsCommand,
}

export async function main(argv = process.argv.slice(2), { commands: table = commands } = {}) {
  const [cmd, ...rest] = argv
  if (!cmd || !Object.hasOwn(table, cmd)) {
    console.error(cmd ? `kanban: unknown command '${cmd}'\n${USAGE}` : USAGE)
    return 1
  }
  try {
    return (await table[cmd](rest)) ?? 0
  } catch (e) {
    console.error(e.message.startsWith('kanban:') ? e.message : `kanban: ${e.message}`)
    return e instanceof GhError ? 2 : 1
  }
}

const isEntry = () => {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (process.argv[1] && isEntry()) {
  process.exitCode = await main()
}
