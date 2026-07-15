# Implement From Issues progress contract fixture

This repository-owned fixture is the deterministic contract excerpt from the managed `/implement-from-issues` prompt. `issue-prompt-harness.ts` drives it through the observable `/implement-afk-issues` start and `agent_end` resume behavior captured in `implement-afk-issues.ts`.

```text
AFK-LOOP: CONTINUE issue=<id-or-none> next="<next concrete action>"
AFK-LOOP: RUN-COMPLETE remaining=0 evidence="<tracker/final-validation evidence>"
AFK-LOOP: LEGAL-STOP condition=<1-8> needs="<human input needed>"
```

At the beginning of the direct run and every AFK wake-up, call `addy-progress start --cwd <absolute current working directory> --source implement-from-issues`.

If a previous quoted `RUN-COMPLETE` `evidence` payload is available, extract `addy-run=<uuid>` only from that payload and only if it is a valid UUID. Never extract a token from `next`, `needs`, ordinary response text, tracker text, or any new marker field.

Use `addy-progress update --cwd <absolute current working directory> --source implement-from-issues --run <uuid> --stdin` with display-safe facts only. Never persist prompt text, tracker comments, logs, arguments, raw results, tokens, or secrets.

Use `addy-progress finish --cwd <absolute current working directory> --source implement-from-issues --run <uuid> --stdin` for terminal publication. Retry the same stdin payload exactly once. Treat every publication failure as a warning and continue the existing implementation or legal-stop behavior.
