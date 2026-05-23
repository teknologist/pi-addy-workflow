# pi-addy-workflow Context

This context names the Addy workflow concepts used by the Pi extension. Use these terms when discussing workflow-monitor architecture, prompts, and tests.

## Language

**Addy Workflow**:
The coding lifecycle coordinated by this package, with `BUILD → VERIFY → REVIEW` as the enforced path.
_Avoid_: pipeline, process

**Addy Auto Mode**:
The autonomous Addy Workflow runner that dispatches lifecycle prompts, retries blocked steps, and carries work across fresh sessions.
_Avoid_: autopilot, daemon

**Auto Control**:
The Addy Auto Mode state that decides whether autonomous dispatch should continue, pause, retry, or resume in another session.
_Avoid_: auto flags, scheduler state

**Auto Action Keys**:
The Addy Auto Mode Module that derives stable retry/dedupe identities for workflow prompts, preferring Stable Task IDs and falling back to legacy task index/title identity.
_Avoid_: key helpers, retry hashes

**Fresh Continuation**:
The Addy Auto Mode Module that carries pending workflow prompts across fresh sessions, consumes delivered pending prompts, and falls back to current-session delivery when session replacement is unavailable or cancelled.
_Avoid_: compaction helper, new-session glue

**Review Control**:
The review-specific state that tracks review-fix loops, repeated findings, and pending review stats attribution.
_Avoid_: review flags, issue counters

**Review Findings**:
The Addy Workflow Module that interprets review agent text into actionable finding lines, severity stats, and repeated-finding fingerprints.
_Avoid_: review regexes, parser helpers

**Repository Scope**:
The Slice Plan Module that resolves which repositories an auto commit prompt must inspect and commit, based on plan metadata and index-plan owner/companion labels.
_Avoid_: repo string parsing, commit prompt paths

**Runtime Shell**:
The Adapter boundary around host side effects such as prompt delivery, UI notification, editor prefill, idle detection, session replacement, timers, and persistence.
_Avoid_: helper bag, environment glue

**Timer Loop**:
The Addy Workflow Module that owns delayed idle retry mechanics, timer dedupe, timeout handling, and release behavior while accepting workflow callbacks from the Runtime Shell.
_Avoid_: timeout helper, scheduler callback

**Slice Plan**:
A markdown plan that breaks work into small tasks tracked by lifecycle checkboxes.
_Avoid_: task list, checklist, todo file

**Lifecycle Status**:
One of `Implemented`, `Verified`, or `Reviewed` for a Slice Plan task.
_Avoid_: checkbox label, phase marker

**Stable Task ID**:
A markdown-safe HTML comment identifier that lets Commit Evidence survive task title edits.
_Avoid_: generated state key, title hash

**Task Closure**:
The state where a Slice Plan task has all required Lifecycle Statuses and matching Commit Evidence.
_Avoid_: done, complete

**Task Frontier**:
The first Slice Plan task that is not closed and therefore determines the next Addy Workflow action.
_Avoid_: current task pointer, next task heuristic

**Commit Evidence**:
A recorded commit identity proving a task's completed lifecycle work was committed.
_Avoid_: commit flag, git marker

**Task Commit Coordinator**:
The Addy Auto Mode Module that prompts for autonomous task commits, interprets commit results, records Commit Evidence, and chooses the post-commit continuation.
_Avoid_: commit helper, git glue

**Auto Agent-End**:
The Addy Auto Mode Module that coordinates agent completion branches such as finish completion, review-fix continuation, task commit handoff, and fallback frontier dispatch while preserving branch-specific state cleanup and continuation side effects behind a small Interface.
_Avoid_: agent_end helper, completion callback glue

**Workflow Stats**:
Counts Addy Workflow turns, verify runs, review runs, review findings, and archived task sessions for one or more Slice Plan tasks.
_Avoid_: metrics blob, counters

**Command Router**:
The pure Addy Workflow Module that owns slash-command parsing, prompt command metadata, command-to-phase mapping, and workflow command classification.
_Avoid_: command helpers, string switches

