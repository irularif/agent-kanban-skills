import { spawnSync, execFileSync } from 'node:child_process'

export class GhError extends Error {
  constructor(message, errors) {
    super(message)
    this.name = 'GhError'
    this.errors = errors
  }
}

export function createGh({ exec = spawnSync, cwd } = {}) {
  function run(args) {
    const r = exec('gh', args, { encoding: 'utf8', cwd, maxBuffer: 64 * 1024 * 1024 })
    if (r.error) throw new GhError(`kanban: failed to run gh: ${r.error.message}`)
    if (r.status !== 0) {
      throw new GhError(`kanban: gh ${args[0] ?? ''} failed: ${(r.stderr || r.stdout || '').trim()}`)
    }
    return r.stdout
  }

  function json(args) {
    const out = run(args)
    try {
      return JSON.parse(out)
    } catch (e) {
      throw new GhError(`kanban: gh returned invalid JSON: ${e.message}`)
    }
  }

  function graphql(query, vars = {}) {
    const args = ['api', 'graphql', '-f', `query=${query}`]
    for (const [k, v] of Object.entries(vars)) {
      if (typeof v === 'string') args.push('-f', `${k}=${v}`)
      else if (typeof v === 'number' || typeof v === 'boolean') args.push('-F', `${k}=${v}`)
      else throw new GhError(`kanban: graphql var ${k} must be scalar`)
    }
    const res = json(args)
    if (res.errors?.length) {
      throw new GhError(`kanban: GraphQL error: ${res.errors.map((e) => e.message).join('; ')}`, res.errors)
    }
    return res.data
  }

  return { graphql, json, run }
}

export function repoRoot() {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
  } catch {
    throw new Error('kanban: not inside a git repository')
  }
}

export function repoInfo(gh) {
  const repo = gh.json(['repo', 'view', '--json', 'owner,name,id,defaultBranchRef'])
  const owner = gh.graphql(
    'query($login: String!) { repositoryOwner(login: $login) { id __typename } }',
    { login: repo.owner.login },
  ).repositoryOwner
  return {
    owner: repo.owner.login,
    name: repo.name,
    ownerId: owner.id,
    ownerType: owner.__typename,
    repoId: repo.id,
    defaultBranch: repo.defaultBranchRef?.name ?? 'main',
  }
}
