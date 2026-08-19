---
description: Reading-experience enhancer for design quorum HTML
mode: subagent
model: opencode/big-pickle
variant: high
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
