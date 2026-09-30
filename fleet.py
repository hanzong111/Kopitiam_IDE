"""Fleet: find every open terminal running Claude Code or Codex (one terminal = one customer in the
scene) and say whether each is working, done, or waiting for you.  Read-only: it never talks to an agent.

Where "status" comes from (most to least trustworthy):
  1. Claude Code itself: every live interactive process writes ~/.claude/sessions/<pid>.json with
     status busy|idle|waiting (+ waitingFor).  We only trust it if that pid is still alive.
  2. The session log: pending tool calls, last message, silence.  Used for Codex (it publishes no
     status), so a Codex status is a guess and is marked evidence="guessed".
"""
import glob
import json
import os
import sys
import threading
import time

import kopictl
from adapters import (CLAUDE_ROOT, CODEX_ROOT, HOME, WEB, ClaudeSession, CodexSession, clip, codex_sid,
                      describe_claude, describe_codex, last_touch)

SESS_DIR = os.path.join(HOME, ".claude", "sessions")
WATCH_SECS = 24 * 3600      # with --closed: also monitor sessions touched within a day
MAX_MONITORS = 30
QUIET_READY_SECS = 3.0      # log-based: last thing was assistant text + this much silence = done
CLOSED_MOVING_SECS = 8.0    # claude session with no live terminal still writing = someone else's headless run


# ───────────────────────── prices (same file the UI reads) ─────────────────────────

_P = {"mtime": 0, "data": {"models": [], "cacheWrite5m": 1.25, "cacheWrite1h": 2.0}}


def prices():
    path = os.path.join(WEB, "prices.json")
    try:
        m = os.path.getmtime(path)
        if m != _P["mtime"]:
            with open(path) as f:
                _P["data"], _P["mtime"] = json.load(f), m
    except (OSError, ValueError):
        pass
    return _P["data"]


def cost_of(model, u):
    """Estimated $ for one usage record, or None if the model has no price entry."""
    P = prices()
    m = (model or "").lower()
    p = next((x for x in P["models"] if x["match"] in m), None)
    if not p:
        return None
    cw1 = min(u.get("cw1", 0), u.get("cw", 0))
    cw5 = u.get("cw", 0) - cw1
    return (u["i"] * p["in"] + u["o"] * p["out"] + u["cr"] * p["cr"]
            + cw5 * p["in"] * P["cacheWrite5m"] + cw1 * p["in"] * P["cacheWrite1h"]) / 1e6


# ───────────────────────── live Claude Code processes ─────────────────────────

def _proc_start(pid):
    try:
        with open(f"/proc/{pid}/stat") as f:
            return int(f.read().rsplit(")", 1)[1].split()[19])   # field 22: start time in clock ticks
    except (OSError, ValueError, IndexError):
        return None


STARTING_SECS = 90   # a claude terminal with no status file this young is still starting (e.g. asking to trust the folder)


def _boot_s():
    try:
        with open("/proc/stat") as f:
            return next(int(l.split()[1]) for l in f if l.startswith("btime "))
    except (OSError, StopIteration, ValueError):
        return 0


BOOT_S, HZ = _boot_s(), os.sysconf("SC_CLK_TCK")


def started_ms(pid):
    """When the process really started (epoch ms).  /proc/<pid>'s ctime is NOT that: it is when the entry was first read."""
    t = _proc_start(pid)
    return int((BOOT_S + t / HZ) * 1000) if t is not None and BOOT_S else 0


def live_claude_procs(seen_pids=None):
    """session id -> what Claude Code says about its own live process (only if the pid is really alive).
    seen_pids (optional set) collects every live pid that has a status file, whatever its kind."""
    out = {}
    for p in glob.glob(os.path.join(SESS_DIR, "*.json")):
        try:
            with open(p) as f:
                d = json.load(f)
        except (OSError, ValueError):
            continue
        pid, sid = d.get("pid"), d.get("sessionId")
        if not pid or not sid:
            continue
        start = _proc_start(pid)
        if start is None or (d.get("procStart") is not None and str(d["procStart"]) != str(start)):
            continue   # process gone, or the pid was reused by something else
        if seen_pids is not None:
            seen_pids.add(pid)
        out[sid] = {"pid": pid, "sid": sid, "status": d.get("status") or "idle", "waitingFor": d.get("waitingFor"),
                    "kind": d.get("kind") or "", "name": d.get("name") or "", "updatedAt": d.get("statusUpdatedAt") or 0,
                    "startedAt": d.get("startedAt") or 0, "cwd": d.get("cwd") or ""}
    return out


