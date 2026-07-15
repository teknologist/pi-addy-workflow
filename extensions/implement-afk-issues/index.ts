import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const MAX_CYCLES = 25;
const DEFAULT_RESERVE_TOKENS = 16_384;
const PROMPT_PATH = join(process.env.HOME ?? "", ".pi", "agent", "prompts", "implement-from-issues.md");
const SETTINGS_PATH = join(process.env.HOME ?? "", ".pi", "agent", "settings.json");
const STATE_TYPE = "implement-afk-issues-state";

type AfkMarker =
	| { type: "CONTINUE"; issue: string; next: string; raw: string }
	| { type: "RUN-COMPLETE"; remaining: 0; evidence: string; raw: string }
	| { type: "LEGAL-STOP"; condition: number; needs: string; raw: string };

type AfkState = {
	active: boolean;
	cycleCount: number;
	maxCycles: number;
	args: string;
	lastMarker: AfkMarker | null;
	startedAt: string | null;
};

const initialState = (): AfkState => ({
	active: false,
	cycleCount: 0,
	maxCycles: MAX_CYCLES,
	args: "",
	lastMarker: null,
	startedAt: null,
});

let state: AfkState = initialState();
let rewaking = false;
let compacting = false;
let pendingResumeAfterCompact: { marker: AfkMarker | null } | null = null;
let contextErrorRetries = 0;

function isAfkState(value: any): value is AfkState {
	return Boolean(
		value &&
			typeof value.active === "boolean" &&
			typeof value.cycleCount === "number" &&
			typeof value.maxCycles === "number" &&
			typeof value.args === "string",
	);
}

export function parseAfkMarker(text: string): AfkMarker | null {
	const finalLine = text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean)
		.at(-1);
	if (!finalLine?.startsWith("AFK-LOOP: ")) return null;

	let match = /^AFK-LOOP: CONTINUE issue=(\S+) next="([^"]+)"$/.exec(finalLine);
	if (match) return { type: "CONTINUE", issue: match[1], next: match[2], raw: finalLine };

	match = /^AFK-LOOP: RUN-COMPLETE remaining=0 evidence="([^"]+)"$/.exec(finalLine);
	if (match) return { type: "RUN-COMPLETE", remaining: 0, evidence: match[1], raw: finalLine };

	match = /^AFK-LOOP: LEGAL-STOP condition=([1-8]) needs="([^"]+)"$/.exec(finalLine);
	if (match) return { type: "LEGAL-STOP", condition: Number(match[1]), needs: match[2], raw: finalLine };

	return null;
}

export function reduceAfkState(current: AfkState, marker: AfkMarker | null): AfkState {
	if (!current.active) return current;
	if (marker?.type === "RUN-COMPLETE" || marker?.type === "LEGAL-STOP") {
		return { ...current, active: false, lastMarker: marker };
	}
	const cycleCount = current.cycleCount + 1;
	return { ...current, active: cycleCount < current.maxCycles, cycleCount, lastMarker: marker };
}

function assistantText(message: any): string {
	const content = message?.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part) => part?.type === "text" && typeof part.text === "string")
		.map((part) => part.text)
		.join("\n");
}

function lastAssistantMessage(messages: any[]): any | undefined {
	return [...messages].reverse().find((m) => m?.role === "assistant");
}

function isContextLengthError(message: any): boolean {
	if (message?.stopReason !== "error") return false;
	const diagnostics = Array.isArray(message.diagnostics) ? message.diagnostics : [];
	const text = [
		message.errorMessage,
		...diagnostics.map((diagnostic: any) => diagnostic?.error?.message),
	].filter(Boolean).join("\n");
	return /context_length_exceeded|exceeds the context window/i.test(text);
}

function reserveTokens(): number {
	try {
		const parsed = JSON.parse(readFileSync(SETTINGS_PATH, "utf8"));
		const value = parsed?.compaction?.reserveTokens;
		return typeof value === "number" && value > 0 ? value : DEFAULT_RESERVE_TOKENS;
	} catch {
		return DEFAULT_RESERVE_TOKENS;
	}
}

