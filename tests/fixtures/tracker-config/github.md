<!-- provenance: source=docs/agents/issue-tracker.md,docs/agents/triage-labels.md; sha256=d9949c929d688ad9add88aaa23fdbfb0bd2935639699c9c493fb48e828734c15,9bbb882a64b0732794a61f3f097bca2ebe419f540d84d1529d03a55016633381; captured=2026-07-16 -->

# Issue tracker: GitHub

Issues and PRDs for this repository live in GitHub Issues at
`teknologist/pi-addy-workflow`. Use the `gh` CLI for all operations.

## Conventions

- Create: `gh issue create --title "..." --body "..."`
- Read: `gh issue view <number> --comments`
- List: `gh issue list` with appropriate label and state filters
- Comment: `gh issue comment <number> --body "..."`
- Label: `gh issue edit <number> --add-label "..."` or `--remove-label "..."`
- Close: `gh issue close <number> --comment "..."`
- Infer the repository from the current clone and its Git remote.

## Pull requests as a triage surface

PRs as a request surface: no.

Do not include pull requests in the issue triage queue.

## Skill terminology

- “Publish to the issue tracker” means create a GitHub issue.
- “Fetch the relevant ticket” means read the GitHub issue and its comments.
- A bare `#<number>` must be resolved because GitHub shares numbering between
  issues and pull requests.

## Wayfinding

Use one `wayfinder:map` issue with linked child issues. Prefer GitHub sub-issues
and native dependencies; fall back to task-list links and `Blocked by:` lines
when those features are unavailable. Claim work by assigning the issue, resolve
it with an evidence comment, then close it.

---

# Triage labels

| Canonical role  | GitHub label    | Meaning                             |
| --------------- | --------------- | ----------------------------------- |
| needs-triage    | needs-triage    | Maintainer needs to evaluate        |
| needs-info      | needs-info      | Waiting on reporter information     |
| ready-for-agent | ready-for-agent | Fully specified and AFK-agent ready |
| ready-for-human | ready-for-human | Requires human implementation       |
| wontfix         | wontfix         | Will not be actioned                |

When a skill names a canonical role, use its mapped GitHub label.
