export const WORKFLOW_PHASES = ["define", "plan", "build", "simplify", "verify", "review", "ship"] as const;
export const ENFORCED_WORKFLOW_PHASES = ["build", "verify", "review"] as const;

export type WorkflowPhase = (typeof WORKFLOW_PHASES)[number];
export type PhaseStatus = "pending" | "active" | "complete";

export type WorkflowState = {
  current?: WorkflowPhase;
  phases: Record<WorkflowPhase, PhaseStatus>;
  warnings: string[];
  activeSpec?: string;
  activePlan?: string;
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

function enforcedPhaseIndex(phase: WorkflowPhase): number {
  return (ENFORCED_WORKFLOW_PHASES as readonly WorkflowPhase[]).indexOf(phase);
}

function firstSkippedEnforcedPhase(state: WorkflowState, target: WorkflowPhase, next: WorkflowState): WorkflowPhase | undefined {
  const targetIndex = enforcedPhaseIndex(target);
  if (targetIndex === -1) return undefined;

  return (ENFORCED_WORKFLOW_PHASES as readonly WorkflowPhase[]).find((phase) => {
    const index = enforcedPhaseIndex(phase);
    return index < targetIndex && state.phases[phase] !== "complete" && next.phases[phase] !== "complete";
  });
}

function matchesAny(path: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(path));
}

function fileWriteTargetPhase(path: string, current?: WorkflowPhase): WorkflowPhase | undefined {
  const normalized = path.replace(/\\/g, "/");

  if (matchesAny(normalized, [/(^|\/)(SPEC|spec)\.md$/, /(^|\/)docs\/specs\//, /(^|\/)docs\/prd\//])) return "define";
  if (matchesAny(normalized, [/(^|\/)docs\/plans\//])) return "plan";
  if (matchesAny(normalized, [/(^|\/)[^/]+\.(test|spec)\.[^/]+$/, /^tests\//])) {
    return current && phaseIndex(current) > phaseIndex("verify") ? undefined : "verify";
  }
  if (matchesAny(normalized, [/^CHANGELOG/, /^RELEASE/, /^docs\/releases\//, /^docs\/deploy\//])) return "ship";
  if (!matchesAny(normalized, [/^tests\//, /^docs\//, /^tasks\//, /^agents\//, /^skills\//, /^prompts\//, /^extensions\//])) {
    return current && phaseIndex(current) > phaseIndex("build") ? undefined : "build";
  }

  return undefined;
}

function artifactFromText(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const parts = text.trim().split(/\s+/);
  if (!parts[0]?.startsWith("/addy-")) return undefined;
  if (parts[0] === "/addy-workflow-next") return parts.slice(2).join(" ") || undefined;
  return parts.slice(1).join(" ") || undefined;
}

function applyActiveArtifact(state: WorkflowState, event: WorkflowEvent, target: WorkflowPhase): WorkflowState {
  const artifact = event.artifact ?? artifactFromText(event.text);
  if (!artifact) return state;

  const normalized = artifact.replace(/\\/g, "/");
  const targetFromArtifact = fileWriteTargetPhase(normalized, state.current);

  if (event.source === "file-write") {
    if (targetFromArtifact === "define") return { ...state, activeSpec: artifact };
    if (targetFromArtifact === "plan") return { ...state, activePlan: artifact };
    return state;
  }

  if (targetFromArtifact === "plan") return { ...state, activePlan: artifact };
  if (targetFromArtifact === "define" || target === "define" || target === "plan") return { ...state, activeSpec: artifact };
  if (phaseIndex(target) > phaseIndex("plan")) return { ...state, activePlan: artifact };

  return state;
}

export function resolveTargetPhase(event: WorkflowEvent, current?: WorkflowPhase): WorkflowPhase | undefined {
  const text = event.text ?? "";

  if (event.source === "user-input" || event.source === "command") {
    const workflowNext = text.match(/\/addy-workflow-next\s+(define|plan|build|simplify|verify|review|ship)\b/);
    if (workflowNext) return workflowNext[1] as WorkflowPhase;
    if (text.includes("/addy-code-simplify")) return "simplify";
    if (text.includes("/addy-define")) return "define";
    if (text.includes("/addy-plan")) return "plan";
    if (text.includes("/addy-build")) return "build";
    if (text.includes("/addy-verify")) return "verify";
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
    return applyActiveArtifact({
      ...state,
      warnings: [],
      lastTrigger: event.text ?? event.command ?? event.agentName,
      lastArtifact: event.artifact ?? state.lastArtifact,
      testStatus: target === "verify" && event.source === "tool-result" ? (event.success === false ? "failed" : "detected") : state.testStatus,
    }, event, target);
  }

  const next = createInitialWorkflowState();
  const warnings: string[] = [];
  const targetIndex = phaseIndex(target);

  if (current) {
    for (const phase of WORKFLOW_PHASES) {
      const index = phaseIndex(phase);
      if (index < targetIndex && state.phases[phase] === "complete") next.phases[phase] = "complete";
    }

    if (phaseIndex(target) > phaseIndex(current)) next.phases[current] = "complete";
  }

  const firstSkipped = firstSkippedEnforcedPhase(state, target, next);
  if (firstSkipped) warnings.push(`Workflow warning: ${target} started before ${firstSkipped}.`);

  next.current = target;
  next.phases[target] = "active";
  next.warnings = warnings;
  next.activeSpec = state.activeSpec;
  next.activePlan = state.activePlan;
  next.lastTrigger = event.text ?? event.command ?? event.agentName;
  next.lastArtifact = event.artifact;
  next.testStatus = target === "verify" && event.source === "tool-result" ? (event.success === false ? "failed" : "detected") : state.testStatus;

  return applyActiveArtifact(next, event, target);
}
