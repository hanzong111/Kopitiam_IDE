"""Session-log adapters: turn Claude Code / Codex logs into ONE normalized event stream.

Event shape (see `ev()`): {k, a, t, ...}  k = prompt|spawn|brief|tool|result|say|usage|done,
a = agent id ('main' or the spawning tool_use id), t = epoch ms. Add a new tool = add an adapter
class with poll() returning these events. Read-only: never writes to the logs.
"""
import datetime as dt
import glob
import json
import os
import re
import time


HOME = os.path.expanduser("~")
CLAUDE_ROOT = os.path.join(HOME, ".claude", "projects")
CODEX_ROOT = os.path.join(HOME, ".codex", "sessions")
WEB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web")

MAX_FIRST_READ = 24 * 1024 * 1024   # tail only the last 24 MB of a huge log
MAX_TEXT = 100_000                  # replies and prompts are shown in full in the chat; this only guards against runaway blobs
HANDBACK = "SubagentHandback"        # the tool a sub-agent calls to return its final report
QUIET_DONE_SECS = 4.0               # sub-agent with a text-only last message + this much silence = finished
LIVE_SECS = 90                      # a session touched within this window is "live"
ID_RE = re.compile(r"^[A-Za-z0-9._-]{8,80}$")


# ───────────────────────── helpers ─────────────────────────

def clip(s, n):
    s = s if isinstance(s, str) else json.dumps(s, ensure_ascii=False)
    return s if len(s) <= n else s[: n - 1] + "…"


def iso_ms(s):
    try:
        return int(dt.datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp() * 1000)
    except Exception:
        return int(time.time() * 1000)


def ev(k, agent, t, **kw):
    """The one normalized event. k=event type, a=agent id, t=epoch ms; everything else is per-type.
    (`kind` is reserved for the tool category: read/run/edit/web/delegate/other.)"""
    d = {"k": k, "a": agent, "t": t}
    d.update(kw)
    return d


def tail_path(p, parts=2):
    bits = [b for b in re.split(r"[\\/]", p) if b]
    return "/".join(bits[-parts:]) if bits else p


class Tail:
    """Incremental JSONL reader: yields only complete new lines, survives truncation."""

    def __init__(self, path):
        self.path, self.pos, self.buf, self.first = path, 0, b"", True

    def read_new(self):
        try:
            size = os.path.getsize(self.path)
        except OSError:
            return []
        if size < self.pos:
            self.pos, self.buf = 0, b""
        if self.first and size > MAX_FIRST_READ:
            self.pos = size - MAX_FIRST_READ
            self.buf = b"\0"  # marks "first partial line must be dropped"
        if size == self.pos:
            self.first = False
            return []
        try:
            with open(self.path, "rb") as f:
                f.seek(self.pos)
                data = f.read()
        except OSError:
            return []
        self.pos += len(data)
        chunks = (self.buf + data).split(b"\n")
        if self.first and self.buf == b"\0":
            chunks = chunks[1:]
        self.first = False
        self.buf = chunks[-1]
        out = []
        for ln in chunks[:-1]:
            if ln.strip():
                try:
                    out.append(json.loads(ln))
                except ValueError:
                    pass
        return out


# ───────────────────────── Claude Code adapter ─────────────────────────

def classify_claude(name):
    if name in ("Read", "Grep", "Glob", "LS", "NotebookRead"):
        return "read"
    if name in ("Edit", "Write", "NotebookEdit", "MultiEdit"):
        return "edit"
    if name in ("Bash", "BashOutput", "KillShell", "Monitor", "TaskStop"):
        return "run"
    if name in ("WebSearch", "WebFetch"):
        return "web"
    if name in ("Agent", "Task", "SendMessage", "Workflow"):
        return "delegate"
    return "other"


