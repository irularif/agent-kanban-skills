---
name: plan-to-issues
description: Use when the user types /plan-to-issues or asks to turn a markdown spec or plan into GitHub issues on the project kanban board. Groups tasks into PR-sized units, gets approval, then creates a parent issue plus sub-issues with Status, Area and Size set.
---

# plan-to-issues

Turn a markdown spec or plan into GitHub issues: one parent (epic) issue plus one sub-issue per PR-sized unit, all on the repo's Project board. Requires a board set up by `/init-kanban` (`.github/kanban.json`); if missing, tell the user to run `/init-kanban` first.

CLI: `node "$KANBAN" add-issues <units.json> [--dry-run]`

## Locating the CLI

The CLI sits in the `init-kanban` skill folder. Resolve it once per session and use it as `$KANBAN`. Replace `<this skill dir>` with the directory that holds this `SKILL.md`:

```sh
KANBAN=$(for p in "<this skill dir>/../init-kanban/scripts/kanban.mjs" ./.agents/skills/init-kanban/scripts/kanban.mjs ~/.agents/skills/init-kanban/scripts/kanban.mjs ~/.claude/skills/init-kanban/scripts/kanban.mjs; do [ -f "$p" ] && echo "$p" && break; done)
[ -n "$KANBAN" ] || echo "init-kanban skill not found: install all three skills (npx skills add irularif/kanban-skills)"
```

## Steps

1. **Read the doc** the user names (any markdown spec or plan). If it already contains a `kanban-issues: {...}` line between `<!-- kanban:start -->` and `<!-- kanban:end -->`, this is a re-run: reuse the keys in that map for units that already exist. Existing issues are never edited.
2. **Group the tasks into units.** One unit = one PR. Prefer the task boundaries the doc already has, keep tests with the code they test, and merge tiny tasks that cannot ship alone. Each unit gets: a stable `key` (`u1`, `u2`, ...), a title, a body (what and why, the tasks included, acceptance notes), `area` (must be an existing Area option; `.github/kanban.json` does not list them. Read the options from the board's Area field, or run `add-issues --dry-run` once: an unknown area fails with `valid: ...` listing the options), `size` (`S`, `M` or `L`), and `status` (`Ready`, the default, or `Backlog`).
3. **Show the grouping table** and stop:

   | Key | Title | Tasks included | Area | Size | Status |
   |-----|-------|----------------|------|------|--------|

   Also show the parent issue title. **Wait for explicit approval.** Apply requested changes and show the table again. Do not run any non-dry-run command before the user says yes.
4. **Write `units.json`** to a temp file (not in the repo):

   ```json
   {
     "source": "docs/plans/example.md",
     "parent": { "key": "epic", "title": "...", "body": "..." },
     "units": [
       { "key": "u1", "title": "...", "body": "...", "area": "web", "size": "M", "status": "Ready" }
     ]
   }
   ```

   `source` is the doc path relative to the repo root. On a re-run use the same keys for existing units.
5. **Dry run**: `node "$KANBAN" add-issues <units.json> --dry-run`. It validates Area/Size/Status and lists what would be created. Fix any error and repeat.
6. **Create**: run the same command without `--dry-run`. Issues already in the map are not created again. A failure midway leaves the map plus a `kanban-pending` line listing issues not yet fully wired (board, fields, parent link); re-running re-wires those without creating or editing issues.
7. **Report** the issue links (parent and sub-issues) and tell the user to **commit the updated source doc**, which now holds the `kanban-issues` map.

## Exit codes

0 ok, 1 usage or validation error (nothing was written), 2 GitHub/`gh` failure.
