<!-- provenance: source=/Users/eric/Dev/invoicehub-workflows/docs/agents/issue-tracker.md,/Users/eric/Dev/invoicehub-workflows/docs/agents/triage-labels.md; sha256=65ffa571f78d2819a3ae0decae0c30d5d526948463d7c66325d6c2e0891e53ab,4f53c9b40ce2651e3611aa090eaedbd6dbc9b71ef8c5f7e65eac0d8263190d0d; captured=2026-07-16 -->

# Issue tracker: Linear

Issues and PRDs for this repo live in Linear. Use the Linear skill/tools for all issue operations; do not use raw API calls or ad-hoc CLI commands.

## Conventions

- **Create an issue**: create a Linear issue in the appropriate team/project for this repo. Include the repository name (`invoicehub-workflows`) and enough context for an AFK agent to pick it up.
- **Publish a PRD**: create a Linear issue or project document, following the user's requested workflow if they specify one. Link follow-up implementation issues back to the PRD issue.
- **Read an issue**: fetch the Linear issue, including description, labels, status, assignee, project, cycle, and comments.
- **List issues**: filter Linear issues by team/project, state, assignee, and labels relevant to this repo.
- **Comment on an issue**: add a Linear comment with concise implementation notes, verification evidence, or clarification requests.
- **Apply / remove labels**: use the mapping in `triage-labels.md`.
- **Close / cancel**: move the issue to the appropriate Linear completed or canceled state and leave a comment explaining why.

## When a skill says "publish to the issue tracker"

Create or update a Linear issue.

## When a skill says "fetch the relevant ticket"

Read the relevant Linear issue and its comments before planning or implementing changes.

## Missing routing details

If the Linear team, project, cycle, or label set is ambiguous, ask the user before creating or moving issues.

---

# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

Edit the right-hand column to match whatever vocabulary you actually use.
