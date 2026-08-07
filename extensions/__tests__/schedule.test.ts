import assert from "node:assert/strict";
import test from "node:test";
import {
	advanceAfterRun,
	parseDuration,
	parseSchedule,
	prepareForResume,
	type Reminder,
} from "../schedule.js";

const NOW = new Date(2026, 7, 7, 13, 0, 0).getTime();

function reminder(overrides: Partial<Reminder> = {}): Reminder {
	return {
		id: "abc123",
		kind: "interval",
		prompt: "Check chats",
		createdAt: NOW,
		nextRunAt: NOW + 30 * 60_000,
		intervalMs: 30 * 60_000,
		runCount: 0,
		active: true,
		...overrides,
	};
}

test("parses supported duration units", () => {
	assert.equal(parseDuration("30s"), 30_000);
	assert.equal(parseDuration("1.5h"), 5_400_000);
	assert.equal(parseDuration("2 days"), 172_800_000);
	assert.equal(parseDuration("0m"), null);
	assert.equal(parseDuration("0.000001s"), null);
	assert.equal(parseDuration(`${"9".repeat(400)}d`), null);
	assert.equal(parseDuration("later"), null);
});

test("parses one-shot reminders", () => {
	const parsed = parseSchedule("+10m Check CI", NOW);
	assert.ok(parsed.reminder);
	assert.equal(parsed.reminder.kind, "once");
	assert.equal(parsed.reminder.nextRunAt, NOW + 10 * 60_000);
	assert.equal(parsed.reminder.prompt, "Check CI");
});

test("recurring reminders are infinite by default", () => {
	const parsed = parseSchedule("every 30m Check chats", NOW);
	assert.ok(parsed.reminder);
	assert.equal(parsed.reminder.kind, "interval");
	assert.equal(parsed.reminder.intervalMs, 30 * 60_000);
	assert.equal(parsed.reminder.endAt, undefined);
});

test("supports a finite duration", () => {
	const parsed = parseSchedule("every 30m for 4h Check chats", NOW);
	assert.ok(parsed.reminder);
	assert.equal(parsed.reminder.endAt, NOW + 4 * 3_600_000);
});

test("supports a local end time", () => {
	const parsed = parseSchedule("every 30m until 18:00 Check chats", NOW);
	assert.ok(parsed.reminder);
	const expected = new Date(NOW);
	expected.setHours(18, 0, 0, 0);
	assert.equal(parsed.reminder.endAt, expected.getTime());
});

test("supports an ISO end time", () => {
	const parsed = parseSchedule(
		"every 30m until 2026-08-07T18:00:00+02:00 Check chats",
		NOW,
	);
	assert.ok(parsed.reminder);
	assert.equal(parsed.reminder.endAt, Date.parse("2026-08-07T18:00:00+02:00"));
});

test("rejects finite schedules that cannot run", () => {
	const shortDuration = parseSchedule("every 30m for 10m Check chats", NOW);
	assert.match(shortDuration.error ?? "", /at least one run/);

	const pastTime = parseSchedule("every 30m until 12:00 Check chats", NOW);
	assert.match(pastTime.error ?? "", /future/);
});

test("expired recurring reminders do not fire after resume", () => {
	const expired = prepareForResume(
		reminder({ endAt: NOW + 60_000, nextRunAt: NOW + 30_000 }),
		NOW + 120_000,
	);
	assert.equal(expired.active, false);
});

test("missed intervals continue one interval after resume", () => {
	const resumedAt = NOW + 2 * 3_600_000;
	const resumed = prepareForResume(reminder(), resumedAt);
	assert.equal(resumed.active, true);
	assert.equal(resumed.nextRunAt, resumedAt + 30 * 60_000);
});

test("overdue one-shot reminders fire shortly after resume", () => {
	const resumedAt = NOW + 2 * 3_600_000;
	const resumed = prepareForResume(
		reminder({ kind: "once", intervalMs: undefined }),
		resumedAt,
	);
	assert.equal(resumed.nextRunAt, resumedAt + 2_000);
});

test("a finite schedule ending at its first run fires exactly once", () => {
	const parsed = parseSchedule("every 30m for 30m Check chats", NOW);
	assert.ok(parsed.reminder);
	const first = advanceAfterRun(
		{ id: "first", ...parsed.reminder },
		NOW + 30 * 60_000 + 5,
	);
	assert.equal(first.runCount, 1);
	assert.equal(first.active, false);
});

test("finite intervals stop before scheduling past their end", () => {
	const current = reminder({ endAt: NOW + 60 * 60_000 });
	const first = advanceAfterRun(current, NOW + 30 * 60_000);
	assert.equal(first.active, true);
	assert.equal(first.runCount, 1);

	const second = advanceAfterRun(first, NOW + 60 * 60_000);
	assert.equal(second.active, false);
	assert.equal(second.runCount, 2);
});
