import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
	advanceAfterRun,
	formatDuration,
	parseSchedule,
	prepareForResume,
	type Reminder,
	usage,
} from "./schedule.js";

const ENTRY_TYPE = "session-reminders-state";
const MAX_TIMEOUT_MS = 2_147_000_000;

type ReminderSnapshot = {
	version: 1;
	reminders: Reminder[];
};

function createId(existingIds: Set<string>): string {
	let candidate: string;
	do {
		candidate = Math.random().toString(36).slice(2, 8);
	} while (!candidate || existingIds.has(candidate));
	return candidate;
}

function latestSnapshot(ctx: ExtensionContext): Reminder[] {
	let reminders: Reminder[] = [];
	for (const entry of ctx.sessionManager.getEntries()) {
		if (entry.type !== "custom" || entry.customType !== ENTRY_TYPE) continue;
		const data = entry.data as ReminderSnapshot | undefined;
		if (data?.version === 1 && Array.isArray(data.reminders)) {
			reminders = data.reminders;
		}
	}
	return reminders;
}

function describeReminder(reminder: Reminder, nowMs: number): string {
	const ending = reminder.endAt
		? ` · ends in ${formatDuration(reminder.endAt - nowMs)}`
		: reminder.kind === "interval"
			? " · no end"
			: "";
	return `- ${reminder.id} · ${reminder.kind} · next in ${formatDuration(reminder.nextRunAt - nowMs)}${ending} · runs ${reminder.runCount}\n  ${reminder.prompt}`;
}

