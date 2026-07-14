# pi-addy-workflow Context

This context names the Addy workflow concepts used by the Pi extension. Use these terms when discussing workflow-monitor architecture, prompts, and tests.

## Language

**Addy Workflow**:
The coding lifecycle coordinated by this package, with `BUILD → VERIFY → REVIEW` as the enforced path.
_Avoid_: pipeline, process

**Addy Auto Mode**:
The autonomous Addy Workflow runner that dispatches lifecycle prompts, retries blocked steps, and carries work across fresh sessions.
_Avoid_: autopilot, daemon

**Addy Auto Runner Lock**:
The ownership boundary that allows exactly one top-level Pi process to dispatch Addy Auto Mode prompts for a repository while its fresh sessions continue the same run.
_Avoid_: session lock, repository lock, process dedupe

**Addy Auto Command**:
The Addy Auto Mode Module that handles `/addy-auto` command decisions: stale Fresh Continuation cleanup, pending Fresh Continuation delivery, pending task commit restart, stop handling, and Auto Watchdog startup.
_Avoid_: auto command callback, command registry branch

**Auto Control**:
The Addy Auto Mode state that decides whether autonomous dispatch should continue, pause, retry, or resume in another session.
_Avoid_: auto flags, scheduler state

**Auto Stop Intent**:
A request visible to the owning Addy Auto Mode runner to exit before its next prompt dispatch.
_Avoid_: remote kill, force unlock

**Workflow State Control**:
The Workflow State Module that owns preserving, clearing, and entering/exiting Auto Control and Review Control fields during workflow state transitions.
_Avoid_: field copy list, state flag plumbing

**Auto Action Keys**:
The Addy Auto Mode Module that derives stable retry/dedupe identities for workflow prompts, preferring Stable Task IDs and falling back to legacy task index/title identity.
_Avoid_: key helpers, retry hashes

**Fresh Continuation**:
The Addy Auto Mode Module that carries pending workflow prompts across fresh sessions, consumes delivered pending prompts, and falls back to current-session delivery when session replacement is unavailable or cancelled.
_Avoid_: compaction helper, new-session glue

**Fresh Continuation Delivery**:
The Fresh Continuation Module that owns pending prompt delivery, idle retry, busy fallback, consumed-key recording, and after-compaction current-session fallback.
_Avoid_: pending delivery helper, retry blob

**Fresh Continuation State**:
The Addy Auto Mode Module that owns pure pending-fresh prompt consumption, input matching, and current-session fallback option planning.
_Avoid_: pending prompt helper, fresh state utility

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

**Workflow Runtime Adapter**:
The Runtime Shell Adapter Module that exposes host notification, append-entry, and context-backed extension capabilities to workflow Modules through stable functions.
_Avoid_: API shim, context helper

**Timer Loop**:
The Addy Workflow Module that owns delayed idle retry mechanics, timer dedupe, timeout handling, and release behavior while accepting workflow callbacks from the Runtime Shell.
_Avoid_: timeout helper, scheduler callback

**Workflow Delivery**:
The Runtime Shell Adapter Module that expands workflow prompts, adds Addy Auto Mode recovery handoff text, delivers or pre-fills user messages, waits for idle when needed, and preserves pending Auto Action Keys after delivery failures.
_Avoid_: send helper, prompt plumbing

**Auto Recovery Prompt Policy**:
The Addy Auto Mode Module that owns recovery and fix-all handoff wording appended to auto-dispatched prompts.
_Avoid_: delivery text helper, unblock string

**Workflow Dispatch Options**:
The Addy Workflow Interface for shared prompt delivery controls such as append-entry behavior, idle-turn delivery, fresh-session bypass, compaction bypass, and same-phase retry permission.
_Avoid_: local options bag, handler flags

**Workflow Phases**:
The neutral Addy Workflow model for lifecycle phase names, enforced phase ordering, and phase status values shared by command routing and state transitions.
_Avoid_: transition constants, command phase map

**Slice Plan**:
A markdown plan that breaks work into small tasks tracked by lifecycle checkboxes.
_Avoid_: task list, checklist, todo file

**Slice Plan Progress**:
The Slice Plan Module that reads Slice Plan markdown and Workflow State to produce one snapshot of the Task Frontier, Task Closure state, next workflow action, slice progress, and footer progress data.
_Avoid_: tracker helpers, plan rendering logic

