const markersFor = (style) =>
  style === 'sh'
    ? { start: '# kanban:start', end: '# kanban:end' }
    : { start: '<!-- kanban:start -->', end: '<!-- kanban:end -->' }

const unbalanced = () => new Error('kanban: unbalanced markers')

function locate(lines, style) {
  const { start, end } = markersFor(style)
  const starts = []
  const ends = []
  lines.forEach((line, i) => {
    const t = line.trim()
    if (t === start) starts.push(i)
    else if (t === end) ends.push(i)
  })
  if (starts.length === 0 && ends.length === 0) return null
  if (starts.length !== 1 || ends.length !== 1 || ends[0] < starts[0]) throw unbalanced()
  return { s: starts[0], e: ends[0] }
}

export function readBlock(text, style) {
  const lines = text.split(/\r?\n/)
  const at = locate(lines, style)
  return at ? lines.slice(at.s + 1, at.e).join('\n') : null
}

export function upsertBlock(text, body, style) {
  const { start, end } = markersFor(style)
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(/\r?\n/)
  const at = locate(lines, style)
  const bodyLines = body.split(/\r?\n/)
  if (at) {
    return [...lines.slice(0, at.s), start, ...bodyLines, end, ...lines.slice(at.e + 1)].join(eol)
  }
  const block = [start, ...bodyLines, end].join(eol) + eol
  if (text === '') return block
  const sep = text.endsWith('\n') ? eol : eol + eol
  return text + sep + block
}
