---
name: deep-dive-research
description: Write detailed, plainspoken, source-backed deep dives that follow one tight line of reasoning from the reader's starting confusion to a clear understanding.
compatibility: opencode
metadata:
  audience: engineers
  style: deep-dive
---

# Deep-Dive Research Skill

## What I do

Use this skill when the user wants to understand a technical topic deeply.

Examples:
- how a runtime or protocol works
- how a library behaves internally
- how a database, terminal, build tool, or framework feature works
- why a confusing behavior happens

The goal is not to dump facts about the topic.
The goal is to take the reader from a real starting confusion to a real finish line with a coherent chain of reasoning.

This skill should produce writing that is:
- detailed
- plainspoken
- tightly reasoned
- example-rich
- source-backed

## When to use me

Use this skill when the user wants:
- a guide
- a research note
- a deep explanation
- a systems walkthrough
- a mental model for a topic that currently feels magical or opaque

Do not use this skill for implementation plans or audit-style reviews. Use a plan or review skill for those.

## Writing Contract

### 1. Throughline first

The document must read like a guided argument, not an encyclopedia.

At the top, make these three things explicit:
- the starting point: what the reader currently knows, sees, or is confused by
- the driving question: what exact question this document is answering
- the finish line: what the reader should understand by the end

Every major section must move the reader toward that finish line.

If a section contains true facts but does not advance the reasoning, cut it or move it to an appendix.

### 2. Keep the detail, but shape it

This skill should be detailed.

But detail must stay attached to the main line of reasoning.

For each important section, do this in order:
1. state what question the section answers
2. give the short answer
3. show one concrete example
4. explain the deeper mechanics
5. explain why this matters for the overall question
6. list edge cases or failure modes
7. attach sources

Do not remove detail just to sound clean.
Do not dump mechanics before the reader knows why they matter.

### 3. Explain jargon on first use

If a term is likely to confuse a careful engineer outside the immediate subfield, define it in one plain sentence the first time it appears.

Examples of terms that usually need explanation:
- symlink
- canonicalization
- dedupe
- MVCC
- hydration
- reconciliation
- file identity
- multikey

If you use a technical term, immediately answer: what does this mean in plain English here?

### 4. Prefer plain words over mystical wording

Avoid writing that sounds abstract but teaches little.

Avoid phrases like:
- coherent graph
- semantic layer
- identity boundary
- topology-sensitive
- elegant mechanism
- robust behavior
- seamless integration

Unless the term is truly necessary.
If it is necessary, explain it immediately and concretely.

### 5. Use a running example

Prefer one running example that appears throughout the document over many unrelated examples.

Good examples:
- one query through the database
- one import through the bundler
- one request through the server
- one shell command through the terminal stack

Reuse the same example to explain later sections so the document feels like one journey.

### 6. No cold facts

Do not include a fact just because it is relevant to the topic.

Only include it if it does at least one of these:
- helps the reader understand the next step in the reasoning
- changes the conclusion
- explains a failure mode
- clarifies a confusing term
- helps the reader predict real behavior

### 7. Tie claims to evidence

Every non-obvious claim needs a source.

Prefer sources in this order:
1. source code
2. official docs
3. specs or standards
4. high-quality technical articles
5. maintainer comments or issue threads when needed

Do not only dump links at the end. Tie important claims to sources in the body, then collect them again in a final Sources section.

### 8. Distinguish certainty levels

Explicitly label claims when needed as:
- Confirmed
- Inferred
- Speculative

If something was not directly verified, say so.

### 9. Keep asking "so what?"

At the end of each important section, answer:
- so what?
- why does this matter for the original question?

If the section does not change the reader's understanding, it is probably not pulling its weight.

## Required Structure

Use this structure unless the topic strongly demands a different one:

1. Short answer
2. Starting point, driving question, and finish line
3. Why this thing exists or why this problem happens
4. Core terms you need first
5. The mental model
6. One tiny running example
7. How it works step by step
8. What this looks like in real systems or source code
9. Common failure modes or misconceptions
10. Practical rules of thumb
11. Sources

## Section Pattern

For major sections, prefer this internal shape:

### What this section is answering
State the question.

### Short answer
Give the direct point.

### Concrete example
Show a tiny example immediately.

### How it works
Explain the deeper mechanics.

### Why this matters here
Tie it back to the document's main question.

### Edge cases or failure modes
Show where the simple model breaks down.

### Sources
List the relevant source files, docs, specs, or articles.

## Research Rules

- Read primary sources when possible.
- If source code is used, cite exact file paths.
- If version differences matter, say which version the explanation applies to.
- If behavior is implementation-defined or tool-version-sensitive, say that explicitly.
- Use repo-specific examples if the current codebase contains a relevant case.

## Banned Failure Modes

Do not:
- use unexplained jargon
- write long abstract sections without examples
- present strong claims without sources
- confuse recommendation with fact
- hide uncertainty
- use filler words like powerful, elegant, robust, or seamless without specifics
- structure the document like a pile of correct notes

## Final Quality Check

Before finishing, verify:
- the starting point, driving question, and finish line are explicit
- every major section advances the argument
- every jargon term is defined on first use
- every complex section has an example
- every major claim has a source
- the reader could explain the topic back in plain English after reading

## Output Expectation

The finished document should feel like this:
- we start with one real confusion
- we build the minimum model needed to resolve it
- we reuse one example to go deeper
- we connect behavior to evidence
- the conclusion feels earned, not asserted
