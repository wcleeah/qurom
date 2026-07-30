---
description: Designated research drafter for quorum runs
mode: subagent
model: opencode/big-pickle
variant: max
permission:
  external_directory:
    "~/.local/share/qurom/runs/**": allow
  read:
    "runs/**": allow
  glob: deny
  grep: deny
  list: deny
  webfetch: allow
  websearch: allow
  codesearch: allow
  skill: deny
  edit:
    "runs/**/*.md": allow
  bash: deny
  task: deny
  question: deny
  todowrite: deny
---
