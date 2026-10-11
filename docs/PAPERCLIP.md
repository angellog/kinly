# Paperclip plugin `vantik.kinly`

The plugin is installed once on the instance and enabled per company. By default it is on in all four companies. It talks only to the Kinly API.

## What it adds

- **Console page** at `/<PREFIX>/kinly`, with eight tabs: Today, This Week, Categories, Persistent, My Stars, Shortlist, Reports and Ask Kinly. Each repository opens a card that offers these decisions: **Add to workspace (test)**, **Shortlist**, **Drop**, **Rate 1–5** with notes, and **Make resource page**.
- **Sidebar link** and **dashboard widget**. The widget shows today's top three.
- **Agent tools**, namespaced `vantik.kinly:*`:

  | Tool | Needs the token |
  |---|---|
  | `trending` | no |
  | `search` | no |
  | `repo` | no |
  | `report` | no |
  | `research` | yes |
  | `shortlist` | yes |
  | `rate` | yes |
  | `resource` | yes |

- **Managed agent `kinly`** ("Kinly", role researcher, `claude_local`). It is **created paused** in every enabled company. Its instructions are [`packages/paperclip-plugin/AGENTS.md`](../packages/paperclip-plugin/AGENTS.md): what it does, the data-not-instructions rule, and the container-only test protocol.
- **Managed skill `kinly`**: how any agent uses the tools.
- **Jobs**:
  - `daily-brief` (07:00 UTC) upserts one issue per day per company that turned the brief on. It is idempotent by origin `plugin:vantik.kinly:brief` / `brief-<date>`.
  - `reconcile` (every 6 hours) keeps the agent and the skill present.

## Configuration (per company)

| Field | Default | Notes |
|---|---|---|
| `enabled` | `true` | Turns Kinly off for a company |
| `apiUrl` | the Railway domain | Must be https; http is accepted on loopback only |
| `apiTokenRef` | — | A **company secret** holding `KINLY_API_TOKEN`, picked with the secret picker. Resolved in the worker on every call and never cached; the browser never sees it. Without it the console is read-only |
| `dailyBrief` | `false` | Opt in per company |
| `briefAssigneeAgentId` | — | Optional |
| `focus` | "Vantik Systems and FeetBit" | Shown in the brief |

## Install

Installing is board-gated, so it runs from this Mac with the local CLI:

```bash
cd packages/paperclip-plugin && npm run check            # typecheck, tests, build, manifest validation against the host
paperclipai plugin install ./packages/paperclip-plugin   # first time
paperclipai plugin upgrade vantik.kinly                  # after changes
```

Then do three things in each company:

1. Create a secret holding the API token.
2. Set `apiTokenRef` to that secret in the plugin settings.
3. Allow the `vantik.kinly:*` tools for the agents that should use them.

Resume the Kinly agent only in companies where it should work.

## Rotating the API token

1. Set a new `KINLY_API_TOKEN` on Railway. The old value stops working on the next deploy.
2. Update the company secret that holds it. Every company's `apiTokenRef` points at that secret, so nothing else changes.
3. Check: the console header should read **writes on**.