**Slice Plan Action**:
The Slice Plan Module that chooses the next Addy Workflow prompt or task commit action from Slice Plan task status and evidence.
_Avoid_: next prompt helper, action switch

**Slice Plan Snapshot**:
The Slice Plan Module that refreshes current/next task fields and exposes footer progress data from one Slice Plan read.
_Avoid_: task refresh helper, footer state helper

**Slice Plan Evidence**:
The Slice Plan Module that reconciles checked Lifecycle Statuses with Workflow Stats evidence so unverified or unreviewed work is not treated as closed.
_Avoid_: stats check helper, evidence regex

**Slice Plan Series**:
The Slice Plan Module that understands how one Slice Plan belongs to an ordered suite: index-plan links, numeric sibling slices, current/next unfinished slice selection, slice count, and cumulative task progress.
_Avoid_: index-plan helper, numbered file scan, suite path utility

**Slice Plan Repository**:
The Adapter that supplies Slice Plan markdown and sibling file facts to Slice Plan Modules without exposing raw filesystem calls at their Interface.
_Avoid_: fs helper, plan file utility

**Workflow Plan Continuation**:
The Addy Workflow Module that shapes state when advancing from one Slice Plan to the next while clearing stale task context and preserving suite ownership.
_Avoid_: next-plan reset helper, state cleanup object

**Workflow Task Summary**:
The Workflow Footer Module that produces compact current/next task labels, including fallback cleanup, optional model summarization, and stale-state race protection.
_Avoid_: footer summary helper, async handler side effect

**Lifecycle Status**:
One of `Implemented`, `Verified`, or `Reviewed` for a Slice Plan task.
_Avoid_: checkbox label, phase marker

**Stable Task ID**:
A markdown-safe HTML comment identifier that lets Commit Evidence survive task title edits.
_Avoid_: generated state key, title hash

**Workflow Task Identity**:
The Addy Workflow Module that owns Stable Task ID precedence, legacy task index/title fallback, task identity matching, and key serialization for Commit Evidence, Auto Action Keys, Review Control, and Workflow Stats.
_Avoid_: local key helper, task-id string convention

**Plan Task Resolution**:
The Addy Workflow Module that resolves a target task identity to the canonical Slice Plan task using Stable Task ID first, then legacy task index/title fallback.
_Avoid_: task lookup helper, plan task matcher

**Plan Task Reader**:
The Slice Plan Module that combines Slice Plan markdown reads with Plan Task Resolution so callers ask for task completion or canonical task facts instead of parsing files themselves.
_Avoid_: task read helper, markdown lookup

**Task Closure**:
The state where a Slice Plan task has all required Lifecycle Statuses and matching Commit Evidence.
_Avoid_: done, complete

**Task Frontier**:
The first Slice Plan task that is not closed and therefore determines the next Addy Workflow action.
_Avoid_: current task pointer, next task heuristic

**Commit Evidence**:
A recorded commit identity proving a task's completed lifecycle work was committed.
_Avoid_: commit flag, git marker

**Commit Result**:
The Addy Workflow Module that interprets final agent text as commit success, no-change success, unclear result, or commit identity.
_Avoid_: commit regex helper, task commit parser

**Task Commit Coordinator**:
The Addy Auto Mode Module that prompts for autonomous task commits, interprets commit results, records Commit Evidence, and chooses the post-commit continuation.
_Avoid_: commit helper, git glue

**Task Commit Prompt**:
The Task Commit Coordinator Module that owns auto commit instruction text and Repository Scope wording.
_Avoid_: commit string helper

**Task Commit Target**:
The Task Commit Coordinator Module that owns commit target resolution and Commit Evidence recording.
_Avoid_: commit target helper, commit record helper

**Auto Agent-End**:
The Addy Auto Mode Module that coordinates agent completion branches such as finish completion, review-fix continuation, task commit handoff, and fallback frontier dispatch while preserving branch-specific state cleanup and continuation side effects behind a small Interface.
_Avoid_: agent_end helper, completion callback glue

**Auto Agent Finish**:
The Auto Agent-End Module that recognizes finished/commit evidence and clears Addy Auto Mode when the finish branch is complete.
_Avoid_: finish text helper, completion branch

**Auto Review Fix Loop**:
The Auto Agent-End Module that sequences review finding fixes through fix-all, verify, and review without weakening the review gate.
_Avoid_: review fix branch, fix-all callback

