#!/usr/bin/env python3
"""Kopitiam server — HTTP + SSE front for the adapters and the fleet (stdlib only).

    python3 server.py            # http://127.0.0.1:8787
    python3 server.py --port 9000

    python3 server.py --closed   # also list sessions from the last 24 h whose terminal is closed

    python3 server.py --read-only  # never type into agents (hides the composer)

Talking to agents: an agent running under `kopi` (kopi.py; the shell hook makes plain `claude` do that) can be
typed into from the UI, and its terminal output is streamed to the page (/api/term).
Security model (transcripts are private, and POSTs can make an agent act):
  * binds to 127.0.0.1 and rejects any Host header that isn't localhost (DNS-rebinding guard)
  * every POST needs the per-run token from /api/config AND a same-origin Origin header
"""
import argparse
import hmac
import json
import mimetypes
import os
import secrets
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from adapters import CLAUDE_ROOT, CODEX_ROOT, list_sessions, open_session
import kopictl
from fleet import FLEET

WEB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web")
TOKEN = secrets.token_urlsafe(24)
PORT = 8787
CONTROL = True      # typing into agents; off with --read-only


class Handler(BaseHTTPRequestHandler):
    server_version = "Kopitiam/2"

    def log_message(self, *a):  # quiet
        pass

    # -- guards
    def host_ok(self):
        host = (self.headers.get("Host") or "").split(":")[0].strip("[]").lower()
        return host in ("127.0.0.1", "localhost", "::1")

    def origin_ok(self):
        return (self.headers.get("Origin") or "") in (f"http://127.0.0.1:{PORT}", f"http://localhost:{PORT}")

    # -- helpers
    def send_json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if not self.host_ok():
            return self.send_json({"error": "forbidden host"}, 403)
        u = urlparse(self.path)
        if u.path == "/api/sessions":
            return self.send_json(list_sessions())
        if u.path == "/api/fleet":
            return self.send_json(FLEET.snapshot())
        if u.path == "/api/config":
            return self.send_json({"token": TOKEN, "control": CONTROL, "hook": kopictl.hook_installed(),
                                   "readOnly": not CONTROL, "home": os.path.expanduser("~")})
        if u.path == "/api/term":
            q = parse_qs(u.query)
            try:
                t = FLEET.tab((q.get("src") or [""])[0], int((q.get("pid") or ["0"])[0]))
            except (ValueError, kopictl.KopiError) as e:
                return self.send_json({"error": str(e)}, 409)
            return self.term(t["ctl"])
        if u.path == "/api/stream":
            q = parse_qs(u.query)
            return self.stream((q.get("src") or [""])[0], (q.get("id") or [""])[0])
        rel = "index.html" if u.path in ("/", "") else u.path.lstrip("/")
        full = os.path.realpath(os.path.join(WEB, rel))
        if not full.startswith(os.path.realpath(WEB) + os.sep) or not os.path.isfile(full):
            return self.send_json({"error": "not found"}, 404)
        with open(full, "rb") as f:
            body = f.read()
        self.send_response(200)
        self.send_header("Content-Type", (mimetypes.guess_type(full)[0] or "application/octet-stream") + "; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if not self.host_ok():
            return self.send_json({"error": "forbidden host"}, 403)
        if not self.origin_ok() or not hmac.compare_digest(self.headers.get("X-Kopitiam-Token") or "", TOKEN):
            return self.send_json({"error": "missing or wrong token/origin"}, 403)
        if not CONTROL:
            return self.send_json({"error": "the server was started with --read-only"}, 403)
        try:
            n = int(self.headers.get("Content-Length") or 0)
            if n > 64 * 1024:
                return self.send_json({"error": "body too large"}, 413)
            body = json.loads(self.rfile.read(n) or b"{}")
        except (ValueError, OSError):
            return self.send_json({"error": "bad JSON"}, 400)
        path = urlparse(self.path).path
        try:
            if path == "/api/new":
                src, cwd = str(body.get("src", "")), os.path.expanduser(str(body.get("cwd") or "~"))
                if src not in ("claude", "codex"):
                    return self.send_json({"error": "src must be claude or codex"}, 400)
                return self.send_json({"ok": True, "ctl": kopictl.new_agent(src, cwd)}, 201)
            if path in ("/api/send", "/api/key", "/api/input", "/api/resize"):
                t = FLEET.tab(str(body.get("src", "")), int(body.get("pid") or 0), body.get("sid") or None)
                if path == "/api/key":
                    kopictl.send_key(t["ctl"], str(body.get("key", "")))
                    return self.send_json({"ok": True})
                if path == "/api/input":                   # keystrokes typed into the live terminal on the page
                    kopictl.send_input(t["ctl"], str(body.get("data", "")))
                    return self.send_json({"ok": True})
                if path == "/api/resize":                  # only applies to agents started from the page
                    kopictl.resize(t["ctl"], int(body.get("cols") or 0), int(body.get("rows") or 0))
                    return self.send_json({"ok": True})
                text = str(body.get("text", "")).strip()
                if not text or len(text) > 20000:
                    return self.send_json({"error": "message must be 1-20000 characters"}, 400)
                kopictl.send_text(t["ctl"], text)
                return self.send_json({"ok": True})
        except (ValueError, TypeError) as e:
            return self.send_json({"error": f"bad request: {e}"}, 400)
        except kopictl.KopiError as e:
            return self.send_json({"error": str(e)}, 409)
        return self.send_json({"error": "not found"}, 404)

    # -- SSE
    def sse(self, obj):
        self.wfile.write(b"data: " + json.dumps(obj, ensure_ascii=False).encode() + b"\n\n")
        self.wfile.flush()

    def term(self, kpid):
        """SSE: the agent's terminal output (base64 chunks) for the page's xterm.js view."""
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()
        try:
            for msg in kopictl.watch(kpid):
                if msg.get("op") == "ping":
                    self.wfile.write(b": ping\n\n")
                    self.wfile.flush()
                else:
                    self.sse(msg)
                if msg.get("op") == "exit":
                    return
        except kopictl.KopiError as e:
            try:
                self.sse({"op": "error", "error": str(e)})
            except OSError:
                pass
        except (BrokenPipeError, ConnectionResetError, OSError, ValueError):
            return

    def stream(self, src, sid):
        sess = open_session(src, sid)
        if not sess:
            return self.send_json({"error": "session not found"}, 404)
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()
        try:
            events = sess.poll()                               # replay = everything already on disk
            for i in range(0, len(events), 400):
                self.sse({"replay": True, "events": events[i:i + 400]})
            self.sse({"replayDone": True, "count": len(events)})
            idle = 0.0
            while True:
                step = 0.1 if time.time() - kopictl.last_send < 5 else 0.4   # just sent: show the echo fast
                time.sleep(step)
                events = sess.poll()
                if events:
                    idle = 0.0
                    self.sse({"events": events})
                else:
                    idle += step
                    if idle >= 15:
                        self.wfile.write(b": ping\n\n")
                        self.wfile.flush()
                        idle = 0.0
        except (BrokenPipeError, ConnectionResetError, OSError):
            return


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--port", type=int, default=8787)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--read-only", action="store_true", help="never type into agents (no composer)")
    ap.add_argument("--closed", action="store_true",
                    help="also show sessions from the last 24 h whose terminal is closed (off: open terminals only)")
    args = ap.parse_args()
    global PORT, CONTROL
    PORT, CONTROL, FLEET.closed = args.port, not args.read_only, args.closed
    srv = ThreadingHTTPServer((args.host, args.port), Handler)
    srv.daemon_threads = True
    FLEET.start()
    print(f"Kopitiam open for business → http://{args.host}:{args.port}")
    print(f"  reading Claude Code logs: {CLAUDE_ROOT}")
    print(f"  reading Codex logs:       {CODEX_ROOT}")
    print(f"  typing into agents:       {'off (--read-only)' if not CONTROL else 'on, for agents started with kopi' + ('' if kopictl.hook_installed() else ' (shell hook not installed: python3 kopi.py install-shell)')}")
    print(f"  closed sessions:          {'shown (last 24 h)' if args.closed else 'hidden (open terminals only)'}")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nKopitiam closed. Terima kasih!")


if __name__ == "__main__":
    main()
