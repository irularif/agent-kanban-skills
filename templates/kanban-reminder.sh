#!/bin/sh
# Warn-only kanban reminders. Needs sh + git; gh is optional. Always exits 0.

branch=$(git symbolic-ref -q --short HEAD 2>/dev/null) || exit 0
[ -n "$branch" ] || exit 0

default=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##')
[ -n "$default" ] || default=main
[ "$branch" = "$default" ] && exit 0

num=$(printf '%s\n' "$branch" | sed -n -E 's#^[a-z]+/([0-9]+)-.*#\1#p')

case "$1" in
  post-checkout)
    [ "$4" = "1" ] || exit 0
    [ -z "$num" ] || exit 0
    # newly created: one branch reflog entry, and HEAD has moved onto it only once
    [ "$(git reflog show --format=%H "refs/heads/$branch" 2>/dev/null | wc -l | tr -d ' ')" = "1" ] || exit 0
    visits=$(git reflog show --format=%gs HEAD 2>/dev/null | grep -E "^checkout: moving from .* to " | sed 's/^.* to //' | grep -c -x -F "$branch")
    [ "$visits" -le 1 ] || exit 0
    {
      echo "⚠ kanban: branch '$branch' is not linked to an issue."
      echo "  Start work with /start-issue <n> (or: node ~/.agents/skills/init-kanban/scripts/kanban.mjs start <n>)"
    } >&2
    ;;
  pre-push)
    [ -n "$num" ] || exit 0
    command -v gh >/dev/null 2>&1 || exit 0
    run=""
    command -v timeout >/dev/null 2>&1 && run="timeout 5"
    $run gh auth status >/dev/null 2>&1 || exit 0
    root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
    file="$root/.github/kanban.json"
    [ -f "$file" ] || exit 0
    project=$(sed -n 's/.*"projectNumber"[^0-9]*\([0-9][0-9]*\).*/\1/p' "$file" | head -n 1)
    [ -n "$project" ] || exit 0
    slug=$(git remote get-url origin 2>/dev/null | sed -E 's#^.*github\.com[:/]##; s#\.git$##')
    owner=${slug%%/*}
    name=${slug#*/}
    [ -n "$owner" ] && [ -n "$name" ] && [ "$owner" != "$slug" ] || exit 0
    query='query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){issue(number:$n){projectItems(first:20){nodes{project{number} fieldValueByName(name:"Status"){... on ProjectV2ItemFieldSingleSelectValue{name}}}}}}}'
    filter=".data.repository.issue.projectItems.nodes[] | select(.project.number == $project) | .fieldValueByName.name // empty"
    status=$($run gh api graphql -f query="$query" -f o="$owner" -f r="$name" -F n="$num" --jq "$filter" 2>/dev/null) || exit 0
    status=$(printf '%s\n' "$status" | head -n 1)
    case "$status" in
      "In progress" | "In review") exit 0 ;;
    esac
    [ -n "$status" ] || status="not on board"
    echo "⚠ kanban: issue #$num is '$status' on the board, expected In progress. Run /start-issue $num." >&2
    ;;
esac
exit 0
