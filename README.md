# Kickstart

Kickstart is a desktop app for developers who bounce between repos all day.

Stop juggling terminal windows. Keep your local dev commands organized by repo, start what you need in one click, open extra shells when you need them, and always know what is running where.

## What It Does

- Start a whole project from a saved `kickstart.json`
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
- Marketing site source: `apps/marketing`
- Desktop app source: `apps/desktop`

## License

MIT. See [LICENSE](LICENSE).
