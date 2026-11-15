# Changelog

## 1.2.0 — 2026-11-15

- Export the manifest: `GET /plugins/dsh-injection-manager/export?format=md|json`
  and two buttons in the Policy tab. Markdown for a ticket, JSON for comparing
  two machines; same snapshot as the panel.
- Text rendering tests (suite list, missing instruction files, session anchor).

## 1.1.0 — 2026-11-15

- Undo: every policy write remembers the previous policy (20 deep), so a whole
  229-item suite switch is one click away from being reverted. The panel shows
  an Undo button whenever history is available.

- Plugin configuration card (Plugins → Configuration): hide the composer chip,
  refresh on window focus, show raw key names, and seed a first-run token budget.
  The plugin keeps working when the schema library cannot be resolved (Config is
  then omitted instead of failing activation).
- The panel now reports a failed switch instead of silently doing nothing, and
  confirms a successful write briefly.
- Settings loader is covered by unit tests.

## 1.0.1 — 2026-11-15

- Renamed to `dsh-injection-manager` (from the 1.0.0 development name
  `dsh-context-injection`, itself from `dsh-context-preflight`). The name owns
  the "injection" word — DSH's own tool is `context_injection` — instead of
  competing with 83 `context-*` plugins. Old policy files are still imported.
- README: install command in the first screen, CI/license/dsh badges, three real
  panel screenshots, `screenshots.json` for the plugin market, and a
  compatibility document.
- CI workflow: syntax check + unit tests on Node 20/22 + bundle metadata check.
- Policy data directory is now `$DSH_HOME/injection-manager/`; both earlier
  locations are read once on first upgrade.

## 1.0.0 — 2026-11-15

First release under the new name and package id `dsh-injection-manager`
(previously developed as `dsh-context-preflight`).

- One snapshot of the first request: prompt sections, runtime contexts, skill
  catalog, tool schemas and the workspace-rule chain, each with characters and
  estimated tokens.
- Suites: entries cluster into switchable groups (one MCP server = one suite,
  otherwise shared naming prefixes, skills by provider, sections/contexts by
  namespace), so 229 REA tools become a single switch with a tri-state state.
- Per-item switches, per-channel master switches, `all` / `only` / `except`
  modes, two presets, a greedy token budget and custom persona prefix/suffix.
- Effects are session-scoped registrations: prompt sections and runtime
  contexts through a scoped `system-prompt/assemble` filter, skills by shadow
  registration, tools through `tools.restrict`. No user file is read or
  written.
- Read-only model tool `context_injection`, `/inject` command, sidebar icon,
  composer chip, management page, and a `/verify` route that re-assembles a
  live session to prove the policy landed.
- Policy is imported once from `dsh-context-preflight` when only the old file
  exists.

### Fixed compared with the pre-1.0 development line

- Never renames `AGENTS.md` or rewrites `SKILL.md`; disabling a rule no longer
  mutates the workspace.
- Required runtime contexts (working directory, subagent identity) can no
  longer be dropped by a policy.
- Section/context exclusion no longer fails with "already registered in this
  scope" (agent presets own those names); it uses the scoped assemble filter.
- One implementation of the preview math, so the panel and the applied policy
  cannot disagree.
- Policy writes are atomic and per-action; two open panels cannot overwrite
  each other's switches.
- Cross-site POSTs are rejected; the action API requires same-origin JSON.
