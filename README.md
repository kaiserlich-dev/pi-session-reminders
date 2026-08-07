# @kaiserlich-dev/pi-session-reminders

Session-bound one-shot and recurring reminders for [Pi](https://pi.dev). Ask Pi to check something later, monitor it repeatedly forever, or stop automatically after a duration or at a specific time.

## Install

```bash
pi install git:github.com/kaiserlich-dev/pi-session-reminders@v1.0.1
```

Then restart Pi or run `/reload`.

## Usage

```text
/remind +10m Check whether CI passed
/remind every 30m Check new support tickets
/remind every 30m for 4h Check production chat health
/remind every 30m until 18:00 Check production chat health
/remind every 30m until 2026-08-07T18:00:00+02:00 Check production chat health
```

Recurring reminders are infinite unless `for` or `until` is supplied.

| Command | Action |
|---|---|
| `/remind <schedule> <prompt>` | Create a reminder |
| `/reminders` | List active reminders |
| `/remind-cancel <id>` | Cancel one reminder |
| `/remind-cancel all` | Cancel every reminder |

The extension also registers `session_reminder_create`, `session_reminder_list`, and `session_reminder_cancel`, so Pi can manage reminders directly when you ask in natural language.

## Schedule syntax

Durations support seconds, minutes, hours, and days, including decimals. The minimum duration is one second:

```text
30s
10m
1.5h
2d
```

`until HH:MM` uses your local timezone and must refer to a future time today. Use an ISO timestamp with an explicit timezone for another date or unambiguous scheduling.

A finite recurring schedule must allow at least one run. For example, `every 30m for 10m` is rejected instead of silently firing after its end time.

`for` and `until` immediately after the interval are reserved schedule keywords. If your infinite reminder prompt needs to begin with either word, rephrase it—for example, use `every 30m Check for new chats` instead of `every 30m for new chats`.

## Session behavior

Reminders belong to the Pi session where they were created and are persisted in that session's JSONL history.

- Reloading or resuming the session restores active reminders.
- Overdue one-shot reminders fire shortly after the session resumes.
- Recurring reminders continue one interval after resume; missed runs are not replayed.
- Expired recurring reminders stay expired and never fire once more after resume.
- If Pi is not running, reminders cannot execute in the background. This is deliberate: prompts are injected into the owning live session, not handled by a separate daemon.

## UI

While reminders are active, Pi shows:

- a footer status with the number of reminders and time until the next run;
- a compact widget listing upcoming reminders;
- run count and end-time information in `/reminders`.

## Development

```bash
npm install
npm test
pi -e ./extensions/index.ts
```

## Security

Pi extensions run with your full system permissions. This package makes no network requests and starts no external processes; it only schedules prompts inside the current Pi session.

## License

MIT
