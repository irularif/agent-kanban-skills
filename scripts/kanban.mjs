#!/usr/bin/env node
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { GhError } from './lib/gh.mjs'

const USAGE = `Usage: kanban.mjs <command> [options]

Commands:
  init           create or bind the GitHub Project and repo files
  check          verify the binding and project setup
  add-issues     create issues from a plan and add them to the project
  start          move an issue to In progress
  pr             link a pull request to its issue
  close-parents  close parent issues whose sub-issues are done
`

const notImplemented = (name) => () => {
  console.error(`kanban: ${name} not implemented`)
  return 1
}

export const commands = {
  init: notImplemented('init'),
  check: notImplemented('check'),
  'add-issues': notImplemented('add-issues'),
  start: notImplemented('start'),
  pr: notImplemented('pr'),
  'close-parents': notImplemented('close-parents'),
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
