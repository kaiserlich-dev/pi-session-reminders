# Pi Session Reminders

Public Pi package: `@kaiserlich-dev/pi-session-reminders`.

## Release

For behavior changes:

1. Update `README.md`.
2. Run `npm test` and `npm pack --dry-run`.
3. Bump the package version with `npm version patch|minor|major --no-git-tag-version`.
4. Commit and push.
5. Publish with `npm run publish:pi`.

Use patch for fixes, minor for features, and major for breaking changes.

## Design rules

- Reminders are session-bound; do not add a background daemon.
- Infinite recurrence remains the default when no `for` or `until` clause is present.
- Never replay missed recurring runs after resume.
- Expired reminders must never fire after resume.
- Keep parser and lifecycle behavior covered in `extensions/__tests__/schedule.test.ts`.
