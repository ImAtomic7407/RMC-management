---
name: coding-guidelines
description: Behavioral guidelines to reduce common LLM coding mistakes. Derived from Andrej Karpathy's observations. Always active.
---

# Coding Guidelines

## 1. Think Before Coding
- State assumptions explicitly before implementing.
- If multiple interpretations exist, present them — don't pick silently.
- If something is unclear, stop and ask.

## 2. Simplicity First
- Minimum code that solves the problem. Nothing speculative.
- No abstractions for single-use code.
- No "flexibility" that wasn't requested.
- If you write 200 lines and it could be 50, rewrite it.

## 3. Surgical Changes
- Don't "improve" adjacent code unless asked.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- Remove only imports/variables/functions that YOUR changes made unused.

## 4. Goal-Driven Execution
Transform tasks into verifiable goals:
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Add a screen" → "Screen renders, data loads, actions call ViewModel methods"

For multi-step tasks, state a brief plan first:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
```