function shouldCompactBeforeResume(ctx: any): boolean {
	if (typeof ctx.compact !== "function") return false;
	const tokens = ctx.getContextUsage?.()?.tokens;
	const contextWindow = ctx.model?.contextWindow;
	return typeof tokens === "number" && typeof contextWindow === "number" && tokens > contextWindow - reserveTokens();
}

function markerSummary(marker: AfkMarker | null): string {
	if (!marker) return "missing or malformed AFK-LOOP marker";
	if (marker.type === "CONTINUE") return `CONTINUE for issue ${marker.issue}: ${marker.next}`;
	if (marker.type === "RUN-COMPLETE") return `RUN-COMPLETE: ${marker.evidence}`;
	return `LEGAL-STOP condition ${marker.condition}: ${marker.needs}`;
}

function resumeMessage(marker: AfkMarker | null): string {
	return `Continue the active /implement-from-issues run.
The previous turn ended with ${markerSummary(marker)}.
${marker ? "" : "The marker was missing/malformed, which violated the AFK-LOOP contract.\n"}Do not summarize or wait if the next step is knowable.
Take the next concrete action now.
End this turn with exactly one AFK-LOOP marker line.`;
}

function completeNotice(marker: AfkMarker): string {
	if (marker.type === "RUN-COMPLETE") return `AFK issue run complete. ${marker.evidence}`;
	if (marker.type === "LEGAL-STOP") return `AFK issue run stopped legally (condition ${marker.condition}). Needs: ${marker.needs}`;
	return "";
}

