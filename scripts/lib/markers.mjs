const markersFor = (style) =>
  style === 'sh'
    ? { start: '# kanban:start', end: '# kanban:end' }
    : { start: '<!-- kanban:start -->', end: '<!-- kanban:end -->' }

const unbalanced = () => new Error('kanban: unbalanced markers')

// Lines with their own terminator, so untouched lines keep their endings byte for byte.
const segments = (text) =>
  (text.match(/[^\n]*\n|[^\n]+$/g) ?? []).map((raw) => {
    const eol = raw.endsWith('\r\n') ? '\r\n' : raw.endsWith('\n') ? '\n' : ''
    return { text: raw.slice(0, raw.length - eol.length), eol }
  })

function locate(segs, style) {
  const { start, end } = markersFor(style)
  const starts = []
  const ends = []
  segs.forEach((s, i) => {
    const t = s.text.trim()
    if (t === start) starts.push(i)
    else if (t === end) ends.push(i)
  })
  if (starts.length === 0 && ends.length === 0) return null
  if (starts.length !== 1 || ends.length !== 1 || ends[0] < starts[0]) throw unbalanced()
  return { s: starts[0], e: ends[0] }
}

export function readBlock(text, style) {
  const segs = segments(text)
  const at = locate(segs, style)
  return at ? segs.slice(at.s + 1, at.e).map((s) => s.text).join('\n') : null
}

export function upsertBlock(text, body, style) {
  const { start, end } = markersFor(style)
  const segs = segments(text)
  const at = locate(segs, style)
  const bodyLines = body.split(/\r?\n/)
  if (at) {
    const eol = segs[at.s].eol || '\n'
    const endEol = segs[at.e].eol
    const prefix = segs.slice(0, at.s).map((s) => s.text + s.eol).join('')
    const suffix = segs.slice(at.e + 1).map((s) => s.text + s.eol).join('')
    return prefix + [start, ...bodyLines, end].join(eol) + endEol + suffix
  }
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const block = [start, ...bodyLines, end].join(eol) + eol
  if (text === '') return block
  const sep = text.endsWith('\n') ? eol : eol + eol
  return text + sep + block
}
