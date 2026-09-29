# Kopitiam Agents ☕ 咖啡店

A read-only headcount of your open agent terminals, drawn as a Malaysian kopitiam:
**3 terminals running Claude Code = 3 customers in the shop; open a 4th and a 4th walks in.**

| In the shop | In the agent world |
|---|---|
| a **customer** at a table | one open terminal tab (Claude Code or Codex) — open a tab, someone walks in; close it, they leave |
| the customer's number & seat | the tab's number (`Tab 2`). Kept for as long as the tab is open; a closed tab's number and seat go to the next new tab, nobody else moves |
| shirt colour | warm = Claude Code, cool = Codex (the node also carries `data-src="claude|codex"` for sprite sheets) |
| the badge over their head | ⚙️ working · ✅ done, your turn · ⚠️ needs you (they wave) |
| an **order chit** on the rail | what you last asked that tab (cooking → served) |
| **Uncle Lim** at the counter | decoration only (shows the headcount) |
| a **trip to a stall** | a tool call — 🍛 Nasi Lemak = read/grep · 🥞 Roti Canai = bash · 🍞 Kaya Toast = edit/write · ☕ Teh Tarik = web · 🍧 Cendol = MCP/other |
| dish carried back & plated on the table | the tool result (💥 = the tool errored) |
| **the bill** | tokens: new / cache write / cache read / output, plus an estimated price |

## Run

```bash
python3 server.py            # → http://127.0.0.1:8787   (stdlib only, no installs)
python3 server.py --closed   # also list sessions from the last 24 h whose terminal is gone
python3 server.py --read-only  # watch only: never type into an agent
```

## Talking to agents

A web page can't type into a terminal window you opened yourself, so agents run under **kopi**: a transparent
pass-through (like `script` / asciinema) that looks and behaves exactly like running the agent directly, and lets
the page type into it. Set it up once:

```bash
python3 kopi.py install-shell     # hooks `claude` / `codex` in ~/.zshrc and ~/.bashrc (uninstall-shell removes it)
```

From then on, every **new** terminal where you type `claude` or `codex` walks into the shop and can be talked to
from the page. (`claude -p …`, pipes and `--version` are passed straight through; terminals opened before the hook
can only be watched.)

- **+ Claude / + Codex** (top-right of the workspace) starts an agent in the folder you pick with no terminal
  window: the page's live terminal is its screen. `kopi attach <pid>` (shown in the header) opens it in a real
  terminal as well; **Ctrl-]** detaches and leaves it running.
- Type in the box at the bottom of the workspace: **Enter** sends, **Shift+Enter** is a new line. The box is pinned to
  the selected agent (the button says `Send to Tab 4 · Mei Ling`), and every agent keeps its own draft.
  Sending while it works is fine: the agent queues your message.
- **🖥 Terminal** is the agent's own screen, live (xterm.js), for approval prompts and menus: click it and type, or use
  the **Esc ↑ ↓ Enter 1 2 3** buttons. It opens by itself when the agent needs you.
- Ctrl-Z / `fg`, resizing, mouse and scrollback behave as without kopi. The socket kopi listens on
  (`~/.kopitiam/sock/<pid>.sock`) is readable by your user only.

Security: every POST needs the per-run token from `/api/config` and a same-origin `Origin` header, the server only
listens on 127.0.0.1, and a message is refused (not re-routed) if its terminal closed or switched session.

The header shows the count: `4 terminals · 3 Claude · 1 Codex`.

**Layout:** the big area is the **workspace**: one tab per open terminal (with its character's portrait) and that
agent's conversation: your prompts, its replies and its tool calls (read from the session log).
The kopitiam itself is the **mini-map** bottom-left (⤢ expand / Esc to shrink), next to the kitchen log / bill /
ticket; the agent cards are on the right.

Open the page: every open Claude Code / Codex tab is a customer. Click a customer, table, chit or sidebar card to
show that tab's log, bill and ticket on the right (sub-agents are listed under the tab's card in the sidebar).

Tabs on the right: **Kitchen log** (every event, click a line to filter to that agent) ·
**Bill** (per-agent token receipt) · **Ticket** (click a customer/table/chit: the exact brief they were
given, their token mix, and every stall trip with timings).

## Agents sidebar (left)

**One card per open terminal tab** (Tab 1, Tab 2… in the order you opened them). Claude Code tabs come from
`~/.claude/sessions/<pid>.json`; Codex tabs from running `codex` processes and the session file they hold open.
A tab with no messages yet still gets a card. With `--closed`, a **+ Closed** toggle adds sessions from the last 24 h
whose tab is gone (off by default, and then only the open tabs' logs are read).
Each working session shows what its main agent is doing *right now* (current tool call + a live timer) and a nested
roster of its sub-agents — status dot (working / done / stopped), the same name as in the scene, current activity,
model, trips, tokens and duration. Click a session to open its scene; click a sub-agent to open its ticket.
Status for Claude Code tabs comes from Claude Code's own
`~/.claude/sessions/<pid>.json` (busy / idle / waiting). Codex publishes no status, so its status is inferred from
the log and marked **(guessed)**.

## How it works

```
~/.claude/projects/*/<session>.jsonl (+ <session>/subagents/agent-*.jsonl)   ┐
~/.codex/sessions/**/rollout-*.jsonl                                          ┴→ server.py adapters
        → ONE normalized event stream (SSE) → web/app.js reducer → scene, log, bill, ticket
```

Normalized event (see `ev()` in `server.py`): `{k, a, t, …}` with `k` ∈
`prompt · spawn · brief · tool · result · say · usage · done`, `a` = agent id (`main` or the spawning
`tool_use` id), `t` = epoch ms. The UI knows nothing about Claude or Codex — to support another tool,
write one adapter class with a `poll()` that returns these events.

Things worth knowing:

- **Token counts are de-duplicated.** Claude Code writes one API reply as several log records that each repeat
  `usage`; the adapter counts each message id once (per-field max, emitting deltas).
- **Sub-agent "done"** is detected three ways: an `end_turn` stop, the parent's `task-notification` / hand-back
  message, or a text-only last message followed by 4 s of silence.
- **Prices are estimates** from `web/prices.json` (edit it; `assumed:true` rows show a `~`). Subscriptions
  aren't billed per token — read the $ as "what this would cost on the API".
- **Privacy:** session logs contain your prompts and tool output. The server binds to `127.0.0.1`, rejects
  any other `Host` header (DNS-rebinding guard) and never writes to the logs.
- Codex is single-agent for now (its log has no sub-agent linkage here), so you'll see Uncle Lim only.

## Files

```
server.py        HTTP + SSE, static files
fleet.py         finds open Claude Code / Codex terminals (and the kopi they run under), per-session status
kopi.py          the pass-through wrapper, `kopi attach`, and the shell hook (install-shell / uninstall-shell)
kopictl.py       server side of kopi: find wrappers, type into them, stream their output, start new agents
web/vendor/      xterm.js 5.5.0 (MIT) for the live terminal
adapters.py      session-log adapters → one normalized event stream
web/index.html   layout
web/style.css    the kopitiam
web/app.js       event reducer, animation choreography, log/bill/ticket, demo script
web/prices.json  editable price table
```