def _procs():
    """pid -> (ppid, tty_nr, argv) for every readable process."""
    out = {}
    for d in glob.glob("/proc/[0-9]*"):
        try:
            with open(d + "/stat") as f:
                rest = f.read().rsplit(")", 1)[1].split()
            with open(d + "/cmdline", "rb") as f:
                argv = [a.decode("utf-8", "replace") for a in f.read().split(b"\0") if a]
        except (OSError, IndexError):
            continue
        out[int(d[6:])] = (int(rest[1]), int(rest[4]), argv)
    return out


def _is_claude(argv):
    base = [os.path.basename(a) for a in argv[:2]]
    return bool(base) and (base[0] == "claude" or (base[0] in ("node", "bun") and base[1:2] == ["claude"]))


def unlisted_claude_terminals(procs, known):
    """Claude processes with a terminal that have not written ~/.claude/sessions/<pid>.json (yet): a Claude that is
    still starting up (the file only appears after the folder-trust prompt), or a version that never writes it."""
    out = []
    for pid, (ppid, tty, argv) in procs.items():
        if not tty or pid in known or not _is_claude(argv) or (ppid in procs and _is_claude(procs[ppid][2])):
            continue
        if any(a in ("-p", "--print") for a in argv[1:]):
            continue                                   # headless run, not a terminal tab
        try:
            cwd = os.readlink(f"/proc/{pid}/cwd")
        except OSError:
            continue
        started = started_ms(pid)
        out.append({"pid": pid, "cwd": cwd, "startedAt": started})
    return out


def _is_codex(argv):
    return any(os.path.basename(a) == "codex" or a.endswith("/bin/codex") for a in argv[:2])


def live_codex_procs(procs=None):
    """One entry per terminal running Codex: the top-most codex process that has a terminal (the npm `node` wrapper
    and its native child are ONE tab), plus the rollout file held open anywhere in its process tree."""
    procs = procs if procs is not None else _procs()
    kids = {}
    for pid, (ppid, _, _) in procs.items():
        kids.setdefault(ppid, []).append(pid)
    out = []
    for pid, (ppid, tty, argv) in procs.items():
        if not tty or not _is_codex(argv) or (ppid in procs and _is_codex(procs[ppid][2])):
            continue                                   # no terminal (daemon) or not the top of a codex tree
        if any(a in ("exec", "app-server", "mcp", "mcp-server", "proto") for a in argv[1:3]):
            continue
        path, stack = None, [pid]
        while stack and not path:
            p = stack.pop()
            stack.extend(kids.get(p, []))
            try:
                for fd in os.listdir(f"/proc/{p}/fd"):
                    try:
                        t = os.readlink(f"/proc/{p}/fd/{fd}")
                    except OSError:
                        continue
                    if t.startswith(CODEX_ROOT) and codex_sid(t):
                        path = t
                        break
            except OSError:
                pass
        try:
            cwd = os.readlink(f"/proc/{pid}/cwd")
        except OSError:
            cwd = ""
        started = started_ms(pid)
        out.append({"pid": pid, "path": path, "sid": codex_sid(path) if path else None, "cwd": cwd, "startedAt": started})
    return out


# ───────────────────────── per-session monitor ─────────────────────────

SUB_KEEP_DONE_MS = 15 * 60 * 1000   # keep finished sub-agents in the roster this long
SUB_STALL_MS = 60 * 1000            # sub-agent silent this long while its session is idle = stopped


def activity(g, busy):
    """What an agent is doing right now -> {kind, text, since}. kind: a tool kind | think | say | done | idle"""
    pend = list(g["pending"].values())
    if pend:
        name, kind, summ, t = max(pend, key=lambda x: x[3])
        more = f"  (+{len(pend) - 1} more)" if len(pend) > 1 else ""
        return {"kind": kind, "text": clip(summ, 110) + more, "since": t}
    if g["done"]:
        return {"kind": "done", "text": clip(g["last_say"] or "finished", 160), "since": g["end_t"] or g["last_t"]}
    if busy and g["last_kind"] != "say":
        return {"kind": "think", "text": "thinking…", "since": g["last_t"]}
    return {"kind": "say" if busy else "idle", "text": clip(g["last_say"] or ("working…" if busy else "idle"), 160), "since": g["last_t"]}


