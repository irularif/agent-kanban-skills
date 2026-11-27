---
name: start-issue
description: Use when the user types /start-issue <n> or asks to start work on a GitHub issue from the project kanban board. Moves the issue to In progress, switches to its branch, and later opens the pull request linked to it.
---

# start-issue

Works for any agent. The CLI is `node "$KANBAN"`. The repo must already be bound with `/init-kanban` (`.github/kanban.json`).

## Locating the CLI

The CLI sits in the `init-kanban` skill folder. Resolve it once per session and use it as `$KANBAN`. Replace `<this skill dir>` with the directory that holds this `SKILL.md`:

```sh
KANBAN=$(for p in "<this skill dir>/../init-kanban/scripts/kanban.mjs" ./.agents/skills/init-kanban/scripts/kanban.mjs ~/.agents/skills/init-kanban/scripts/kanban.mjs ~/.claude/skills/init-kanban/scripts/kanban.mjs; do [ -f "$p" ] && echo "$p" && break; done)
[ -n "$KANBAN" ] || echo "init-kanban skill not found: install all three skills (npx skills add irularif/agent-kanban-skills)"
```

## Start

1. Run `node "$KANBAN" start <n>`.
   It closes any parent issue whose sub-issues are all done, sets the issue to **In progress**, and creates or switches to branch `<prefix>/<n>-<slug>` from the default branch (`fix` for label `bug`, otherwise `feat`; override with `--prefix`).
2. Treat the printed issue title, URL and body as the task. If the body names a `Source:` document, read that document section and follow it.
3. If the output says a parent was closed, tell the user.

## Work

Work normally on that branch: tests first, small commits. Do not push or create the PR by hand.

## Open the PR

When the work is done and committed, first show the user the branch, the commits and the proposed PR title and body, and **wait for explicit approval**. Do not run `pr` before the user says yes. Write the body to a temp file, then run `node "$KANBAN" pr <n>` (optional `--title "..."`, `--draft`, `--body-file <path>`). It pushes the branch, opens a PR whose body is the file content (or just `Closes #<n>`) with `Closes #<n>` appended on its own line when missing, and sets the issue to **In review**. If a PR for the branch already exists it is reused instead of creating another. It refuses if the current branch belongs to another issue. Report the PR URL.

To close finished parent issues on demand: `node "$KANBAN" close-parents`.

## Notes

- Branch names must match `<prefix>/<n>-<slug>`; the number is how the CLI and git hooks find the issue.
- The git hooks installed by `/init-kanban` print a warning when work happens on a branch that skipped this skill, so run `start` first.
