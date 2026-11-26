import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { upsertBlock } from './markers.mjs'

const templates = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'templates')
const tpl = (name) => readFileSync(join(templates, name), 'utf8')
const MANAGED = '# kanban:managed'
const FORMS = ['bug.yml', 'finding.yml']

const read = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : null)

function write(root, rel, text, changed, dryRun) {
  const path = join(root, rel)
  if (read(path) === text) return
  if (dryRun) return void changed.push(rel)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
  changed.push(rel)
}

function section(text, language) {
  const parts = text.split(/^## (en|id)\n/m)
  const i = parts.indexOf(language)
  if (i < 0) throw new Error(`kanban: no '${language}' section in contributing template`)
  return parts[i + 1].trim()
}

export function writeRepoFiles(root, binding, { areas = [], language = 'en', dryRun = false } = {}) {
  const changed = []
  const warnings = []
  if (!dryRun && !binding.url) throw new Error('kanban: binding has no url; run /init-kanban to bind the board')
  const project = `${binding.owner}/${binding.projectNumber}`

  for (const name of FORMS) {
    const rel = `.github/ISSUE_TEMPLATE/${name}`
    const existing = read(join(root, rel))
    if (existing !== null && !/^# kanban:managed\r?\n/.test(existing)) {
      warnings.push(`${rel} exists without '${MANAGED}'; left unchanged. Add the label and project to it by hand.`)
      continue
    }
    write(root, rel, tpl(name).replaceAll('{{project}}', project), changed, dryRun)
  }

  const fill = (s) => s.replaceAll('{{url}}', binding.url ?? '').replaceAll('{{areas}}', areas.join(', '))
  const upsertInto = (rel, body) => {
    const current = read(join(root, rel)) ?? ''
    write(root, rel, upsertBlock(current, body, 'md'), changed, dryRun)
  }
  upsertInto('CONTRIBUTING.md', fill(section(tpl('contributing.md'), language)))
  const agentFile = ['AGENTS.md', 'CLAUDE.md'].find((f) => existsSync(join(root, f))) ?? 'AGENTS.md'
  upsertInto(agentFile, tpl('agents.md').trim())

  return { changed, warnings }
}
