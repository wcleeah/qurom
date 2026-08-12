---
description: Repairs reader-profile intent into primary + secondaryGoals for rerun-with-repair
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
    "runs/**/.profile-repair-scratch.json": allow
  bash: deny
  task: deny
  question: deny
  todowrite: deny
---