def summarize_claude(name, inp):
    if not isinstance(inp, dict):
        return name
    if name in ("Read", "Edit", "Write", "NotebookEdit", "MultiEdit"):
        return f"{name} {tail_path(inp.get('file_path') or inp.get('notebook_path') or '')}"
    if name == "Bash":
        return clip(inp.get("description") or (inp.get("command") or "").strip().split("\n")[0], 90)
    if name == "Grep":
        return clip(f"grep {inp.get('pattern', '')} {tail_path(inp.get('path') or '')}".strip(), 90)
    if name == "Glob":
        return clip(f"glob {inp.get('pattern', '')}", 90)
    if name == "WebSearch":
        return clip(f"search: {inp.get('query', '')}", 90)
    if name == "WebFetch":
        return clip(f"fetch {re.sub(r'^https?://', '', inp.get('url', ''))}", 90)
    if name in ("Agent", "Task"):
        return clip(inp.get("description") or inp.get("subagent_type") or "delegate", 90)
    label = name.replace("mcp__", "").replace("__", "/")
    first = next((v for v in inp.values() if isinstance(v, str) and v), "")
    return clip(f"{label} {first}".strip(), 90)


DIFF_FILE_LINES = 120                # per file; the terminal shows fewer, the page can afford a little more
DIFF_FILES = 8


def diff_of(tur):
    """The file changes Claude Code shows under a tool call (Edit, Write, or a shell command that edited files):
    [{"f": path, "l": ["+added", "-removed", " context", ...], "more": lines left out}], plus how many files
    were changed but not included.  None when the call changed nothing."""
    if not isinstance(tur, dict):
        return None
    files, more = [], 0
    bd = tur.get("bashEditDiff")
    if isinstance(bd, dict):
        files = [(f.get("filePath"), f.get("hunks") or []) for f in bd.get("files") or [] if isinstance(f, dict)]
        try:
            more = int(bd.get("moreFiles") or 0)
        except (TypeError, ValueError):
            more = 0
        more = max(more, len(bd.get("changedFiles") or []) - len(files))
    elif tur.get("filePath") and (tur.get("structuredPatch") or tur.get("type") == "create"):
        hunks = tur.get("structuredPatch") or []
        if not hunks and isinstance(tur.get("content"), str):     # a new file: every line is an addition
            hunks = [{"lines": ["+" + x for x in tur["content"].split("\n")]}]
        files = [(tur["filePath"], hunks)]
    out = []
    for path, hunks in files[:DIFF_FILES]:
        lines = []
        for i, h in enumerate(hunks):
            if i:
                lines.append("⋯")
            lines.extend(x for x in (h.get("lines") or []) if isinstance(x, str))
        if lines or path:
            out.append({"f": path or "?", "l": [clip(x, 300) for x in lines[:DIFF_FILE_LINES]],
                        "more": max(0, len(lines) - DIFF_FILE_LINES)})
    more += max(0, len(files) - DIFF_FILES)
    return {"files": out, "more": more} if out or more else None


def blocks_of(message):
    c = (message or {}).get("content")
    if isinstance(c, str):
        return [{"type": "text", "text": c}]
    return c if isinstance(c, list) else []


