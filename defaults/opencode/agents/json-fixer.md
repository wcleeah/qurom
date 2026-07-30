---
description: JSON syntax repair agent — fixes malformed JSON output files
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
  webfetch: deny
  websearch: deny
  codesearch: deny
  skill: deny
  edit:
    "runs/**/*.json": allow
  bash: deny
  task: deny
  question: deny
  todowrite: deny
---
