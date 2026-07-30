---
description: Clarity and structure auditor for quorum drafts
mode: subagent
model: opencode/big-pickle
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
    "runs/**/audit-clarity-auditor-*.json": allow
  bash: deny
  task: deny
  question: deny
  todowrite: deny
---
