---
description: Reasoning and coherence auditor for quorum drafts
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
    "runs/**/audit-logic-auditor-*.json": allow
  bash: deny
  task: deny
  question: deny
  todowrite: deny
---