class ClaudeSession:
    src = "claude"

    def __init__(self, path):
        self.path = path
        self.sid = os.path.basename(path)[:-6]
        self.subdir = os.path.join(path[:-6], "subagents")
        self.main = Tail(path)
        self.subs = {}          # file path -> (Tail, agent id)
        self.aid2tu = {}        # subagent file id -> tool_use id (our agent id)
        self.sub_meta = {}      # tool_use id -> contents of agent-*.meta.json
        self.sub_announced = set()
        self.usage_seen = {}    # message id -> usage fields already counted
        self.spawned = set()    # tool_use ids of Agent calls
        self.first_user = set() # agents whose delegated prompt was already emitted
        self.finished = set()
        self.maybe_final = {}   # agent -> (msg id) whose text-only message might be the last one
        self.msg_has_tool = set()
        self.thought = set()    # message ids whose thinking was already emitted

    # -- record -> events
    def records(self, rec, agent):
        t, ts, m = rec.get("type"), iso_ms(rec.get("timestamp") or ""), rec.get("message") or {}
        if t == "assistant":
            mid = m.get("id")
            for b in blocks_of(m):
                bt = b.get("type")
                if bt in ("thinking", "redacted_thinking") and mid not in self.thought:
                    # the reasoning text never reaches the transcript (the block is empty); only its size does
                    self.thought.add(mid)
                    th = ((m.get("usage") or {}).get("output_tokens_details") or {}).get("thinking_tokens", 0) or 0
                    yield ev("think", agent, ts, id=mid, n=th)
                elif bt == "text" and (b.get("text") or "").strip():
                    yield ev("say", agent, ts, text=clip(b["text"].strip(), MAX_TEXT))
                elif bt == "tool_use":
                    name, inp = b.get("name", "?"), b.get("input") or {}
                    self.msg_has_tool.add(mid)
                    if name in ("Agent", "Task"):
                        self.spawned.add(b["id"])
                        yield ev("spawn", b["id"], ts, parent=agent, label=clip(inp.get("description") or "sub-agent", 120),
                                 atype=inp.get("subagent_type") or "general-purpose",
                                 model=inp.get("model") or "", brief=clip(inp.get("prompt") or "", 6000))
                    if name != HANDBACK:
                        self.finished.discard(agent)                 # new work: a later finish counts again (resumed sub-agent)
                    yield ev("tool", agent, ts, id=b["id"], name=name, kind=classify_claude(name),
                             sum=summarize_claude(name, inp), inp=clip(inp, 1800))
                    if name == HANDBACK and agent != "main":         # a sub-agent handing its report back has finished
                        yield from self.finish(agent, ts)
            u = m.get("usage")
            if u and mid:
                cc = u.get("cache_creation") or {}
                cur = {
                    "i": u.get("input_tokens", 0) or 0,
                    "cw": u.get("cache_creation_input_tokens", 0) or 0,
                    "cw1": cc.get("ephemeral_1h_input_tokens", 0) or 0,
                    "cr": u.get("cache_read_input_tokens", 0) or 0,
                    "o": u.get("output_tokens", 0) or 0,
                    "th": (u.get("output_tokens_details") or {}).get("thinking_tokens", 0) or 0,
                }
                seen = self.usage_seen.setdefault(mid, {k: 0 for k in cur})
                delta = {k: max(0, cur[k] - seen[k]) for k in cur}   # one API reply = several records
                for k in cur:
                    seen[k] = max(seen[k], cur[k])
                if any(delta.values()):
                    yield ev("usage", agent, ts, model=m.get("model") or "", **delta)
            sr = m.get("stop_reason")
            if agent != "main":
                if sr in ("end_turn", "stop_sequence", "max_tokens"):
                    yield from self.finish(agent, ts)
                elif mid not in self.msg_has_tool and any(b.get("type") == "text" for b in blocks_of(m)):
                    self.maybe_final[agent] = mid
                else:
                    self.maybe_final.pop(agent, None)
        elif t == "user":
            origin = (rec.get("origin") or {}) if isinstance(rec.get("origin"), dict) else {}
            content, text_parts = blocks_of(m), []
            tur = rec.get("toolUseResult")
            for b in content:
                if b.get("type") == "tool_result":
                    body = b.get("content")
                    if isinstance(body, list):
                        body = "".join(x.get("text", "") for x in body if isinstance(x, dict))
                    body = body if isinstance(body, str) else json.dumps(body, ensure_ascii=False)
                    extra = {}
                    diff = diff_of(tur) if len([x for x in content if x.get("type") == "tool_result"]) == 1 else None
                    if diff:
                        extra["diff"] = diff
                    yield ev("result", agent, ts, id=b.get("tool_use_id"), err=bool(b.get("is_error")),
                             n=len(body), txt=clip(body, 700), **extra)
                    self.maybe_final.pop(agent, None)
                    # a foreground (non-async) Agent call returning = that sub-agent is done
                    if b.get("tool_use_id") in self.spawned and isinstance(tur, dict) and not tur.get("isAsync"):
                        yield from self.finish(b["tool_use_id"], ts)
                elif b.get("type") == "text":
                    text_parts.append(b.get("text") or "")
            text = "\n".join(text_parts).strip()
            if not text or rec.get("isMeta") and origin.get("kind") != "peer":
                return
            kind = origin.get("kind")
            if agent == "main":
                if kind == "human" or (kind is None and not text.startswith("<")):
                    yield ev("prompt", "main", ts, text=clip(text, MAX_TEXT))
                elif kind == "peer" and origin.get("from") in self.aid2tu:
                    yield from self.finish(self.aid2tu[origin["from"]], ts)
                elif kind == "task-notification":
                    mt = re.search(r"<task-id>([^<]+)</task-id>", text)
                    if mt and mt.group(1) in self.aid2tu:
                        yield from self.finish(self.aid2tu[mt.group(1)], ts)
            elif agent not in self.first_user:
                self.first_user.add(agent)
                yield ev("brief", agent, ts, text=clip(text, 6000))

    def finish(self, agent, ts):
        if agent not in self.finished:
            self.finished.add(agent)
            yield ev("done", agent, ts)

    # -- poll all files
    def poll(self):
        out = []
        for rec in self.main.read_new():
            out.extend(self.records(rec, "main"))
        if os.path.isdir(self.subdir):
            for p in sorted(glob.glob(os.path.join(self.subdir, "agent-*.jsonl"))):
                if p not in self.subs:
                    aid = os.path.basename(p)[6:-6]
                    meta_p = p[:-6] + ".meta.json"
                    meta = {}
                    try:
                        with open(meta_p) as f:
                            meta = json.load(f)
                    except (OSError, ValueError):
                        if time.time() - os.path.getmtime(p) < 2.0:
                            continue  # meta not written yet, retry next tick
                    tu = meta.get("toolUseId") or aid
                    self.aid2tu[aid] = tu
                    self.subs[p] = (Tail(p), tu)
                    self.sub_meta[tu] = meta
                tail, tu = self.subs[p]
                recs = tail.read_new()
                if recs and tu not in self.spawned and tu not in self.sub_announced:
                    # the parent's Agent call isn't in the main log (truncated/nested): announce from the file itself
                    self.sub_announced.add(tu)
                    meta = self.sub_meta.get(tu, {})
                    out.append(ev("spawn", tu, iso_ms(recs[0].get("timestamp") or ""), parent="main",
                                  label=clip(meta.get("description") or "sub-agent", 120),
                                  atype=meta.get("agentType") or "general-purpose", model="", brief=""))
                for rec in recs:
                    out.extend(self.records(rec, tu))
                # quiet-timeout fallback: last message was text-only and the file went silent
                mid = self.maybe_final.get(tu)
                if mid and tu not in self.finished and time.time() - os.path.getmtime(p) > QUIET_DONE_SECS:
                    out.extend(self.finish(tu, int(os.path.getmtime(p) * 1000)))
        out.sort(key=lambda e: e["t"])
        return out


