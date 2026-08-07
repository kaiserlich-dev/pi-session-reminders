import assert from "node:assert/strict";
import test from "node:test";
import sessionReminders from "../index.js";

test("registers tools and supports create, list, and cancel", async () => {
	const handlers = new Map<string, (...args: any[]) => unknown>();
	const tools = new Map<string, any>();
	const commands = new Map<string, any>();
	const entries: any[] = [];

	const pi = {
		on(name: string, handler: (...args: any[]) => unknown) {
			handlers.set(name, handler);
		},
		registerTool(tool: any) {
			tools.set(tool.name, tool);
		},
		registerCommand(name: string, command: any) {
			commands.set(name, command);
		},
		appendEntry(customType: string, data: unknown) {
			entries.push({ type: "custom", customType, data });
		},
		sendUserMessage() {},
		sendMessage() {},
	};
	const ctx = {
		mode: "tui",
		sessionManager: { getEntries: () => entries },
		ui: {
			setStatus() {},
			setWidget() {},
			notify() {},
		},
	};

	sessionReminders(pi as never);
	assert.deepEqual([...tools.keys()].sort(), [
		"session_reminder_cancel",
		"session_reminder_create",
		"session_reminder_list",
	]);
	assert.deepEqual([...commands.keys()].sort(), [
		"remind",
		"remind-cancel",
		"reminders",
	]);

	await handlers.get("session_start")?.({}, ctx);
	const created = await tools
		.get("session_reminder_create")
		.execute(
			"create",
			{ schedule: "every 1h for 2h Check chats" },
			undefined,
			undefined,
			ctx,
		);
	assert.equal(created.details.ok, true);
	assert.equal(created.details.reminder.active, true);

	const listed = await tools
		.get("session_reminder_list")
		.execute("list", {}, undefined, undefined, ctx);
	assert.equal(listed.details.reminders.length, 1);
	assert.match(listed.content[0].text, /ends in/);

	const cancelled = await tools
		.get("session_reminder_cancel")
		.execute("cancel", { id: "all" }, undefined, undefined, ctx);
	assert.equal(cancelled.details.cancelled, 1);

	const empty = await tools
		.get("session_reminder_list")
		.execute("list", {}, undefined, undefined, ctx);
	assert.equal(empty.content[0].text, "No active reminders");

	await handlers.get("session_shutdown")?.({}, ctx);
});
