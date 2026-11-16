![Context injection: many sources narrowed into one first request](preview.svg)

# What this plugin actually changes

A new DSH session receives a lot before its first request reaches a model: the system prompt
sections, runtime contexts, the skill catalog as text, one JSON schema per tool, and the
`AGENTS.md` chain. None of it is visible in the conversation, and there is no single place to
turn any of it off.

This page is the five-minute version of what the plugin measures and what it can and cannot
switch. The [README](../README.md) is the overview; the [architecture](ARCHITECTURE.md) is the
implementation.

## 1. The measurement

Two different numbers are on screen and they answer different questions:

| Number | Question | Where it comes from |
| --- | --- | --- |
| First-turn injection (e.g. 83.8k) | What will the *next new session* be given? | Assembled here: prompt sections and contexts from `systemPrompt.assemble()`, skills from `skills.snapshot()`, tool schemas from `tools.schemas()`, `AGENTS.md` read from the default chain |
| Window occupancy (e.g. 36%) | How full is *this* conversation? | The host's own `contextPressure` projection, divided by the model's window |

They are not comparable, and the panel never subtracts one from the other. The first number is
what the plugin controls; the second is what decides when the host compacts.

Token counts from this plugin are estimates (ASCII ÷ 4, other characters ÷ 1.6). The occupancy
figure is not: `pressureTokens` is provider-reported, and the window comes from the same request
record the model adapter used.

## 2. What each channel really is

| Channel | Injected as | Switch |
| --- | --- | --- |
| Prompt sections | `system/message` blocks assembled by `system-prompt/assemble` | Filtered in a scoped `system-prompt/assemble` waterfall |
| Runtime contexts | The same assembly, `contexts` half | Same waterfall |
| Skill catalog | A pre-step user message listing name + description | Per-skill shadow registration, or dropping the `skill` tool |
| Tool schemas | The request's tool declarations | `tools.restrict({ deny })` in the session scope |
| Workspace rules | `AGENTS.md` / `CLAUDE.md` chain | **Not switchable** — shown read-only |

Required contexts (working directory, subagent identity) are pinned: a policy that would drop them
is ignored for those names.

## 3. What a policy does, and when

A policy is one JSON file: per channel, `all`, `only [names]` or `except [names]`, plus an optional
persona prefix/suffix and a token budget.

It is applied exactly once, at `agent/created` with `source: startup|clear`. A session that already
exists is never rewritten mid-flight, so:

- the panel says whether *this* session was affected;
- "after policy" numbers are a projection for the next new session;
- undo restores the previous policy file, but still cannot retroactively change a live session.

## 4. Suites

Items cluster by name: `mcp__<server>__<tool>` is one suite per MCP server; non-MCP tools cluster by
shared prefix; skills by provider; prompt sections and contexts by namespace, so an MCP server's
prompt section joins the same suite as its tools. One switch then means "the whole server", which is
the reason this plugin exists.

## 5. What the model sees

The model-facing tool `context_injection` returns the same snapshot the panel renders, plus a short
"What you can do" block: which suite is the biggest win, whether this session predates the policy,
what compaction already removed, and the fact that the tool cannot flip switches. It is read-only by
design; every write comes from a human click in the panel.

## 6. Failure behaviour

- Host older than 0.2.2: banner, switches may not take effect, the numbers still render.
- No measurement yet in this session: the window card disappears rather than showing a guess.
- A `compaction/*` event this build does not know: ignored (the receipt simply does not count it).
- Policy file unreadable: the panel shows the error and keeps running with the all-on defaults;
  `/inject` still prints the snapshot.
