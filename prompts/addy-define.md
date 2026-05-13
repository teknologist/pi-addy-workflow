---
description: "Addy workflow: start spec-driven development before writing code"
thinking: medium
argument-hint: "[spec-path|idea]"
---

# Addy Define

Pi adaptation of Addy Osmani's `define` command.

Use the Pi `spec-driven-development` skill.

Argument forms:

Supplied argument text, if any: `$ARGUMENTS`.

- `/addy-define [spec-path]`
- `/addy-define "what you want to build"`

If a spec path or filename is supplied, treat it as the active spec to create or revise and update the Addy workflow state's active spec. If a quoted build explanation is supplied, use it as the initial brainstorming context instead of asking the user to restate the idea. If no argument is supplied, create a new spec using the naming rules below.

Begin by understanding what the user wants to build. When a build explanation argument is supplied, use it as the starting point and ask only for material missing decisions that block a useful spec. Otherwise, ask clarifying questions about:

1. The objective and target users
2. Core features and acceptance criteria
3. Tech stack preferences and constraints
4. Known boundaries (what to always do, ask first about, and never do)

Then generate a structured spec covering all six core areas: objective, commands, project structure, code style, testing strategy, and boundaries.

Save new `/addy-define` specs under `docs/specs/` using a meaningful, kebab-case filename with a timestamp prefix: `YYYY-MM-DD-HHMMSS-<meaningful-name>.md`. Do not save `/addy-define` specs as `SPEC.md` in the project root. Confirm the generated spec path with the user before proceeding.

Pi-specific execution notes:

- Before asking questions, follow the Pi `extension-interviewer` skill and use `ask_user_question` for structured choices when appropriate.
- Do not implement until the user approves the spec and explicitly asks for implementation.
