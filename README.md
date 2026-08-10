# doge

<p align="center">
  <img src="./public/app-icon.png" width="128" height="128" alt="doge AI Shiba assistant app icon" />
</p>

> Bring complicated things back—and get them done.

doge is an anthropomorphic AI Shiba who lives on your computer. It is neither an all-knowing AI above you nor a passive tool waiting for commands. It remembers how you work and brings scattered files, terminal sessions, tasks, and ideas back into one place.

At work, doge helps break down goals, write code, research problems, and move tasks forward. Over time, it will also learn to organize plans, preserve ideas, and look after everyday details. The first release is focused on developer workflows and does not claim lifestyle services that have not been built yet.

Current version: `0.1.0`

## What doge can do today

- Use local AI runtimes such as Claude Code, Codex CLI, Gemini CLI, OpenCode, Kimi, and Grok from one desktop interface.
- Manage multiple projects, workspaces, and Git worktrees, with fast session switching.
- See reasoning, tool calls, file edits, terminal output, and task state as they happen.
- Browse and edit files, inspect Git diffs, commit changes, and manage branches and history.
- Tackle complex work with project maps, context ledgers, memory, task boards, and multi-agent collaboration.
- Keep data local by default; doge does not require a proprietary cloud service to run.

## Downloads and updates

Public installers will be published through [doge Releases](https://github.com/jasonmao-msj/doge/releases).

Automatic updates will trust only releases signed by doge. Until the independent signing key and first production release are ready, the updater remains disabled and does not connect to or trust another update source.

No cloud server is required initially. The app runs locally, while installers and the static update manifest are hosted by GitHub Releases. A backend should be considered only if future features require account sync, remote execution, or more advanced distribution.

## Local development

### Requirements

- Node.js 20+
- npm 10+
- Rust stable, Cargo, and rustfmt
- CMake
- Homebrew OpenSSL 3 is recommended for macOS builds

### Start the app

```bash
git clone https://github.com/jasonmao-msj/doge.git
cd doge
npm install
npm run tauri:dev:hot
```

Run only the web frontend:

```bash
npm run dev
```

### Verification

During daily development, run checks related to the code you changed:

```bash
npm run typecheck
npm exec vitest run -- path/to/changed.test.ts
cargo test --manifest-path src-tauri/Cargo.toml module_name --lib
```

Run the full gates before merging or publishing:

```bash
npm run check:runtime-contracts
npm run check:branding
npm run lint
npm run typecheck
npm run test
cargo test --manifest-path src-tauri/Cargo.toml
```

Build for Apple Silicon:

```bash
npm run build:mac-arm64
```

## Local data and migration

- Current doge data directory: `~/.doge`
- New installations write only to the doge namespace.
- On upgrade, historical data is copied forward; existing doge data always wins.
- Historical directories are never moved or deleted, which keeps rollback possible.
- Migration diagnostics record only the source kind, schema version, and time—never secrets, tokens, full user paths, or file contents.

## Brand

The official name is always lowercase `doge`. The visual direction is a warm, reliable amber Shiba assistant, without coins, price charts, rockets, or other cryptocurrency imagery.

Brand story:

> doge began with a little Shiba who always sat beside your desk. It brings scattered files, terminal sessions, tasks, and ideas back to you one by one. At work, it helps plan goals, write code, research problems, and move tasks forward. Over time, it will learn to organize plans, preserve ideas, and look after everyday details. doge is an AI Shiba who lives on your computer—and a life and work companion you can trust.

## License

This project is released under the [MIT License](./LICENSE). Required copyright and license notices for inherited code remain in the Git history and LICENSE.

## Contributing

- Issues and ideas: [GitHub Issues](https://github.com/jasonmao-msj/doge/issues)
- Repository: [jasonmao-msj/doge](https://github.com/jasonmao-msj/doge)

Before submitting changes, make sure the branding gate, typecheck, and relevant tests pass. `main` is the source of truth for doge releases.
