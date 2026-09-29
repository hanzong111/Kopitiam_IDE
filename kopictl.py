"""Server side of kopi: find agents running under `kopi` (see kopi.py) and type into them.

Every kopi process leaves ~/.kopitiam/sock/<pid>.sock (+ <pid>.json).  An open agent terminal is chattable when
one of its ancestors is such a kopi process: plain `claude` / `codex` with the shell hook installed, or an agent
started from the page (+ Claude / + Codex), which runs under a kopi of its own with no terminal window.
"""
import base64
import glob
import json
import os
import socket
import subprocess
import sys
import threading
import time

from kopi import ARROWS, KEYS, SOCK_DIR, installed, proc_start

HERE = os.path.dirname(os.path.abspath(__file__))
KOPI = os.path.join(HERE, "kopi.py")
KEY_NAMES = set(KEYS) | set(ARROWS)
last_send = 0.0     # when a message was last typed in: the log streams poll faster for a moment after


class KopiError(Exception):
    pass


def wrappers():
    """kopi pid -> its meta, for every live kopi (stale files of dead ones are removed)."""
    out = {}
    for p in glob.glob(os.path.join(SOCK_DIR, "*.json")):
        try:
            with open(p) as f:
                m = json.load(f)
            pid = int(m["pid"])
        except (OSError, ValueError, KeyError, TypeError):
            continue
        if proc_start(pid) is None or (m.get("start") is not None and proc_start(pid) != m["start"]):
            for q in (p, p[:-5] + ".sock"):      # the kopi is gone (or its pid was reused)
                try:
                    os.unlink(q)
                except OSError:
                    pass
            continue
        out[pid] = m
    return out


def kopi_of(pid, procs, wmap):
    """The kopi pid that `pid` runs under, or None.  procs: pid -> (ppid, ...)."""
    for _ in range(64):
        if not pid or pid <= 1:
            return None
        if pid in wmap:
            return pid
        pid = procs.get(pid, (0,))[0]
    return None


def _connect(kpid, timeout):
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    s.settimeout(timeout)
    try:
        s.connect(os.path.join(SOCK_DIR, f"{int(kpid)}.sock"))
    except OSError:
        s.close()
        raise KopiError("that agent is no longer running")
    return s


def _call(kpid, msg, timeout=3.0):
    """Send one request, wait for its one-line reply."""
    s = _connect(kpid, timeout)
    try:
        s.sendall((json.dumps(msg) + "\n").encode())
        buf = b""
        while b"\n" not in buf:
            chunk = s.recv(65536)
            if not chunk:
                raise KopiError("the agent closed the connection")
            buf += chunk
        reply = json.loads(buf.split(b"\n", 1)[0])
    except (OSError, ValueError) as e:
        raise KopiError(f"could not reach the agent: {e}")
    finally:
        s.close()
    if not reply.get("ok", True):
        raise KopiError(reply.get("error") or "refused")
    return reply


def send_text(kpid, text):
    global last_send
    _call(kpid, {"op": "text", "text": text})
    last_send = time.time()


def send_key(kpid, key):
    if key not in KEY_NAMES:
        raise KopiError(f"key not allowed: {key}")
    _call(kpid, {"op": "key", "key": key})


def send_input(kpid, data_b64):
    try:
        raw = base64.b64decode(data_b64, validate=True)
    except ValueError:
        raise KopiError("input must be base64")
    if not raw or len(raw) > 32 * 1024:
        raise KopiError("input must be 1-32768 bytes")
    _call(kpid, {"op": "input", "data": data_b64})


def resize(kpid, cols, rows):
    _call(kpid, {"op": "resize", "cols": int(cols), "rows": int(rows)})


def watch(kpid, idle=15.0):
    """Yield the agent's messages (hello, out, exit) as they come; {"op": "ping"} after `idle` quiet seconds."""
    s = _connect(kpid, idle)
    try:
        s.sendall(b'{"op": "watch"}\n')
        buf = b""
        while True:
            try:
                chunk = s.recv(262144)
            except socket.timeout:
                yield {"op": "ping"}
                continue
            if not chunk:
                return
            buf += chunk
            while b"\n" in buf:
                line, buf = buf.split(b"\n", 1)
                yield json.loads(line)
    finally:
        s.close()


def new_agent(src, cwd):
    """Start claude / codex under a kopi with no terminal window -> the kopi pid."""
    import shutil
    if not shutil.which("claude" if src == "claude" else "codex"):
        raise KopiError(f"`{src}` is not on PATH")
    if not os.path.isdir(cwd):
        raise KopiError("that folder does not exist")
    p = subprocess.Popen([sys.executable, KOPI, "--detach", src], cwd=cwd, start_new_session=True,
                         stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    threading.Thread(target=p.wait, daemon=True).start()   # reap it when it exits (it outlives the server otherwise)
    return p.pid


def hook_installed():
    return installed()
