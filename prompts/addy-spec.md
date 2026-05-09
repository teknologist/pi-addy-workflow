---
description: "Addy workflow: start spec-driven development before writing code"
thinking: medium
---

# Addy Spec

Pi adaptation of Addy Osmani's `spec` command.

Use the Pi `spec-driven-development` skill.

Begin by understanding what the user wants to build. Ask clarifying questions about:

1. The objective and target users
2. Core features and acceptance criteria
3. Tech stack preferences and constraints
4. Known boundaries (what to always do, ask first about, and never do)

Then generate a structured spec covering all six core areas: objective, commands, project structure, code style, testing strategy, and boundaries.

Save the spec as `SPEC.md` in the project root and confirm with the user before proceeding.

Pi-specific execution notes:

- Before asking questions, follow the Pi `extension-interviewer` skill and use `ask_user_question` for structured choices when appropriate.
- Do not implement until the user approves the spec and explicitly asks for implementation.
