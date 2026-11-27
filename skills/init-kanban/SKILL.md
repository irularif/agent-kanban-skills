---
name: init-kanban
description: Use when the user types /init-kanban or asks to set up a GitHub kanban board for this repo. Creates the GitHub Project (Status, Area, Size fields, views), labels, issue forms, a CONTRIBUTING section and an agent-file line, and binds the repo to the board.
---

# init-kanban

Set up a GitHub Project kanban board for the current repo. The CLI does the work; you gather inputs and relay results. Never commit anything.

CLI: `node ~/.agents/skills/init-kanban/scripts/kanban.mjs <command>`

## Steps

1. Run `gh auth status`. The token needs the `project` scope. If it is missing, tell the user to run `gh auth refresh -s project` and stop.
2. Inspect the repo layout (top-level apps, packages, modules) and propose Area options, for example `api,web`. `shared` is always added.
3. Ask the user to confirm the Areas and any optional collaborators (login plus `READ` or `WRITE`).
4. Detect the language the repo's docs are written in (`en` or `id`).
5. Run a dry run and show the output. If it prints `Using existing project #N '<title>'`, an existing board with the repo's name would be adopted: ask the user whether to proceed before step 6.

   ```
   node ~/.agents/skills/init-kanban/scripts/kanban.mjs init --dry-run --area <a,b> [--collaborator user:READ|WRITE ...] --language <en|id>
   ```

6. On the user's approval run the same command without `--dry-run`. It is safe to re-run; a second run lists nothing as created or written. The dry run also lists repo files it would write (`Would write`). If a hook file has an `exit` or `exec` line, relay the manual note about moving the block.
   Collaborator roles cannot be read back from GitHub, so they are re-applied on every run and never listed as created. Never pass a lower role than the user already has (a re-run would downgrade them).
7. Relay the board URL, the files written and the warnings. Relay the manual steps with links to the board settings:
   - Enable Auto-add with the filter `is:issue is:open`.
   - Set the workflow "Pull request linked to issue" target to In review.
   - Set group-by: view Board by Status, view By epic by Parent issue.
8. Tell the user to review and commit the changed files. Do not commit them yourself.

`kanban.mjs check` lists any manual steps still pending.