**Provider Transport Retry**:
The Addy Auto Mode Module that detects provider transport failures at `agent_end`, preserves retryable workflow prompts as pending Auto Action Keys, and warns through the Runtime Shell.
_Avoid_: provider error helper, retry glue

**Agent-End Event**:
The Addy Workflow Module that interprets host `agent_end` payloads into latest assistant text and provider transport failure signals.
_Avoid_: message helper, event parsing glue

**Agent-End Review Stats**:
The Addy Workflow Module that attributes review issue counts from `agent_end` text to the active review stats target when the configured review agent matches.
_Avoid_: stats callback helper, review counter glue

**Agent-End Handler**:
The Addy Auto Mode Module that coordinates `agent_end` orchestration: review stats attribution, provider transport retry preservation, pending fresh continuation scheduling, task-commit continuation, and Auto Agent-End fallback continuation.
_Avoid_: agent_end callback, completion glue

**Workflow Host Events**:
The Runtime Shell Adapter Module that normalizes host command, input, tool, subagent, child-session, and stale-context event shapes before workflow decision Modules consume them.
_Avoid_: event helpers, payload glue

**Auto Lifecycle**:
The Addy Auto Mode Module that interprets Slice Plan progress into lifecycle completion, same-phase retry, recovery prompt, and next-frontier decisions.
_Avoid_: lifecycle helpers, retry text glue

**Auto Watchdog**:
The Addy Auto Mode Module that resumes pending fresh continuations, clears stale pending Auto Action Keys, dedupes watchdog dispatches, and triggers the next autonomous workflow prompt on safe lifecycle events.
_Avoid_: startup helper, retry timer glue

**Auto Prompt Dispatcher**:
The Addy Auto Mode Module that turns a selected workflow prompt into either current-session delivery or pending fresh-session continuation, persists the planned Workflow State, and applies delivery-failure handling.
_Avoid_: auto send helper, prompt dispatch glue

**Auto Workflow Orchestrator**:
The Addy Auto Mode Module that chooses and gates the next autonomous workflow prompt: refresh state, handle completed-plan continuation, run pending task commits, enforce same-phase retry limits, and pass selected prompts to Auto Prompt Dispatcher.
_Avoid_: next prompt helper, auto-loop control blob

**Auto Workflow Decision**:
The pure Addy Auto Mode Module that plans whether the next auto step is prompt dispatch, task commit, pause, or no active plan.
_Avoid_: orchestrator branch helper, auto switch

**Auto Loop Dispatch Port**:
The Composition Module seam used by Fresh Continuation, Task Commit Coordinator, Auto Agent-End, and Auto Watchdog to call the bound Auto Workflow Orchestrator without closure-based temporal coupling.
_Avoid_: mutable orchestrator wrapper, callback bag

**Session Start Handler**:
The Runtime Shell Adapter Module that initializes Addy workflow config and widgets, clears stale pending fresh continuations, resumes valid parent-session fresh work, and falls through to Auto Watchdog on session start.
_Avoid_: startup callback glue, session_start helper

**Workflow Stats**:
Counts Addy Workflow turns, verify runs, review runs, review findings, and archived task sessions for one or more Slice Plan tasks.
_Avoid_: metrics blob, counters

**Workflow Stats Report**:
The Workflow Stats Interface that turns normalized stats into text and markdown reports, including task aggregation and active/completed task identity.
_Avoid_: stats render helper, report formatter hidden in counters

**Workflow Stats Target**:
The Workflow Stats Module that selects the latest active task target and maps active stats records into shared task identity targets for delivery, retry, and commit coordination.
_Avoid_: presenter target helper, active task lookup

**Workflow Stats Presenter**:
The Runtime Shell Adapter Module that delivers Workflow Stats Reports through host custom messages, markdown renderers, notification fallbacks, and latest active stats targets.
_Avoid_: stats display helper, message renderer glue

**Workflow Widget Presenter**:
The Workflow Footer Module that renders Workflow State into the Addy Workflow widget, including the phase strip, artifact names, task footer, suite/slice/task progress, width truncation, and theme styling.
_Avoid_: tracker rendering helper, widget formatting buried in plan progress

**Command Router**:
The pure Addy Workflow Module that owns slash-command parsing, prompt command metadata, command-to-phase mapping, and workflow command classification.
_Avoid_: command helpers, string switches

