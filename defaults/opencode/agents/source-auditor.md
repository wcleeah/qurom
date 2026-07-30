---
description: Source and citation auditor for quorum drafts
mode: subagent
model: opencode/big-pickle
variant: thinking
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
    "runs/**/audit-source-auditor-*.json": allow
  bash: deny
  task: deny
  question: deny
  todowrite: deny
---
