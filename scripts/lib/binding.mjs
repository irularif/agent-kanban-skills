import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'

const bindingPath = (root) => join(root, '.github', 'kanban.json')

export function readBinding(root) {
  let raw
  try {
    raw = readFileSync(bindingPath(root), 'utf8')
  } catch (e) {
    if (e.code === 'ENOENT') return null
    throw e
  }
  try {
    return JSON.parse(raw)
  } catch (e) {
    throw new Error(`kanban: invalid .github/kanban.json: ${e.message}`)
  }
}

export function writeBinding(root, binding) {
  const path = bindingPath(root)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(binding, null, 2)}\n`)
}