**Command Registry**:
The Runtime Shell Adapter Module that registers Addy slash commands and wires each command to workflow Modules without making the monitor entrypoint own command-handler control flow.
_Avoid_: registerCommand block, command callback glue

**Event Registry**:
The Runtime Shell Adapter Module that registers host session, input, tool, subagent, and agent-end callbacks, normalizes event payloads, and delegates to workflow Modules.
_Avoid_: pi.on block, event callback glue

**Workflow Monitor Composition**:
The Runtime Shell Composition Root that wires Workflow Monitor Modules, their host adapters, and their few explicit dependency cycles before registering events and commands.
_Avoid_: monitor implementation, wiring blob

**Composition Adapter**:
The Runtime Shell Adapter Module that gives the Workflow Monitor Composition root named seams for host context reads, workflow config decisions, widget initialization, event recording, prompt opening, and reset operations.
_Avoid_: context cast helper, composition utilities

**Command Dispatch**:
The Addy Workflow Module that plans how a selected workflow prompt is delivered, including current-session delivery, pending fresh-session continuation, manual fresh-context notices, and dispatch-time Workflow State updates.
_Avoid_: prompt sender, command executor

**Manual Fresh Step**:
The Runtime Shell Adapter Module that applies before-every-step fresh-context config to manual workflow commands, shows the fresh-session notice, and dispatches the planned manual continuation prompt.
_Avoid_: fresh command helper, manual send glue

**Manual Frontier Guard**:
The Addy Workflow Module that refuses manual `/addy-build` when the Slice Plan frontier requires verify, review, finish, or task commit work first, then dispatches the required frontier prompt.
_Avoid_: build guard helper, manual redirect glue

**Input Handler**:
The Runtime Shell Adapter Module that handles host input events: consume matching pending fresh prompts, give manual Addy commands to the Manual Frontier Guard, and record normalized workflow input.
_Avoid_: input callback glue, manual input handler

**Prompt Template Module**:
The Addy Workflow Module that expands packaged slash-command prompts into dispatchable prompt text while preserving invocation identity and failing open to the original prompt when template expansion is unavailable.
_Avoid_: template helper, string expansion glue

**State Codec**:
The pure Addy Workflow Module that decodes, normalizes, and serializes Workflow State; validates persisted/session field shapes; and applies legacy state migrations before Runtime Shell storage uses it.
_Avoid_: state parser, JSON helper

## Relationships

