import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { upsertBlock } from './markers.mjs'

const reminder = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'templates', 'kanban-reminder.sh')
const HOOKS = ['post-checkout', 'pre-push']
const blockFor = (hook) => `sh "$(dirname "$0")/kanban-reminder.sh" ${hook} "$@" || true`

export function detectHookMechanism(root) {
  const r = spawnSync('git', ['config', 'core.hooksPath'], { cwd: root, encoding: 'utf8' })
  const dir = r.status === 0 ? r.stdout.trim() : ''
  if (dir) return { kind: 'hooksPath', dir }
  if (existsSync(join(root, '.husky'))) return { kind: 'husky', dir: '.husky' }
  if (['lefthook.yml', 'lefthook.yaml'].some((f) => existsSync(join(root, f)))) return { kind: 'lefthook' }
  return { kind: 'none' }
}

const snippet = () =>
  HOOKS.map((h) => `${h}: run  sh <path-to>/kanban-reminder.sh ${h} "$@" || true`).join('\n    ')

export function installHooks(root) {
  const mech = detectHookMechanism(root)
  if (mech.kind === 'lefthook') {
    return {
      changed: [],
      manual: [
        `lefthook detected: add commands for post-checkout and pre-push that run templates/kanban-reminder.sh from the init-kanban skill (copy it into the repo), e.g.\n    ${snippet()}`,
      ],
    }
  }
  if (mech.kind === 'none') {
    return {
      changed: [],
      manual: [
        'No git hook manager detected: copy templates/kanban-reminder.sh from the init-kanban skill into your hooks directory and call it from post-checkout and pre-push (warn-only), e.g. in each hook:\n    sh "$(dirname "$0")/kanban-reminder.sh" <hook> "$@" || true',
      ],
    }
  }

  const changed = []
  const touch = (rel, text, copyFrom) => {
    const path = join(root, rel)
    const before = existsSync(path) ? readFileSync(path, 'utf8') : null
    const next = copyFrom ? readFileSync(copyFrom, 'utf8') : text
    if (before !== next) {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, next)
      changed.push(rel)
    }
    chmodSync(path, 0o755)
  }
  touch(`${mech.dir}/kanban-reminder.sh`, null, reminder)
  for (const hook of HOOKS) {
    const rel = `${mech.dir}/${hook}`
    const path = join(root, rel)
    const current = existsSync(path) ? readFileSync(path, 'utf8') : '#!/bin/sh\n'
    touch(rel, upsertBlock(current, blockFor(hook), 'sh'))
  }
  return { changed, manual: [] }
}