# ───────────────────────── Codex adapter ─────────────────────────

def classify_codex(name, body):
    text = body if isinstance(body, str) else json.dumps(body)
    if "apply_patch" in text or name == "apply_patch":
        return "edit"
    if re.search(r"\b(curl|wget|http[s]?://)", text):
        return "web"
    if re.search(r"\b(rg|grep|cat|sed|ls|find|head|tail|fd|tree)\b", text):
        return "read"
    return "run"


def codex_text(content):
    if isinstance(content, str):
        return content
    return "\n".join(c.get("text", "") for c in content or [] if isinstance(c, dict))


CODEX_SID_RE = re.compile(r"([0-9a-f]{8}-[0-9a-f-]{20,})\.jsonl$")


def codex_sid(path):
    m = CODEX_SID_RE.search(os.path.basename(path))
    return m.group(1) if m else None


class CodexSession:
    src = "codex"

    def __init__(self, path):
        self.path = path
        self.sid = codex_sid(path) or os.path.basename(path)[:-6]
        self.tail = Tail(path)
        self.model = ""
        self.seen_usage = set()

    def poll(self):
        out = []
        for rec in self.tail.read_new():
            ts = iso_ms(rec.get("timestamp") or "")
            t = rec.get("type")
            p = rec.get("payload") if isinstance(rec.get("payload"), dict) else rec
            pt = p.get("type")
            if t == "turn_context":
                self.model = p.get("model") or self.model
            elif t == "response_item" and pt == "message":
                text = codex_text(p.get("content")).strip()
                if p.get("role") == "assistant" and text:
                    out.append(ev("say", "main", ts, text=clip(text, MAX_TEXT)))
                elif p.get("role") == "user" and text and not text.startswith("<"):
                    out.append(ev("prompt", "main", ts, text=clip(text, MAX_TEXT)))
            elif t == "response_item" and pt in ("function_call", "custom_tool_call"):
                name = p.get("name", "?")
                body = p.get("arguments") if pt == "function_call" else p.get("input")
                kind = classify_codex(name, body)
                first = (body if isinstance(body, str) else json.dumps(body)).strip().replace("\n", " ")
                out.append(ev("tool", "main", ts, id=p.get("call_id"), name=name, kind=kind,
                              sum=clip(f"{name}: {first}", 90), inp=clip(body, 1800)))
            elif t == "response_item" and pt in ("function_call_output", "custom_tool_call_output"):
                o = p.get("output")
                body = codex_text(o) if isinstance(o, list) else (o if isinstance(o, str) else json.dumps(o))
                out.append(ev("result", "main", ts, id=p.get("call_id"), err=False, n=len(body), txt=clip(body, 700)))
            elif t == "token_usage_record":
                rid = p.get("response_id")
                if rid in self.seen_usage:
                    continue
                self.seen_usage.add(rid)
                u = p.get("usage") or {}
                cached, cw = u.get("cached_input_tokens", 0) or 0, u.get("cache_write_input_tokens", 0) or 0
                inp = u.get("input_tokens", 0) or 0
                # OpenAI counts cached tokens inside input_tokens; split them out to match the Claude shape
                out.append(ev("usage", "main", ts, model=self.model, i=max(0, inp - cached - cw), cw=cw, cw1=0, cr=cached,
                              o=u.get("output_tokens", 0) or 0, th=u.get("reasoning_output_tokens", 0) or 0))
        return out