class Monitor:
    def __init__(self, sess, path):
        self.sess, self.path, self.src, self.id = sess, path, sess.src, sess.sid
        self.key = (self.src, self.id)
        self.title = self.cwd = self.branch = ""
        self.model = ""
        self.tot = {"i": 0, "cw": 0, "cr": 0, "o": 0, "th": 0}
        self.cost, self.unpriced = 0.0, False
        self.ctx = self.trips = 0
        self.pending = {}          # main-agent tool calls without a result yet: id -> (name, kind, t)
        self.subs = {}             # sub-agent id -> {label, done}
        self.agents = {}           # agent id ('main' or sub) -> live per-agent state, see _agent()
        self.last_kind, self.last_say, self.last_prompt = "", "", ""
        self.first_t = self.last_t = 0
        self._meta_at = 0.0

    def _agent(self, a):
        g = self.agents.get(a)
        if g is None:
            g = self.agents[a] = {"label": "", "atype": "", "done": False, "pending": {}, "trips": 0, "tok": 0,
                                  "cost": 0.0, "model": "", "last_say": "", "last_kind": "", "start_t": 0, "last_t": 0, "end_t": 0,
                                  "kinds": []}
        return g

    def feed(self, evs):
        for e in evs:
            k, a = e["k"], e["a"]
            g = self._agent(a)
            g["start_t"] = g["start_t"] or e["t"]
            g["last_t"] = max(g["last_t"], e["t"])
            if k == "usage":
                g["tok"] += e["i"] + e["cw"] + e["cr"] + e["o"]
                g["cost"] += cost_of(e.get("model"), e) or 0.0
                g["model"] = e.get("model") or g["model"]
            elif k == "spawn":
                g["label"], g["atype"] = e.get("label") or g["label"], e.get("atype") or g["atype"]
                g["model"] = e.get("model") or g["model"]
            elif k == "done":
                g["done"], g["end_t"] = True, e["t"]
                g["pending"].clear()
            elif k == "tool":
                if g["done"] and e["name"] != "SubagentHandback":   # a finished sub-agent picked up new work (e.g. resumed)
                    g["done"], g["end_t"] = False, 0
                    if a in self.subs:
                        self.subs[a]["done"] = False
                g["pending"][e["id"]] = (e["name"], e["kind"], e.get("sum") or e["name"], e["t"])
                g["trips"] += 1
                g["last_kind"] = "tool"
                g["kinds"] = (g["kinds"] + [e["kind"]])[-8:]
            elif k == "result":
                g["pending"].pop(e["id"], None)
                g["last_kind"] = "result"
            elif k == "say":
                g["last_say"], g["last_kind"] = e["text"], "say"
            elif k in ("prompt", "brief"):
                g["last_kind"] = k
            self.first_t = self.first_t or e["t"]
            self.last_t = max(self.last_t, e["t"])
            if k == "usage":
                for f in self.tot:
                    self.tot[f] += e.get(f, 0)
                c = cost_of(e.get("model"), e)
                if c is None:
                    self.unpriced = self.unpriced or (e["i"] + e["cr"] + e["o"] > 0)
                else:
                    self.cost += c
                if a == "main":
                    self.model = e.get("model") or self.model
                    self.ctx = e["i"] + e["cw"] + e["cr"] or self.ctx
            elif k == "spawn":
                self.subs.setdefault(a, {"label": e.get("label", ""), "done": False})
            elif k == "done":
                if a in self.subs:
                    self.subs[a]["done"] = True
            elif k == "tool":
                self.trips += 1
                if a == "main":
                    self.pending[e["id"]] = (e["name"], e["kind"], e["t"])
                    self.last_kind = "tool"
            elif a == "main":
                if k == "result":
                    self.pending.pop(e["id"], None)
                    self.last_kind = "result"
                elif k == "say":
                    self.last_say, self.last_kind = e["text"], "say"
                elif k == "prompt":
                    self.last_prompt, self.last_kind = e["text"], "prompt"

    def poll(self):
        self.feed(self.sess.poll())
        if time.time() - self._meta_at > 45:
            self._meta_at = time.time()
            try:
                t, c, b = describe_claude(self.path) if self.src == "claude" else describe_codex(self.path)
                self.title, self.cwd, self.branch = t or self.title, c or self.cwd, b or self.branch
            except Exception:
                pass

    def state(self, now_ms, proc):
        """-> (status, reason).  status: working | attention | ready"""
        quiet = (now_ms - self.last_t) / 1000 if self.last_t else 1e9
        active = sum(1 for s in list(self.subs.values()) if not s["done"])
        if proc and proc["kind"] in ("", "interactive"):
            if proc["status"] == "waiting":
                return "attention", proc.get("waitingFor") or "waiting for you in its terminal"
            if proc["status"] == "busy":
                return "working", f"{active} sub-agent{'s' if active != 1 else ''} running" if active else "working"
            return "ready", "done — waiting for your next instruction"
        pend = list(self.pending.values())
        if self.src == "claude":                     # no live terminal: nobody can be waiting on a prompt
            if quiet < CLOSED_MOVING_SECS:
                return "working", "still writing (started outside this dashboard)"
            return "ready", "terminal closed — resumable"
        # Codex (no process info): infer from the log
        if any(n in ("AskUserQuestion", "ExitPlanMode") for n, _, _ in pend):
            return "attention", "asking you a question"
        if pend:
            return "working", "running " + ", ".join(sorted({n for n, _, _ in pend})[:3])
        if active:
            return "working", f"{active} sub-agents running"
        if self.last_kind == "say" and quiet >= QUIET_READY_SECS:
            return "ready", "done — waiting for your next instruction"
        if self.last_kind in ("prompt", "result") and quiet < 120:
            return "working", "thinking"
        return "ready", "idle"

    def snapshot(self, now_ms, proc):
        status, reason = self.state(now_ms, proc)
        active = sum(1 for s in list(self.subs.values()) if not s["done"])
        total = sum(self.tot.values())
        return {
            "src": self.src, "id": self.id, "title": self.title or "(untitled)", "cwd": self.cwd, "branch": self.branch,
            "status": status, "reason": reason, "model": self.model, "ctx": self.ctx,
            # "reported" = Claude Code's own status file said so; "guessed" = inferred from the log
            "evidence": "reported" if proc and proc["kind"] in ("", "interactive") else "guessed",
            "tokens": dict(self.tot, total=total), "cost": round(self.cost, 4), "unpriced": self.unpriced,
            "trips": self.trips, "subs": {"total": len(self.subs), "active": active},
            "last_say": clip(self.last_say, 400), "last_prompt": clip(self.last_prompt, 240),
            "first_t": self.first_t, "last_t": self.last_t,
            "terminal_open": bool(proc and proc["kind"] in ("", "interactive")) if self.src == "claude" else None,
            "pid": proc["pid"] if proc else None,
            "now_doing": activity(self._agent("main"), status == "working"),
            "main_trips": self._agent("main")["trips"], "last_kinds": list(self._agent("main")["kinds"]),
            "agents": self.roster(now_ms, status),
        }

    def roster(self, now_ms, status):
        out = []
        for aid, g in list(self.agents.items()):
            if aid == "main" or aid not in self.subs:
                continue
            if g["done"]:
                state = "done"
                if now_ms - (g["end_t"] or g["last_t"]) > SUB_KEEP_DONE_MS:
                    continue
            elif status != "working" and now_ms - g["last_t"] > SUB_STALL_MS:
                state = "stopped"
            else:
                state = "working"
            out.append({"id": aid, "label": g["label"] or self.subs[aid]["label"] or "sub-agent", "atype": g["atype"],
                        "state": state, "doing": activity(g, state == "working"), "trips": g["trips"], "tok": g["tok"],
                        "cost": round(g["cost"], 4), "model": g["model"], "start_t": g["start_t"],
                        "end_t": g["end_t"] or (g["last_t"] if state != "working" else 0)})
        order = {"working": 0, "stopped": 1, "done": 2}
        out.sort(key=lambda x: (order[x["state"]], -x["start_t"]))
        return out[:12]


