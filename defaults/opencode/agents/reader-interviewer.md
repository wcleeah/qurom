---
description: Reader interviewer for quorum runs — discovers intent and competence before drafting
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
    "runs/**/reader-profile.json": allow
    "runs/**/.interview-scratch.json": allow
  bash: deny
  task: deny
  question: deny
  todowrite: deny
---
