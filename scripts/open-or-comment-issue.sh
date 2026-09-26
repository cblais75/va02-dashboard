#!/usr/bin/env bash
# Usage: scripts/open-or-comment-issue.sh "<issue title>" <body-file>
# Opens a GitHub Issue with this exact title, or, if one is already open, adds the
# body as a comment so no duplicate is created. Needs GH_TOKEN and GITHUB_REPOSITORY.
set -euo pipefail
title="$1"
body="$2"

existing=$(gh issue list --repo "$GITHUB_REPOSITORY" --state open --search "\"$title\" in:title" \
  --json number,title --jq "map(select(.title == \"$title\")) | .[0].number // empty")

if [ -n "$existing" ]; then
  gh issue comment "$existing" --repo "$GITHUB_REPOSITORY" --body-file "$body"
  echo "Added to open issue #$existing: $title"
else
  gh issue create --repo "$GITHUB_REPOSITORY" --title "$title" --body-file "$body"
fi