# ───────────────────────── session discovery ─────────────────────────

def read_head_tail(path, n=96 * 1024):
    try:
        size = os.path.getsize(path)
        with open(path, "rb") as f:
            head = f.read(n)
            f.seek(max(0, size - n))
            tail = f.read()
        return head.decode("utf-8", "ignore"), tail.decode("utf-8", "ignore")
    except OSError:
        return "", ""


def last_touch(path):
    m = os.path.getmtime(path)
    sub = os.path.join(path[:-6], "subagents")
    if os.path.isdir(sub):
        for p in glob.glob(os.path.join(sub, "agent-*.jsonl")):
            m = max(m, os.path.getmtime(p))
    return m


def describe_claude(path):
    head, tail = read_head_tail(path)
    title = cwd = branch = ""
    for line in reversed(tail.splitlines()):
        if '"ai-title"' in line:
            try:
                title = json.loads(line).get("aiTitle", "")
                break
            except ValueError:
                pass
    for line in head.splitlines():
        if '"cwd"' in line:
            try:
                d = json.loads(line)
                cwd, branch = d.get("cwd", ""), d.get("gitBranch", "") or ""
                break
            except ValueError:
                pass
    return title, cwd, branch


def describe_codex(path):
    head, _ = read_head_tail(path, 32 * 1024)
    cwd = ""
    for line in head.splitlines()[:3]:
        try:
            cwd = (json.loads(line).get("payload") or {}).get("cwd", "") or cwd
        except ValueError:
            pass
    return "", cwd, ""


def list_sessions(limit=40):
    items = []
    for p in glob.glob(os.path.join(CLAUDE_ROOT, "*", "*.jsonl")):
        items.append(("claude", p, last_touch(p)))
    for p in glob.glob(os.path.join(CODEX_ROOT, "**", "rollout-*.jsonl"), recursive=True):
        items.append(("codex", p, os.path.getmtime(p)))
    items.sort(key=lambda x: x[2], reverse=True)
    now, out = time.time(), []
    for src, p, m in items[:limit]:
        sid = os.path.basename(p)[:-6] if src == "claude" else codex_sid(p)
        if not sid:
            continue
        title, cwd, branch = describe_claude(p) if src == "claude" else describe_codex(p)
        out.append({"src": src, "id": sid, "title": title or "(untitled)", "cwd": cwd, "branch": branch,
                    "mtime": int(m * 1000), "live": now - m < LIVE_SECS, "path": p})
    return out


def open_session(src, sid):
    if not ID_RE.match(sid):
        return None
    if src == "claude":
        hits = glob.glob(os.path.join(CLAUDE_ROOT, "*", sid + ".jsonl"))
        return ClaudeSession(hits[0]) if hits else None
    if src == "codex":
        hits = glob.glob(os.path.join(CODEX_ROOT, "**", f"rollout-*-{sid}.jsonl"), recursive=True)
        return CodexSession(hits[0]) if hits else None
    return None


