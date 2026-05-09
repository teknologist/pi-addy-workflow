export const WORKFLOW_PHASES = ["define", "plan", "build", "verify", "review", "ship"] as const;

export type WorkflowPhase = (typeof WORKFLOW_PHASES)[number];
export type PhaseStatus = "pending" | "active" | "complete";

export type WorkflowState = {
  current?: WorkflowPhase;
  phases: Record<WorkflowPhase, PhaseStatus>;
  warnings: string[];
  lastTrigger?: string;
  lastArtifact?: string;
  testStatus?: "detected" | "passed" | "failed";
};

export type WorkflowEvent = {
  source: "user-input" | "file-write" | "tool-result" | "subagent-call" | "command";
  text?: string;
  command?: string;
  agentName?: string;
  success?: boolean;
  artifact?: string;
};

export function createInitialWorkflowState(): WorkflowState {
  return {
    phases: Object.fromEntries(WORKFLOW_PHASES.map((phase) => [phase, "pending"])) as Record<WorkflowPhase, PhaseStatus>,
    warnings: [],
  };
}

export function phaseIndex(phase: WorkflowPhase): number {
  return WORKFLOW_PHASES.indexOf(phase);
}

function matchesAny(path: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(path));
}

function fileWriteTargetPhase(path: string, current?: WorkflowPhase): WorkflowPhase | undefined {
  const normalized = path.replace(/\\/g, "/");

  if (matchesAny(normalized, [/^(SPEC|spec)\.md$/, /^docs\/specs\//, /^docs\/prd\//])) return "define";
  if (matchesAny(normalized, [/^tasks\/(plan|todo)\.md$/, /^docs\/plans\//])) return "plan";
  if (matchesAny(normalized, [/(^|\/)[^/]+\.(test|spec)\.[^/]+$/, /^tests\//])) {
    return current && phaseIndex(current) > phaseIndex("verify") ? undefined : "verify";
  }
  if (matchesAny(normalized, [/^CHANGELOG/, /^RELEASE/, /^docs\/releases\//, /^docs\/deploy\//])) return "ship";
  if (!matchesAny(normalized, [/^tests\//, /^docs\//, /^tasks\//, /^agents\//, /^skills\//, /^prompts\//, /^extensions\//])) {
    return current && phaseIndex(current) > phaseIndex("build") ? undefined : "build";
  }

  return undefined;
}

export function resolveTargetPhase(event: WorkflowEvent, current?: WorkflowPhase): WorkflowPhase | undefined {
  const text = event.text ?? "";

  if (event.source === "user-input" || event.source === "command") {
    const workflowNext = text.match(/\/addy-workflow-next\s+(define|plan|build|verify|review|ship)\b/);
    if (workflowNext) return workflowNext[1] as WorkflowPhase;
    if (text.includes("/addy-code-simplify")) return undefined;
    if (text.includes("/addy-spec")) return "define";
    if (text.includes("/addy-plan")) return "plan";
    if (text.includes("/addy-build")) return "build";
    if (text.includes("/addy-test")) return "verify";
    if (text.includes("/addy-review")) return "review";
    if (text.includes("/addy-ship")) return "ship";
  }

  if (event.source === "file-write" && event.artifact) return fileWriteTargetPhase(event.artifact, current);

  if (event.source === "tool-result" && event.success !== false) {
    const command = event.command ?? text;
    if (/\b(test|vitest|jest|node --test|npm test|pnpm test)\b/i.test(command)) return "verify";
  }

  if (event.source === "subagent-call") {
    if (event.agentName === "addy-reviewer" || event.agentName === "addy-spec-reviewer") return "review";
  }

  return undefined;
}

export function transitionWorkflow(state: WorkflowState, event: WorkflowEvent): WorkflowState {
  const target = resolveTargetPhase(event, state.current);
  if (!target) return state;

  const current = state.current;
  if (current === target) {
    return {
      ...state,
      warnings: [],
      lastTrigger: event.text ?? event.command ?? event.agentName,
      lastArtifact: event.artifact ?? state.lastArtifact,
      testStatus: target === "verify" && event.source === "tool-result" ? (event.success === false ? "failed" : "detected") : state.testStatus,
    };
  }

  const next = createInitialWorkflowState();
  const warnings: string[] = [];
  const targetIndex = phaseIndex(target);

  if (current && phaseIndex(target) > phaseIndex(current)) {
    for (const phase of WORKFLOW_PHASES) {
      const index = phaseIndex(phase);
      if (index < targetIndex && state.phases[phase] === "complete") next.phases[phase] = "complete";
    }
    next.phases[current] = "complete";

    const firstSkipped = WORKFLOW_PHASES.find((phase) => phaseIndex(phase) < targetIndex && next.phases[phase] === "pending");
    if (firstSkipped) warnings.push(`Workflow warning: ${target} started before ${firstSkipped}.`);
  } else if (!current) {
    const firstMissing = WORKFLOW_PHASES.find((phase) => phaseIndex(phase) < targetIndex);
    if (firstMissing) warnings.push(`Workflow warning: ${target} started before ${firstMissing}.`);
  }

  next.current = target;
  next.phases[target] = "active";
  next.warnings = warnings;
  next.lastTrigger = event.text ?? event.command ?? event.agentName;
  next.lastArtifact = event.artifact;
  next.testStatus = target === "verify" && event.source === "tool-result" ? (event.success === false ? "failed" : "detected") : state.testStatus;

  return next;
}
