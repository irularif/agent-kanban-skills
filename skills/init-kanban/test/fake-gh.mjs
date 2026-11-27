export function fakeGh(routes) {
  const calls = []
  const respond = (args) => {
    calls.push(args)
    const joined = args.join(' ')
    for (const [m, res] of routes) {
      if (typeof m === 'function' ? m(args) : m.test(joined)) {
        return typeof res === 'function' ? res(args) : res
      }
    }
    throw new Error(`fakeGh: no route for: ${joined}`)
  }
  return {
    calls,
    json: (args) => respond(args),
    run: (args) => respond(args),
    graphql: (query, vars) => respond(['api', 'graphql', query, ...(vars ? [JSON.stringify(vars)] : [])]),
  }
}
