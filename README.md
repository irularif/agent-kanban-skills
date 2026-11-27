# kanban-skills

Three agent skills that turn a GitHub repository's issues into a kanban board (GitHub Projects v2) and keep it in sync while you work. They are plain `SKILL.md` folders plus one dependency-free Node CLI, so any coding agent that reads skills can use them (Claude Code, Codex, Gemini CLI, and so on).

| Skill | What it does |
|---|---|
| `init-kanban` | Creates the project board for a repo: Status/Area/Size fields, Board, By epic and Roadmap views, labels, issue forms, a contribution guide section, an agent-file line, and warn-only git hooks. Safe to re-run. |
| `plan-to-issues` | Turns a markdown spec or plan into one parent (epic) issue plus PR-sized sub-issues on the board. Asks for approval of the grouping before creating anything. |
| `start-issue` | `/start-issue <n>` moves the card to In progress and switches to a branch; its PR step opens the pull request with `Closes #<n>` and moves the card to In review. |

Flow: plan, then `/plan-to-issues`, then `/start-issue <n>`, then a PR whose body has `Closes #n`, then merge. GitHub's own workflows move the card to Done.

## Requirements

- Node 20 or newer, `git`, and the [GitHub CLI](https://cli.github.com) (`gh`) logged in with the `project` scope: `gh auth refresh -s project`.
- No npm dependencies.

## Install

The `plan-to-issues` and `start-issue` skills call the CLI at `~/.agents/skills/init-kanban/scripts/kanban.mjs`, so install all three side by side under `~/.agents/skills`:

```sh
git clone https://github.com/irularif/kanban-skills.git
cd kanban-skills
mkdir -p ~/.agents/skills
for s in init-kanban plan-to-issues start-issue; do ln -s "$PWD/skills/$s" ~/.agents/skills/$s; done
# Claude Code reads ~/.claude/skills:
for s in init-kanban plan-to-issues start-issue; do ln -s ../../.agents/skills/$s ~/.claude/skills/$s; done
```

Then run `/init-kanban` inside the repository you want a board for.

## What you still click by hand

GitHub does not expose these through its API, so `init-kanban` prints them with links:

1. Enable the **Auto-add to project** workflow with the filter `is:issue is:open`.
2. Set the **Pull request linked to issue** workflow target to **In review**.
3. Set group-by on the views (Board by Status, By epic by Parent issue).

## Things to know

- Status columns: Triage, Backlog, Ready, In progress, In review, Done. The default `Todo` option is renamed to Triage with its id kept, because the board's workflows target option ids.
- Collaborators can only be added, never listed (GitHub exposes no readable field), so `--collaborator user:READ` is re-applied on every run. Do not pass a lower role than the user already has.
- Adding an epic that already has many sub-issues makes GitHub's "Auto-add sub-issues to project" workflow pull all of them onto the board, closed ones included. Disable that workflow first if you do not want that.
- The git hooks only warn and always exit 0. They are installed into the repo's existing hook mechanism (`core.hooksPath` or Husky) and never replace existing hooks.

## Tests

```sh
cd skills/init-kanban && npm test
```

The tests use a fake `gh`. The real-API behaviour was checked against a live board; fakes alone did not catch every real-API error, so re-check against a throwaway project after changing GraphQL.

## License

MIT
