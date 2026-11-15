# dsh-context-preflight

Every new DSH session starts with tool schemas, a skill catalog, prompt sections and
workspace rules already in the prompt. This plugin shows that bill, and lets you set
what a new session gets by default.

Measured on a real profile with this plugin installed: **84,230 tokens** of injection
before the first user message — 76,202 of it tool schemas from a single MCP server.

## What it does

- **Measures the injection surface.** Four buckets, each with real numbers, drilled down
  to the largest entries: prompt sections, skill catalog, tool schemas, workspace rules.
- **Sets per-new-session defaults.** Choose which skills are offered to the model, which
  tools are withheld (prefix matching, so one entry can drop a whole MCP server), and
  whether optional runtime context is injected.
- **Shows the saving.** After a policy change the panel states what a new session will
  inject and how much that is compared with the current setting.

The policy applies when a session is created. Running sessions are never changed
mid-flight.

## Install

```sh
dsh plugin add github:IWHBIWHB/dsh-context-preflight
```

Or attach the released tarball:

```sh
dsh plugin add https://github.com/IWHBIWHB/dsh-context-preflight/releases/latest/download/dsh-context-preflight.tgz
```

## Use

- Sidebar entry **注入** opens the panel: totals, per-bucket breakdown, the largest tool
  schemas, and the default policy.
- The `context_preflight` tool returns the same measurement as text, so the model can
  report it without the panel.

## Default policy

Stored at `~/.dsh/context-preflight/policy.json`:

```json
{
  "version": 1,
  "skills": { "mode": "all" },
  "tools": { "mode": "except", "names": ["mcp__rexx__"] },
  "runtimeContext": { "enabled": true }
}
```

`mode` is `all`, `only` or `except`; `tools.names` accepts exact names and prefixes.
Deleting the file restores every default.

## What it does not do

- It does not defer-load a plugin's own tools. DSH supports `deferLoading` per tool, but
  that is decided by the plugin that registers the tool; this plugin cannot retrofit it.
  Withholding a tool removes it from the model's view entirely — capabilities are lost.
- It does not edit skill files, workspace rules, or any other plugin.
- It does not change a request that has already been sent.
- It does not estimate the whole conversation: reported numbers cover the injection
  surface, not chat history. The panel prints the session's current occupancy on its own
  line, labelled for what it is.

## Limits

- Token figures are `ASCII / 4 + non-ASCII / 1.6`, an estimate, not tokenizer output.
  On a real profile it lands within a few percent of the provider's count.
- Workspace rule files (`AGENTS.md` and friends) are reported read-only: DSH loads them
  at session start, so they cannot be toggled per session.
- Requires a DSH build with the client module system (`dsh.client`).

## License

MIT