- An **Addy Workflow** may run against one active **Slice Plan**.
- **Addy Auto Mode** uses **Auto Control** to preserve pending work across sessions and uses **Review Control** for review-fix safety.
- An **Addy Auto Runner Lock** belongs to one top-level Pi process and permits that process's **Fresh Continuation** sessions to continue dispatching the same **Addy Auto Mode** run.
- An **Addy Auto Runner Lock** governs Addy Auto Mode prompt dispatch only; non-owning sessions may still observe workflow state and **Workflow Stats**.
- An **Auto Stop Intent** may be recorded by a non-owning session, but only the owning **Addy Auto Runner Lock** process exits Addy Auto Mode and releases ownership before dispatching another prompt.
- **Addy Auto Command** is the command-level decision Interface for starting, stopping, and resuming Addy Auto Mode; **Command Registry** should delegate `/addy-auto` behavior to it instead of owning Auto Control policy.
- **Workflow State Control** keeps Auto Control and Review Control field preservation local so transition Modules do not copy or clear raw Workflow State fields by hand.
- **Auto Action Keys** give **Auto Control**, delayed prompt delivery, and watchdog retries a shared identity vocabulary for the same workflow action.
- **Fresh Continuation** uses **Auto Control** pending-fresh state, **Fresh Continuation Delivery**, and the **Runtime Shell** fresh-session Adapter to preserve autonomous work across context clearing.
- **Fresh Continuation State** keeps pure pending prompt matching and consumed-state planning outside **Fresh Continuation** delivery/session orchestration.
- **Review Findings** keeps review text interpretation local so **Review Control** and **Workflow Stats** share the same actionable-finding vocabulary.
- **Repository Scope** keeps cross-repo commit instructions grounded in **Slice Plan** metadata instead of fresh-session file-touch history.
- **Runtime Shell** isolates side effects from workflow decision Modules and provides timer primitives consumed by the **Timer Loop**.
- **Workflow Runtime Adapter** gives workflow Modules a narrow Interface for host append-entry, notification, and context-backed message delivery without exposing raw host context shape everywhere.
- **Timer Loop** hides retry scheduling mechanics; workflow policy such as pending action preservation, fresh continuation validity, and notification wording stays outside the Module.
- **Workflow Delivery** uses the **Runtime Shell**, **Timer Loop**, **Auto Action Keys**, and **Auto Recovery Prompt Policy** to make prompt delivery retryable without leaking host transport details into workflow decision Modules.
- **Workflow Dispatch Options** keeps auto/fresh delivery flags consistent across **Fresh Continuation**, **Auto Agent-End**, **Auto Watchdog**, **Session Start Handler**, and **Task Commit Coordinator**.
- **Auto Prompt Dispatcher** consumes **Command Dispatch** plans and delegates side effects to **Workflow Delivery** or **Fresh Continuation**, keeping current-session versus fresh-session prompt routing out of the monitor entrypoint.
- A **Slice Plan** contains one or more tasks with **Lifecycle Statuses**.
- **Slice Plan Progress** is the domain-level read Interface that re-exports **Slice Plan Action**, **Slice Plan Snapshot**, and **Slice Plan Evidence** facts for **Task Frontier**, **Task Closure**, next action, slice progress, and footer progress data; presentation Modules should render from this snapshot instead of recalculating plan traversal.
- **Slice Plan Series** keeps suite and numbered-slice heuristics local and consumes **Slice Plan Repository** for filesystem facts so **Slice Plan Progress**, **Auto Lifecycle**, and **Task Commit Coordinator** consume series facts instead of repeating path scanning rules.
- **Workflow Plan Continuation** owns the repeated Slice Plan handoff state shape so **Auto Lifecycle**, **Task Commit Coordinator**, and **Slice Plan Progress** do not duplicate stale task-context cleanup.
- **Workflow Task Summary** keeps best-effort async footer label generation outside **Workflow Handler** so workflow event handling stays synchronous and state-focused.
- A **Slice Plan** task should have a **Stable Task ID** written as an `addy-task-id` HTML comment.
- **Workflow Task Identity** keeps Stable Task ID and legacy fallback keying local so Commit Evidence, Auto Action Keys, Review Control, and Workflow Stats do not duplicate identity serialization rules.
- A task reaches **Task Closure** only when all **Lifecycle Statuses** are present and matching **Commit Evidence** exists.
- **Commit Evidence** should match by **Stable Task ID** when present, and fall back to legacy plan path, task index, and title identity when absent.
- **Commit Result** keeps commit/no-change/failure text interpretation local so **Task Commit Coordinator** and **Auto Agent-End** share one completion vocabulary.
- **Plan Task Reader** combines Slice Plan markdown reads with **Plan Task Resolution** so **Auto Lifecycle** and **Task Commit Coordinator** share the same task identity precedence without duplicating file parsing.
- **Task Commit Coordinator** uses **Task Commit Prompt** and **Task Commit Target** to create and verify **Commit Evidence** after a task reaches reviewed status, then either advances to the next **Task Frontier** or finishes the **Slice Plan**.
- **Auto Agent-End** consumes **Auto Agent Finish**, **Auto Review Fix Loop**, final agent text, and **Task Frontier** decisions to sequence completion-specific Addy Auto Mode branches without spreading finish cleanup, review-fix loop policy, task commit handoff, or fallback frontier dispatch across the monitor entrypoint.
- **Provider Transport Retry** consumes **Agent-End Event** failure signals and **Auto Action Keys** identity to preserve retryable Addy prompts without mixing transport recovery into agent completion branch selection.
- **Agent-End Event** keeps host `agent_end` payload parsing local so **Auto Agent-End**, **Workflow Stats**, and provider-failure recovery consume stable text/failure signals instead of raw message shapes.
- **Agent-End Review Stats** consumes **Agent-End Event** final text and **Review Findings** issue parsing so the monitor entrypoint does not mix review attribution with continuation control flow.
- **Agent-End Handler** sequences **Agent-End Review Stats**, **Provider Transport Retry**, **Fresh Continuation**, **Task Commit Coordinator**, and **Auto Agent-End** so the monitor entrypoint only catches host stale-context failures.
- **Workflow Host Events** keeps host payload normalization local so the monitor entrypoint routes normalized workflow facts instead of spreading command/input/tool/subagent shape checks across decision code.
- **Auto Lifecycle** keeps same-phase retry limits, plan-derived lifecycle completion, completed task detection, and next-frontier continuation local so the monitor entrypoint dispatches decisions instead of rebuilding Slice Plan policy inline.
- **Auto Workflow Orchestrator** consumes **Auto Workflow Decision**, **Auto Lifecycle**, **Task Commit Coordinator**, and **Auto Prompt Dispatcher** so next-prompt selection is isolated from host event and command registration.
- **Auto Loop Dispatch Port** keeps composition-time auto dispatch cycles local to **Workflow Monitor Composition** instead of exposing closure-based temporal coupling to workflow Modules.
- **Auto Watchdog** uses **Auto Action Keys**, pending **Fresh Continuation** state, and the Runtime Shell timer dedupe Interface to resume autonomous work without duplicating prompts across repeated lifecycle events.
- **Session Start Handler** keeps session boot policy separate from event registration, delegating resumed autonomous work to **Fresh Continuation** or **Auto Watchdog** after Runtime Shell initialization.
- The **Task Frontier** is derived from the first task that has not reached **Task Closure**.
- **Workflow Stats** are evidence about workflow activity; they can inform missing verify/review runs, but **Task Closure** still requires matching **Commit Evidence**.
- **Workflow Stats Report** keeps text/markdown reporting outside **Workflow Stats** so stats aggregation and mutation remain a decision Module; **Workflow Stats Presenter** keeps host message delivery outside both.
- **Workflow Stats Target** keeps active task target selection outside **Workflow Stats Presenter** so non-presentation Modules do not import UI delivery code for commit/retry identity.
- **Workflow Widget Presenter** keeps footer/widget rendering outside **Slice Plan Progress** so plan traversal remains a decision Module and widget formatting has its own test surface.
- **Command Router** gives workflow decision Modules a shared command vocabulary without spreading slash-command string switches across implementations.
- **Workflow Phases** keeps lifecycle phase constants outside **Command Router** and **Workflow Transitions** so command vocabulary and state transition policy depend on a neutral phase model.
- **Command Registry** is the host Adapter for slash-command registration; it delegates policy to **Manual Frontier Guard**, **Manual Fresh Step**, **Auto Watchdog**, **Fresh Continuation**, **Task Commit Coordinator**, and **Workflow Stats Presenter**.
- **Event Registry** is the host Adapter for `pi.on` registration; it delegates policy to **Session Start Handler**, **Input Handler**, **Agent-End Handler**, and normalized workflow event recording.
- **Workflow Monitor Composition** is the only intended dependency-wiring surface for the workflow monitor; `extensions/workflow-monitor.ts` is now a tiny package entrypoint delegating into it.
- **Composition Adapter** keeps host context casts and Runtime Shell helper calls out of **Workflow Monitor Composition**, making the composition root read as named dependency wiring rather than low-level host plumbing.
- **Prompt Template Module** consumes **Command Router** prompt metadata and owns packaged prompt file expansion so callers do not need to know prompt file locations, frontmatter stripping, argument substitution, or fail-open rules.
- **Command Dispatch** consumes **Command Router** vocabulary and selected workflow prompts, then returns dispatch plans that the **Runtime Shell** executes through host side effects.
- **Manual Fresh Step** consumes **Command Dispatch** manual plans and **Prompt Template Module** expansion so the command registration shell only decides whether a fresh-context manual step is configured.
- **Manual Frontier Guard** consumes the **Task Frontier** and **Task Commit Coordinator** to preserve lifecycle order when a user manually asks to build before required verification, review, finish, or commit work.
- **Input Handler** sequences pending fresh prompt consumption, **Manual Frontier Guard**, and workflow event recording so the monitor entrypoint does not own input event control flow.
- **State Codec** lets Runtime Shell persistence fail closed on invalid stored Workflow State while preserving explicit legacy migrations and in-memory normalization rules.

## Example dialogue

> **Dev:** "The Slice Plan shows Implemented, Verified, and Reviewed. Can auto mode move on?"
> **Domain expert:** "Only if there is Commit Evidence matching the Stable Task ID too; otherwise the task is still the Task Frontier."

## Flagged ambiguities

- "complete" can mean either all Lifecycle Statuses are checked or full **Task Closure**. Use **Task Closure** when Commit Evidence is required.
- Legacy Slice Plans may not contain **Stable Task IDs**. In that case, preserve the old plan path, task index, and title identity until a future migration is explicit.