# ───────────────────────── the fleet ─────────────────────────

class Fleet:
    def __init__(self, closed=False):
        self.mons, self.procs, self.lock = {}, {}, threading.Lock()
        self.codex_procs, self.tabs = [], []
        self.closed = closed        # also monitor sessions whose terminal is gone (server --closed)
        self.warm = False
        self._err_at = 0.0

    def _candidates(self):
        now, items = time.time(), []
        for p in glob.glob(os.path.join(CLAUDE_ROOT, "*", "*.jsonl")):
            try:
                m = last_touch(p)
            except OSError:
                continue
            if now - m < WATCH_SECS:
                items.append(("claude", p, m))
        for p in glob.glob(os.path.join(CODEX_ROOT, "**", "rollout-*.jsonl"), recursive=True):
            try:
                m = os.path.getmtime(p)
            except OSError:
                continue
            if now - m < WATCH_SECS and codex_sid(p):
                items.append(("codex", p, m))
        items.sort(key=lambda x: x[2], reverse=True)
        return items[:MAX_MONITORS]

    def _ensure(self, src, p):
        sid = os.path.basename(p)[:-6] if src == "claude" else codex_sid(p)
        if (src, sid) not in self.mons:
            mon = Monitor(ClaudeSession(p) if src == "claude" else CodexSession(p), p)
            mon.poll()                       # warm-up read happens outside the lock
            with self.lock:
                self.mons[mon.key] = mon
        return (src, sid)

    def tick(self):
        status_pids = set()
        self.procs = live_claude_procs(status_pids)
        allp = _procs()
        self.codex_procs = live_codex_procs(allp)
        wmap = kopictl.wrappers()              # agents running under `kopi` can be typed into from the page
        tabs, keep = [], set()
        for p in self.procs.values():
            if p["kind"] not in ("", "interactive"):
                continue                     # `claude -p` / SDK runs are not terminal tabs
            hits = glob.glob(os.path.join(CLAUDE_ROOT, "*", p["sid"] + ".jsonl"))
            if hits:
                keep.add(self._ensure("claude", hits[0]))
            tabs.append({"src": "claude", "pid": p["pid"], "sid": p["sid"], "name": p["name"], "cwd": p["cwd"],
                         "startedAt": p["startedAt"], "has_log": bool(hits), "proc_status": p["status"],
                         "waitingFor": p["waitingFor"]})
            self._ctl(tabs[-1], allp, wmap)
        for p in unlisted_claude_terminals(allp, status_pids):
            young = time.time() * 1000 - p["startedAt"] < STARTING_SECS * 1000
            tabs.append({"src": "claude", "pid": p["pid"], "sid": None, "name": "", "cwd": p["cwd"], "startedAt": p["startedAt"],
                         "has_log": False, "proc_status": "starting" if young else None,
                         "waitingFor": "starting up: check its screen (it may ask you to trust the folder)" if young else None})
            self._ctl(tabs[-1], allp, wmap)
        for p in self.codex_procs:
            if p["path"]:
                keep.add(self._ensure("codex", p["path"]))
            tabs.append({"src": "codex", "pid": p["pid"], "sid": p["sid"], "name": "", "cwd": p["cwd"],
                         "startedAt": p["startedAt"], "has_log": bool(p["path"]), "proc_status": None, "waitingFor": None})
            self._ctl(tabs[-1], allp, wmap)
        tabs.sort(key=lambda t: (t["startedAt"], t["pid"]))
        self.tabs = tabs
        if self.closed:
            for src, p, _ in self._candidates():
                self._ensure(src, p)
        for mon in list(self.mons.values()):
            # forget a session whose log was deleted, or (without --closed) whose terminal is gone
            if not os.path.exists(mon.path) or (not self.closed and mon.key not in keep):
                with self.lock:
                    self.mons.pop(mon.key, None)
                continue
            mon.poll()
        self.warm = True

    def loop(self):
        while True:
            try:
                self.tick()
            except Exception as e:           # keep the dashboard alive; report at most every 30 s
                if time.time() - self._err_at > 30:
                    self._err_at = time.time()
                    print(f"[fleet] tick failed: {type(e).__name__}: {e}", file=sys.stderr)
            time.sleep(1.5)

    def start(self):
        threading.Thread(target=self.loop, daemon=True, name="fleet").start()

    @staticmethod
    def _ctl(tab, procs, wmap):
        k = kopictl.kopi_of(tab["pid"], procs, wmap)
        tab["ctl"] = k                               # the kopi pid to talk to, or None (watch only)
        tab["detached"] = bool(k and wmap[k].get("detached"))   # started from the page: no terminal window

    def tab(self, src, pid, sid=None):
        """The open tab (src, pid), refusing if it is not under kopi or its session changed since the UI looked."""
        t = next((t for t in self.tabs if t["src"] == src and t["pid"] == pid), None)
        if not t:
            raise kopictl.KopiError("that terminal is no longer open")
        if sid and t["sid"] and sid != t["sid"]:
            raise kopictl.KopiError("that terminal switched to another session; reload and try again")
        if not t["ctl"]:
            raise kopictl.KopiError("that terminal was opened without kopi, so it can only be watched")
        return t

    def snapshot(self):
        now = int(time.time() * 1000)
        with self.lock:
            mons = list(self.mons.values())
        codex_open = {p["sid"]: p for p in self.codex_procs if p["sid"]}
        sessions = []
        for m in mons:
            snap = m.snapshot(now, self.procs.get(m.id) if m.src == "claude" else None)
            if m.src == "codex":
                snap["terminal_open"] = m.id in codex_open
            sessions.append(snap)
        count = {"claude": sum(t["src"] == "claude" for t in self.tabs), "codex": sum(t["src"] == "codex" for t in self.tabs)}
        return {"now": now, "warm": self.warm, "closed": self.closed, "count": count,
                "tabs": list(self.tabs), "sessions": sessions}


FLEET = Fleet()
