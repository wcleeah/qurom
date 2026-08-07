---
description: HTML repair agent — fixes user-reported bugs in final.html and verifies with Playwright
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
    "runs/**/*.html": allow
  bash: allow
  task: deny
  question: deny
  todowrite: allow
---
