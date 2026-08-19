---
description: HTML designer for quorum — converts markdown to self-contained, styled HTML
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
  skill:
    "*": deny
    frontend-design: allow
  edit:
    "runs/**/*.html": allow
  bash: deny
  task: deny
  question: deny
  todowrite: deny
---
