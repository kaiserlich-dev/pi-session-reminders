export type ReminderKind = "once" | "interval";

export type Reminder = {
	id: string;
	kind: ReminderKind;
	prompt: string;
	createdAt: number;
	nextRunAt: number;
	intervalMs?: number;
	endAt?: number;
	runCount: number;
	lastRunAt?: number;
	active: boolean;
};

export type ParsedSchedule =
	| { reminder: Omit<Reminder, "id">; error?: never }
	| { reminder?: never; error: string };

export const MIN_DURATION_MS = 1_000;

export function parseDuration(input: string): number | null {
	const match = input
		.trim()
		.match(
			/^(\d+(?:\.\d+)?)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)$/i,
		);
	if (!match) return null;

	const amount = Number(match[1]);
	if (!Number.isFinite(amount) || amount <= 0) return null;

	const unit = match[2].toLowerCase();
	let multiplier = 0;
	if (unit.startsWith("s")) multiplier = 1_000;
	else if (unit.startsWith("m")) multiplier = 60_000;
	else if (unit.startsWith("h")) multiplier = 3_600_000;
	else if (unit.startsWith("d")) multiplier = 86_400_000;

	const duration = amount * multiplier;
	if (
		!Number.isFinite(duration) ||
		duration < MIN_DURATION_MS ||
		duration > Number.MAX_SAFE_INTEGER
	) {
		return null;
	}
	return duration;
}

export function formatDuration(ms: number): string {
	const totalSeconds = Math.ceil(Math.max(0, ms) / 1_000);
	if (totalSeconds < 60) return `${totalSeconds}s`;
	if (totalSeconds < 3_600) {
		const minutes = Math.floor(totalSeconds / 60);
		const seconds = totalSeconds % 60;
		return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
	}
	if (totalSeconds < 86_400) {
		const hours = Math.floor(totalSeconds / 3_600);
		const minutes = Math.floor((totalSeconds % 3_600) / 60);
		return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
	}
	return `${Math.round(ms / 86_400_000)}d`;
}

function parseEndAt(input: string, nowMs: number): number | null {
	const localTime = input.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
	if (localTime) {
		const hours = Number(localTime[1]);
		const minutes = Number(localTime[2]);
		const seconds = Number(localTime[3] ?? 0);
		if (hours > 23 || minutes > 59 || seconds > 59) return null;

		const end = new Date(nowMs);
		end.setHours(hours, minutes, seconds, 0);
		return end.getTime();
	}

	const parsed = Date.parse(input);
	return Number.isFinite(parsed) ? parsed : null;
}

function intervalReminder(
	intervalMs: number,
	prompt: string,
	nowMs: number,
	endAt?: number,
): ParsedSchedule {
	const nextRunAt = nowMs + intervalMs;
	if (endAt !== undefined && endAt < nextRunAt) {
		return {
			error: "The end time must allow at least one run. Increase the end time or shorten the interval.",
		};
	}

	return {
		reminder: {
			kind: "interval",
			prompt,
			createdAt: nowMs,
			nextRunAt,
			intervalMs,
			endAt,
			runCount: 0,
			active: true,
		},
	};
}

export function parseSchedule(expression: string, nowMs = Date.now()): ParsedSchedule {
	const text = expression.trim();
	if (!text) return { error: usage() };

	const once = text.match(/^\+(\S+)\s+([\s\S]+)$/i);
	if (once) {
		const delay = parseDuration(once[1]);
		if (!delay) return { error: `Bad duration: ${once[1]}` };
		return {
			reminder: {
				kind: "once",
				prompt: once[2].trim(),
				createdAt: nowMs,
				nextRunAt: nowMs + delay,
				runCount: 0,
				active: true,
			},
		};
	}

	const finiteDuration = text.match(
		/^every\s+(\S+)\s+for\s+(\S+)\s+([\s\S]+)$/i,
	);
	if (finiteDuration) {
		const interval = parseDuration(finiteDuration[1]);
		if (!interval) return { error: `Bad interval: ${finiteDuration[1]}` };
		const runFor = parseDuration(finiteDuration[2]);
		if (!runFor)
			return { error: `Bad "for" duration: ${finiteDuration[2]}` };
		return intervalReminder(
			interval,
			finiteDuration[3].trim(),
			nowMs,
			nowMs + runFor,
		);
	}

	const finiteEndTime = text.match(
		/^every\s+(\S+)\s+until\s+(\S+)\s+([\s\S]+)$/i,
	);
	if (finiteEndTime) {
		const interval = parseDuration(finiteEndTime[1]);
		if (!interval) return { error: `Bad interval: ${finiteEndTime[1]}` };
		const endAt = parseEndAt(finiteEndTime[2], nowMs);
		if (endAt === null)
			return { error: `Bad "until" time: ${finiteEndTime[2]}` };
		if (endAt <= nowMs)
			return { error: `The "until" time must be in the future: ${finiteEndTime[2]}` };
		return intervalReminder(
			interval,
			finiteEndTime[3].trim(),
			nowMs,
			endAt,
		);
	}

	const infinite = text.match(/^every\s+(\S+)\s+([\s\S]+)$/i);
	if (infinite) {
		const interval = parseDuration(infinite[1]);
		if (!interval) return { error: `Bad interval: ${infinite[1]}` };
		return intervalReminder(interval, infinite[2].trim(), nowMs);
	}

	return { error: usage() };
}

export function prepareForResume(reminder: Reminder, nowMs: number): Reminder {
	const resumed = { ...reminder };
	if (!resumed.active) return resumed;
	if (resumed.endAt !== undefined && nowMs > resumed.endAt) {
		resumed.active = false;
		return resumed;
	}
	if (resumed.nextRunAt > nowMs) return resumed;

	if (resumed.kind === "once") {
		resumed.nextRunAt = nowMs + 2_000;
		return resumed;
	}

	resumed.nextRunAt = nowMs + (resumed.intervalMs ?? 60_000);
	if (resumed.endAt !== undefined && resumed.nextRunAt > resumed.endAt) {
		resumed.active = false;
	}
	return resumed;
}

export function advanceAfterRun(reminder: Reminder, firedAt: number): Reminder {
	const advanced = { ...reminder, lastRunAt: firedAt, runCount: reminder.runCount + 1 };
	if (advanced.kind === "once") {
		advanced.active = false;
		return advanced;
	}

	advanced.nextRunAt = firedAt + (advanced.intervalMs ?? 60_000);
	if (advanced.endAt !== undefined && advanced.nextRunAt > advanced.endAt) {
		advanced.active = false;
	}
	return advanced;
}

export function usage(): string {
	return "Use: +10m <prompt> OR every 30m [for 6h | until 18:00] <prompt>";
}
