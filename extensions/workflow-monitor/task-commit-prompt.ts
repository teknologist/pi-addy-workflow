import { repositoryScopeForPlan } from './repository-scope.ts';
import type { WorkflowState } from './workflow-transitions.ts';

export function autoTaskCommitPrompt(
  state: WorkflowState,
  taskTitle?: string,
  baseCwd?: string,
): string {
  const task =
    taskTitle ??
    (state.currentTask && state.currentTask !== 'none'
      ? state.currentTask
      : 'the completed task');
  const plan = state.activePlan
    ? `Plan: ${state.activePlan}`
    : 'Plan: active Addy workflow plan';
  const repositoryScope = repositoryScopeForPlan(state.activePlan, baseCwd);
  const repositoryLine = repositoryScope
    ? `Repository scope: ${repositoryScope}`
    : 'Repository scope: current repository';
  return [
    '# Addy Auto Commit',
    '',
    'The current task has Implemented, Verified, and Reviewed checked. Commit the completed task work now, without asking the user for confirmation.',
    '',
    plan,
    repositoryLine,
    `Completed task: ${task}`,
    '',
    'Required steps:',
    '1. Do not try to invoke, search for, or print a `/commit` slash command; this auto prompt is the commit instruction.',
    '2. Use the full repository scope above instead of relying on fresh-session file-touch history.',
    '3. With the available shell/git tools, inspect each repo in scope (for example, `git -C <repo> status --short`).',
    '4. Before staging, run the project formatter for the changed scope when one is available, then run the project lint/format check for the changed scope. If formatting or lint changes files, include those changes; if lint/format still fails, fix safe scoped issues and rerun before committing.',
    '5. Stage all current changed files in each repo in scope, including tracked, unstaged, untracked, and plan checkbox changes. Do not leave relevant dirty worktree changes behind.',
    '6. Review the staged diff, then create a concise commit in each repo that has staged task changes.',
    '7. If there are no changes in any relevant repo, say `No changes to commit` and stop.',
    '8. Report each commit hash in the form `COMMIT: <hash>`.',
    '',
    'Do not call ask_user_question. Do not start the next task yourself; Addy auto will continue after this commit turn ends.',
  ].join('\n');
}