**Command Dispatch**:
The Addy Workflow Module that plans how a selected workflow prompt is delivered, including current-session delivery, pending fresh-session continuation, manual fresh-context notices, and dispatch-time Workflow State updates.
_Avoid_: prompt sender, command executor

**Prompt Template Module**:
The Addy Workflow Module that expands packaged slash-command prompts into dispatchable prompt text while preserving invocation identity and failing open to the original prompt when template expansion is unavailable.
_Avoid_: template helper, string expansion glue

**State Codec**:
The pure Addy Workflow Module that decodes, normalizes, and serializes Workflow State; validates persisted/session field shapes; and applies legacy state migrations before Runtime Shell storage uses it.
_Avoid_: state parser, JSON helper

## Relationships

- An **Addy Workflow** may run against one active **Slice Plan**.
- **Addy Auto Mode** uses **Auto Control** to preserve pending work across sessions and uses **Review Control** for review-fix safety.
- **Auto Action Keys** give **Auto Control**, delayed prompt delivery, and watchdog retries a shared identity vocabulary for the same workflow action.
- **Fresh Continuation** uses **Auto Control** pending-fresh state and the **Runtime Shell** fresh-session Adapter to preserve autonomous work across context clearing.
- **Review Findings** keeps review text interpretation local so **Review Control** and **Workflow Stats** share the same actionable-finding vocabulary.
- **Repository Scope** keeps cross-repo commit instructions grounded in **Slice Plan** metadata instead of fresh-session file-touch history.
- **Runtime Shell** isolates side effects from workflow decision Modules and provides timer primitives consumed by the **Timer Loop**.
- **Timer Loop** hides retry scheduling mechanics; workflow policy such as pending action preservation, fresh continuation validity, and notification wording stays outside the Module.
- A **Slice Plan** contains one or more tasks with **Lifecycle Statuses**.
- A **Slice Plan** task should have a **Stable Task ID** written as an `addy-task-id` HTML comment.
- A task reaches **Task Closure** only when all **Lifecycle Statuses** are present and matching **Commit Evidence** exists.
- **Commit Evidence** should match by **Stable Task ID** when present, and fall back to legacy plan path, task index, and title identity when absent.
- **Task Commit Coordinator** creates and verifies **Commit Evidence** after a task reaches reviewed status, then either advances to the next **Task Frontier** or finishes the **Slice Plan**.
- **Auto Agent-End** consumes final agent text and **Task Frontier** decisions to sequence completion-specific Addy Auto Mode branches without spreading finish cleanup, review-fix loop policy, task commit handoff, or fallback frontier dispatch across the monitor entrypoint.
- The **Task Frontier** is derived from the first task that has not reached **Task Closure**.
- **Workflow Stats** are evidence about workflow activity; they can inform missing verify/review runs, but **Task Closure** still requires matching **Commit Evidence**.
- **Command Router** gives workflow decision Modules a shared command vocabulary without spreading slash-command string switches across implementations.
- **Prompt Template Module** consumes **Command Router** prompt metadata and owns packaged prompt file expansion so callers do not need to know prompt file locations, frontmatter stripping, argument substitution, or fail-open rules.
- **Command Dispatch** consumes **Command Router** vocabulary and selected workflow prompts, then returns dispatch plans that the **Runtime Shell** executes through host side effects.
- **State Codec** lets Runtime Shell persistence fail closed on invalid stored Workflow State while preserving explicit legacy migrations and in-memory normalization rules.

## Example dialogue

> **Dev:** "The Slice Plan shows Implemented, Verified, and Reviewed. Can auto mode move on?"
> **Domain expert:** "Only if there is Commit Evidence matching the Stable Task ID too; otherwise the task is still the Task Frontier."

## Flagged ambiguities

- "complete" can mean either all Lifecycle Statuses are checked or full **Task Closure**. Use **Task Closure** when Commit Evidence is required.
- Legacy Slice Plans may not contain **Stable Task IDs**. In that case, preserve the old plan path, task index, and title identity until a future migration is explicit.