export default function (pi: ExtensionAPI) {
	function persistState(): void {
		pi.appendEntry(STATE_TYPE, state);
	}

	function sendResume(marker: AfkMarker | null): void {
		rewaking = true;
		try {
			pi.sendMessage(
				{ customType: "afk-issues-resume", content: resumeMessage(marker), display: false },
				{ triggerTurn: true, deliverAs: "followUp" },
			);
		} finally {
			rewaking = false;
		}
	}

	function flushPendingResume(ctx: any): void {
		const pending = pendingResumeAfterCompact;
		pendingResumeAfterCompact = null;
		compacting = false;
		if (!state.active || !pending) return;
		ctx.ui.setStatus("afk-issues", `AFK issues ${state.cycleCount}/${state.maxCycles}`);
		sendResume(pending.marker);
	}

	function stopAfterCompactionError(ctx: any, error: unknown): void {
		const message = error instanceof Error ? error.message : String(error);
		if (message === "Already compacted") {
			flushPendingResume(ctx);
			return;
		}

		pendingResumeAfterCompact = null;
		compacting = false;
		state = { ...state, active: false };
		persistState();
		ctx.ui.setStatus("afk-issues", "AFK issues: error");
		ctx.ui.notify(`AFK issue run stopped: compaction failed before resume: ${message}`, "error");
	}

	function compactThenResume(ctx: any, marker: AfkMarker | null): boolean {
		if (typeof ctx.compact !== "function") return false;
		pendingResumeAfterCompact = { marker };
		ctx.ui.setStatus("afk-issues", `AFK issues ${state.cycleCount}/${state.maxCycles}: compacting`);
		if (compacting) return true;

		compacting = true;
		try {
			const maybePromise = ctx.compact({
				customInstructions: "Preserve the active /implement-from-issues AFK state and next concrete step.",
				onComplete: () => flushPendingResume(ctx),
				onError: (error: unknown) => stopAfterCompactionError(ctx, error),
			});
			if (maybePromise && typeof maybePromise.then === "function") {
				void maybePromise.then(undefined, (error: unknown) => stopAfterCompactionError(ctx, error));
			}
		} catch (error) {
			stopAfterCompactionError(ctx, error);
		}
		return true;
	}

	function resumeOrCompact(ctx: any, marker: AfkMarker | null): void {
		if (compacting || shouldCompactBeforeResume(ctx)) {
			if (compactThenResume(ctx, marker)) return;
		}
		sendResume(marker);
	}

	pi.on("session_start", async (_event, ctx) => {
		compacting = false;
		pendingResumeAfterCompact = null;
		contextErrorRetries = 0;
		const entries = ctx.sessionManager.getEntries();
		const saved = [...entries].reverse().find((entry: any) => entry.type === "custom" && entry.customType === STATE_TYPE);
		state = isAfkState((saved as any)?.data) ? (saved as any).data : initialState();
		ctx.ui.setStatus("afk-issues", state.active ? `AFK issues ${state.cycleCount}/${state.maxCycles}` : "AFK issues: idle");
	});

	pi.registerCommand("implement-afk-issues", {
		description: "Run /implement-from-issues under AFK supervision.",
		handler: async (args, ctx) => {
			if (state.active) {
				ctx.ui.notify("/implement-afk-issues is already active", "warning");
				return;
			}
			if (!existsSync(PROMPT_PATH)) {
				ctx.ui.notify(`Cannot start AFK run: missing ${PROMPT_PATH}`, "error");
				return;
			}

			state = {
				active: true,
				cycleCount: 0,
				maxCycles: MAX_CYCLES,
				args: args.trim(),
				lastMarker: null,
				startedAt: new Date().toISOString(),
			};
			ctx.ui.setStatus("afk-issues", `AFK issues 0/${state.maxCycles}`);
			persistState();
			ctx.ui.notify(`Starting /implement-from-issues ${state.args}`.trim(), "info");
			pi.sendUserMessage(`/implement-from-issues ${state.args}`.trim());
		},
	});

	pi.on("agent_end", async (event, ctx) => {
		if (!state.active || rewaking) return;

		const messages = event.messages as any[];
		const assistantMessage = lastAssistantMessage(messages);
		const text = assistantText(assistantMessage);
		if (!text.trim()) {
			if (isContextLengthError(assistantMessage) && contextErrorRetries < 1 && compactThenResume(ctx, state.lastMarker)) {
				contextErrorRetries++;
				return;
			}
			state = { ...state, active: false };
			persistState();
			ctx.ui.setStatus("afk-issues", "AFK issues: error");
			ctx.ui.notify("AFK issue run stopped: could not read assistant message", "error");
			return;
		}
		contextErrorRetries = 0;

		const marker = parseAfkMarker(text);
		const nextState = reduceAfkState(state, marker);
		const hitCap = state.active && !nextState.active && marker?.type !== "RUN-COMPLETE" && marker?.type !== "LEGAL-STOP";
		state = nextState;
		persistState();

		if (marker?.type === "RUN-COMPLETE" || marker?.type === "LEGAL-STOP") {
			ctx.ui.setStatus("afk-issues", "AFK issues: idle");
			pi.sendMessage({ customType: "afk-issues", content: completeNotice(marker), display: true }, { triggerTurn: false });
			return;
		}

		if (hitCap) {
			ctx.ui.setStatus("afk-issues", "AFK issues: paused");
			pi.sendMessage(
				{
					customType: "afk-issues",
					content: `AFK issue run paused after ${state.maxCycles} cycles. Last state: ${markerSummary(marker)}. Resume with /implement-afk-issues ${state.args}`.trim(),
					display: true,
				},
				{ triggerTurn: false },
			);
			return;
		}

		ctx.ui.setStatus("afk-issues", `AFK issues ${state.cycleCount}/${state.maxCycles}`);
		resumeOrCompact(ctx, marker);
	});

	pi.on("session_compact", async (_event, ctx) => {
		flushPendingResume(ctx);
	});

	pi.on("session_shutdown", () => {
		state = initialState();
		rewaking = false;
		compacting = false;
		pendingResumeAfterCompact = null;
		contextErrorRetries = 0;
	});
}