export default function sessionReminders(pi: ExtensionAPI) {
	let reminders: Reminder[] = [];
	let currentCtx: ExtensionContext | undefined;
	const timers = new Map<string, NodeJS.Timeout>();
	let uiTicker: NodeJS.Timeout | undefined;

	function persist() {
		pi.appendEntry(ENTRY_TYPE, {
			version: 1,
			reminders,
		} satisfies ReminderSnapshot);
	}

	function updateUi(ctx = currentCtx) {
		if (!ctx) return;
		const active = reminders.filter((reminder) => reminder.active);
		if (active.length === 0) {
			ctx.ui.setStatus("session-reminders", "");
			ctx.ui.setWidget("session-reminders", []);
			return;
		}

		const currentTime = Date.now();
		const next = active.reduce((first, candidate) =>
			first.nextRunAt < candidate.nextRunAt ? first : candidate,
		);
		const remaining = formatDuration(next.nextRunAt - currentTime);
		ctx.ui.setStatus(
			"session-reminders",
			`⏱ ${active.length} reminder${active.length === 1 ? "" : "s"} · next ${remaining}`,
		);
		ctx.ui.setWidget(
			"session-reminders",
			active
				.slice(0, 5)
				.map(
					(reminder) =>
						`⏱ ${reminder.id} in ${formatDuration(reminder.nextRunAt - currentTime)}: ${reminder.prompt.slice(0, 90)}`,
				),
		);
	}

	function clearTimers() {
		for (const timer of timers.values()) clearTimeout(timer);
		timers.clear();
		if (uiTicker) clearInterval(uiTicker);
		uiTicker = undefined;
	}

	function scheduleOne(reminder: Reminder) {
		const delay = Math.max(0, reminder.nextRunAt - Date.now());
		const timer = setTimeout(() => {
			timers.delete(reminder.id);
			if (reminder.nextRunAt > Date.now()) scheduleOne(reminder);
			else fire(reminder.id);
		}, Math.min(delay, MAX_TIMEOUT_MS));
		timers.set(reminder.id, timer);
	}

	function scheduleAll() {
		clearTimers();
		for (const reminder of reminders.filter((item) => item.active)) {
			scheduleOne(reminder);
		}
		if (reminders.some((reminder) => reminder.active)) {
			uiTicker = setInterval(() => updateUi(), 1_000);
		}
		updateUi();
	}

	function deactivate(reminder: Reminder) {
		reminder.active = false;
		persist();
		updateUi();
	}

	function fire(reminderId: string) {
		const index = reminders.findIndex(
			(reminder) => reminder.id === reminderId && reminder.active,
		);
		if (index < 0) return;

		const reminder = reminders[index];
		const firedAt = Date.now();
		if (
			reminder.endAt !== undefined &&
			reminder.nextRunAt > reminder.endAt
		) {
			deactivate(reminder);
			return;
		}

		try {
			pi.sendUserMessage(
				`[session-reminder ${reminder.id}, run ${reminder.runCount + 1}]\n${reminder.prompt}`,
				{ deliverAs: "followUp" },
			);
		} catch {
			reminder.nextRunAt = firedAt + 30_000;
			if (
				reminder.endAt !== undefined &&
				reminder.nextRunAt > reminder.endAt
			) {
				deactivate(reminder);
				return;
			}
			persist();
			scheduleOne(reminder);
			updateUi();
			return;
		}

		reminders[index] = advanceAfterRun(reminder, firedAt);
		if (reminders[index].active) scheduleOne(reminders[index]);
		persist();
		updateUi();
	}

	function createReminder(
		expression: string,
	):
		| { reminder: Reminder; error?: never }
		| { reminder?: never; error: string } {
		const parsed = parseSchedule(expression);
		if (parsed.error !== undefined) return { error: parsed.error };
		const reminder: Reminder = {
			id: createId(new Set(reminders.map((item) => item.id))),
			...parsed.reminder,
		};
		reminders.push(reminder);
		persist();
		scheduleAll();
		return { reminder };
	}

	function cancelReminder(target: string): number {
		let count = 0;
		for (const reminder of reminders) {
			if (target !== "all" && reminder.id !== target) continue;
			reminder.active = false;
			const timer = timers.get(reminder.id);
			if (timer) clearTimeout(timer);
			timers.delete(reminder.id);
			count += 1;
		}
		persist();
		scheduleAll();
		return count;
	}

	pi.on("session_start", async (_event, ctx) => {
		currentCtx = ctx;
		const currentTime = Date.now();
		reminders = latestSnapshot(ctx)
			.map((reminder) => prepareForResume(reminder, currentTime))
			.filter((reminder) => reminder.active);
		scheduleAll();
	});

	pi.on("session_shutdown", async () => {
		clearTimers();
		currentCtx = undefined;
	});

	pi.registerCommand("remind", {
		description:
			"Session reminder: +10m, every 30m, every 30m for 6h, or every 30m until 18:00",
		handler: async (args, ctx) => {
			currentCtx = ctx;
			const result = createReminder(args);
			if (result.error || !result.reminder) {
				ctx.ui.notify(result.error ?? usage(), "warning");
				return;
			}
			ctx.ui.notify(
				`Reminder ${result.reminder.id} scheduled: next in ${formatDuration(result.reminder.nextRunAt - Date.now())}`,
				"info",
			);
		},
	});

	pi.registerCommand("reminders", {
		description: "List active session reminders",
		handler: async (_args, ctx) => {
			currentCtx = ctx;
			const active = reminders.filter((reminder) => reminder.active);
			if (active.length === 0) {
				ctx.ui.notify("No active reminders", "info");
				return;
			}
			const currentTime = Date.now();
			pi.sendMessage({
				customType: "session-reminders-list",
				display: true,
				content: active
					.map((reminder) => describeReminder(reminder, currentTime))
					.join("\n"),
			});
		},
	});

	pi.registerCommand("remind-cancel", {
		description: "Cancel a reminder by id, or all reminders",
		handler: async (args, ctx) => {
			currentCtx = ctx;
			const target = args.trim();
			if (!target) {
				ctx.ui.notify("Usage: /remind-cancel <id|all>", "warning");
				return;
			}
			const count = cancelReminder(target);
			ctx.ui.notify(
				count ? `Cancelled ${count} reminder(s)` : `No reminder matched ${target}`,
				count ? "info" : "warning",
			);
		},
	});

	pi.registerTool({
		name: "session_reminder_create",
		label: "Create session reminder",
		description:
			"Create a one-shot or recurring reminder bound to this Pi session. Recurring reminders are infinite unless 'for' or 'until' is supplied.",
		parameters: Type.Object({
			schedule: Type.String({
				description:
					"Schedule plus prompt: '+10m Check CI', 'every 30m Check chats', 'every 30m for 4h Check chats', or 'every 30m until 18:00 Check chats'",
			}),
		}),
		promptSnippet:
			"Create session-bound one-shot or recurring reminders, optionally with an end time",
		promptGuidelines: [
			"Use session_reminder_create when the user asks for a reminder, timer, recurring scan, or scheduled follow-up.",
		],
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			currentCtx = ctx;
			const result = createReminder(params.schedule);
			if (result.error || !result.reminder) {
				return {
					content: [{ type: "text", text: result.error ?? usage() }],
					details: { ok: false, error: result.error },
				};
			}
			return {
				content: [
					{
						type: "text",
						text: `Reminder ${result.reminder.id} scheduled; next run in ${formatDuration(result.reminder.nextRunAt - Date.now())}.`,
					},
				],
				details: { ok: true, reminder: result.reminder },
			};
		},
	});

	pi.registerTool({
		name: "session_reminder_list",
		label: "List session reminders",
		description: "List active reminders bound to this Pi session.",
		parameters: Type.Object({}),
		promptSnippet: "List active session-bound reminders",
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			currentCtx = ctx;
			const active = reminders.filter((reminder) => reminder.active);
			const currentTime = Date.now();
			return {
				content: [
					{
						type: "text",
						text: active.length
							? active
									.map((reminder) =>
										describeReminder(reminder, currentTime),
									)
									.join("\n")
							: "No active reminders",
					},
				],
				details: { reminders: active },
			};
		},
	});

	pi.registerTool({
		name: "session_reminder_cancel",
		label: "Cancel session reminder",
		description: "Cancel a session reminder by id, or all active reminders.",
		parameters: Type.Object({
			id: Type.String({ description: "Reminder id, or 'all'" }),
		}),
		promptSnippet: "Cancel active session-bound reminders",
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			currentCtx = ctx;
			const count = cancelReminder(params.id.trim());
			return {
				content: [
					{
						type: "text",
						text: count
							? `Cancelled ${count} reminder(s).`
							: `No reminder matched ${params.id}.`,
					},
				],
				details: { cancelled: count },
			};
		},
	});
}
