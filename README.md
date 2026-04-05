# Kickstart

Kickstart is a desktop app for developers who bounce between repos all day.

Stop juggling terminal windows. Keep your local dev commands organized by repo, start what you need in one click, open extra shells when you need them, and always know what is running where.

## What It Does

- Start a whole project from a saved `kickstart.json`
- Keep personal-only commands in the app without touching the repo config
- Run one service or launch every command a project needs
- Open temporary shells without turning your desktop into terminal soup
- Switch between repos without losing terminal state or the directory each shell was in

## Why It Exists

With modern dev workflows, it is easy to end up running multiple projects and multiple processes at once. Some repos need one command. Others need a frontend, backend, worker, and a few one-off shells on the side.

Kickstart keeps that setup in one place so local development feels calm again.

## Apps

- `apps/desktop`: the Electron app
- `apps/marketing`: the marketing site

## Requirements

- Bun `1.3+`
- macOS for the desktop packaging flow

## Development

```bash
bun install
bun run dev
```

## Quality Checks

```bash
bun run lint
bun run test
bun run typecheck
bun run build
```

## Releases

- GitHub releases: <https://github.com/paukraft/kickstart/releases>
- Unsigned macOS installs currently use a manual download/update flow.
- To publish an unsigned macOS build to GitHub Releases:

```bash
bun install
bun run lint
bun run test
bun run typecheck
node scripts/build-desktop-artifact.mjs --platform darwin --publish always
```

- Tag the desktop version before publishing, for example `v0.1.0`.
- Users install the latest `.dmg` from GitHub Releases and may need to use Finder `Open` once to bypass the unsigned app warning.
- Automatic in-app updates are disabled for unsigned builds until Apple signing/notarization is set up.
- Marketing site source: `apps/marketing`
- Desktop app source: `apps/desktop`

## License

MIT. See [LICENSE](LICENSE).
