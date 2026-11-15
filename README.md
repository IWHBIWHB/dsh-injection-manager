# Context injection · dsh-context-injection

Manages everything a DeepSeek Harness session receives before its first request: system-prompt sections, runtime contexts, the skill catalog, tool schemas and workspace rules. Every item shows its size in characters and estimated tokens, has its own switch, and the whole set can be held to a token budget.

![Context injection panel](docs/preview.svg)

## Why

In a typical DSH session the biggest part of the first request is not your prompt but the tool schemas. On a machine with one large MCP server, 280 tool definitions can cost 75k tokens out of an 84k first request. None of it is visible, and there is no single place to turn it off.

This plugin flattens that first request into a list and actually applies the switches — not by editing your files, but by registering a nearer layer inside each new session's scope.

## What it manages

| Channel | Mechanism | Effect when switched off |
| --- | --- | --- |
| Prompt sections | A session-scoped `system-prompt/assemble` filter drops the named section | That text disappears from the system prompt |
| Runtime contexts | Same filter by name (required entries excluded) | Approval/sandbox snapshots stop entering the first request |
| Skill catalog | A same-name, non-invocable skill registered in the session scope | The skill disappears from the model-visible catalog |
| Tool schemas | `tools.restrict({ deny })` | The definition and parameters are no longer sent |
| Workspace rules | **Read-only display** | — |

Workspace rules (`AGENTS.md` / `CLAUDE.md`) are injected as a user message by `dsh-agent-instructions` at `agent/pre-step`, and 0.2.2 exposes no public suppression hook. The plugin never renames, deletes or edits those files: the panel marks them read-only and reports whether each candidate is actually on the load path and within budget.

Required contexts (working directory, subagent identity) are read-only too; no policy can drop them.

## Five entry points

| Entry | Where | What |
| --- | --- | --- |
| Sidebar icon | Left panel list, "Injection" | Opens the management page |
| Management page | Main area | Items / Policy / Budget / Notes |
| Composer chip | Under the input | One line: first-turn total and how much is switchable |
| `context_injection` tool | Model-callable | Read-only snapshot with a Markdown card |
| `/inject` command | Composer | Text report; `/inject minimal`, `/inject all`, `/inject budget 20000` |

The model-facing tool is read-only: the model cannot loosen or tighten the policy. Every write comes from a click in the panel.

## Policy semantics

The policy lives in `$DSH_HOME/context-injection/policy.json`, one file, written atomically.

Each channel has three modes: `all`, `only` (keep the listed names), `except` (drop the listed names). A single switch in the panel lands in `except`, or removes the entry from an `only` list, so manual switches and presets never fight each other.

- **Everything** — no policy.
- **Minimal** — identity, persona prefix, and the file/terminal tools only. On the machine this was built on, it moves the first request from 84k to 5k tokens.
- **Budget** — enter a target, the plugin greedily suggests the largest switchable items to drop, and applies the suggestion on click. Required contexts and workspace rules never participate; an unreachable target is reported as unreachable instead of silently failing.
- **Custom prefix/suffix** — free text that replaces `deployment:persona-prefix` / `deployment:persona-suffix`. Empty means nothing is injected. Both change the prompt prefix and therefore cache reuse; the panel says so.

## Install

```powershell
# In DSH: Plugins → Add plugin → pick this directory
# Or with the CLI
dsh plugin --profile web add D:/path/to/dsh-context-injection
```

Refresh the page; the "Injection" icon appears in the left panel list.

Upgrading from `dsh-context-preflight`: if only the old policy file exists, it is read once and used as the current policy. Writes always go to the new path.

## Design choices

- **No user files touched.** The old plugin renamed `AGENTS.md` and rewrote `SKILL.md` frontmatter to "disable" a rule. Everything here is a session-scoped registration: reversible, and it cannot edit the wrong project when two sessions have different working directories.
- **New sessions only.** The policy applies at `agent/created`; a running conversation is never rewritten. The panel states whether the current session was created with the policy.
- **One snapshot.** The list, the tool card and the applied policy all come from the same snapshot, so the preview is the number that takes effect. No second implementation in the browser.
- **Honest numbers.** Tokens are estimates: ASCII ÷ 4, other characters ÷ 1.6. Not tokenizer output; the composer's own statistics remain authoritative.

## Self-check

- `GET /plugins/dsh-context-injection/ping`
- `GET /plugins/dsh-context-injection/summary?session=<id>` — the snapshot the panel renders.
- `GET /plugins/dsh-context-injection/verify?session=<id>` — re-assembles a live session and returns the **effective** sections, contexts and tool names. This proves the policy landed, not just that a file changed.
- `GET /plugins/dsh-context-injection/diag` — client module presence in the boot table, last application result, how many times the assemble filter ran, and the before/after section counts.

## Limitations

- 0.2.2 has no ordering API for contributions; the budget is a greedy largest-first heuristic, not a global optimum.
- The skill catalog is a pre-step message, so granularity is per-skill (or the whole catalog via the `skill` tool).
- User-message channels such as workspace rules and time context cannot be switched off; the plugin shows them instead of pretending otherwise.
- Chinese and English UI; other languages fall back to English.

## License

MIT
