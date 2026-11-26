#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
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

export async function main(argv = process.argv.slice(2)) {
  let parsed
  try {
    parsed = parseArgs({ args: argv, allowPositionals: true, strict: false })
  } catch (e) {
    console.error(`kanban: ${e.message}\n${USAGE}`)
    return 1
  }
  const [cmd, ...rest] = parsed.positionals
  if (!cmd || !Object.hasOwn(commands, cmd)) {
    console.error(cmd ? `kanban: unknown command '${cmd}'\n${USAGE}` : USAGE)
    return 1
  }
  try {
    return (await commands[cmd](rest, parsed.values)) ?? 0
  } catch (e) {
    console.error(e.message.startsWith('kanban:') ? e.message : `kanban: ${e.message}`)
    return e instanceof GhError ? 2 : 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main()
}
