import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { upsertBlock } from './markers.mjs'

const reminder = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'templates', 'kanban-reminder.sh')
const HOOKS = ['post-checkout', 'pre-push']
const blockFor = (hook) => `sh "$(dirname "$0")/kanban-reminder.sh" ${hook} "$@" || true`

export function detectHookMechanism(root) {
  const r = spawnSync('git', ['config', 'core.hooksPath'], { cwd: root, encoding: 'utf8' })
  const dir = r.status === 0 ? r.stdout.trim() : ''
  if (dir) {
    if (dir.replace(/\/+$/, '') === '.husky/_') return { kind: 'husky', dir: '.husky' }
    return { kind: 'hooksPath', dir }
  }
  if (existsSync(join(root, '.husky'))) return { kind: 'husky', dir: '.husky' }
  if (['lefthook.yml', 'lefthook.yaml'].some((f) => existsSync(join(root, f)))) return { kind: 'lefthook' }
  return { kind: 'none' }
}

const snippet = () =>
  HOOKS.map((h) => `${h}: run  sh <path-to>/kanban-reminder.sh ${h} "$@" || true`).join('\n    ')

export function installHooks(root, { dryRun = false } = {}) {
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

  if (mech.kind === 'hooksPath') {
    const abs = resolve(root, mech.dir.replace(/^~(?=$|\/)/, homedir()))
    const rel = relative(resolve(root), abs)
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
      return {
        changed: [],
        manual: [
          `core.hooksPath (${mech.dir}) is outside this repo, so nothing was written there. Copy templates/kanban-reminder.sh from the init-kanban skill into that hooks directory and call it from its post-checkout and pre-push hooks:\n    sh "$(dirname "$0")/kanban-reminder.sh" <hook> "$@" || true`,
        ],
      }
    }
    mech.dir = rel
  }

  const changed = []
  const manual = []
  const touch = (rel, text, copyFrom) => {
    const path = join(root, rel)
    const before = existsSync(path) ? readFileSync(path, 'utf8') : null
    const next = copyFrom ? readFileSync(copyFrom, 'utf8') : text
    if (before !== next) {
      if (!dryRun) {
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, next)
      }
      changed.push(rel)
    }
    if (!dryRun) chmodSync(path, 0o755)
  }
  touch(`${mech.dir}/kanban-reminder.sh`, null, reminder)
  for (const hook of HOOKS) {
    const rel = `${mech.dir}/${hook}`
    const path = join(root, rel)
    const exists = existsSync(path)
    const current = exists ? readFileSync(path, 'utf8') : '#!/bin/sh\n'
    if (exists && !current.includes('# kanban:start') && /^\s*(exit|exec)\b/m.test(current)) {
      manual.push(`${rel} has an exit or exec line, so the appended kanban reminder may never run. Move the block above it by hand.`)
    }
    touch(rel, upsertBlock(current, blockFor(hook), 'sh'))
  }
  return { changed, manual }
}
