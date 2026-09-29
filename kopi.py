#!/usr/bin/env python3
"""kopi: run claude / codex exactly as usual, and let the Kopitiam page type into it.

    kopi claude [args...]     what plain `claude` runs once the shell hook is installed (same for codex)
    kopi attach <pid>         show an agent started from the Kopitiam page in this terminal (Ctrl-] detaches)
    kopi install-shell        hook `claude` / `codex` in ~/.zshrc and ~/.bashrc
    kopi uninstall-shell      remove the hook again

How it works: like `script` or asciinema, kopi runs the agent in a pseudo-terminal and copies every byte between
it and your terminal, so it looks and behaves exactly as without kopi (scrollback, mouse, resize, Ctrl-C, Ctrl-Z).
It also listens on a private unix socket, ~/.kopitiam/sock/<pid>.sock (the folder is readable by your user only),
where the Kopitiam server can type a message or a key into the agent, as if you typed it, and watch its output live.

Non-interactive runs (`claude -p ...`, pipes, `claude --version`) are exec'd directly: kopi steps out of the way.
Protocol on the socket: one JSON object per line, both ways (see Kopi.handle).
"""
import base64
import errno
import fcntl
import json
import os
import pty
import re
import select
import shlex
import shutil
import signal
import socket
import struct
import sys
import termios
import time
import tty

HERE = os.path.dirname(os.path.abspath(__file__))
SOCK_DIR = os.path.join(os.path.expanduser("~"), ".kopitiam", "sock")
RING = 1024 * 1024                     # output kept for a page that starts watching late
CLIENT_MAX = 8 * 1024 * 1024           # a watcher this far behind is dropped rather than slowing the agent down
PASTE_SETTLE = float(os.environ.get("KOPITIAM_PASTE_SETTLE") or 0.15)   # seconds between a paste and its Enter
DETACHED_SIZE = (120, 36)              # cols, rows of an agent started from the page, until someone resizes it
KEYS = {"Enter": b"\r", "Escape": b"\x1b", "Tab": b"\t", "BTab": b"\x1b[Z", "C-c": b"\x03", "y": b"y", "n": b"n",
        **{str(i): str(i).encode() for i in range(1, 10)}}
ARROWS = {"Up": "A", "Down": "B", "Right": "C", "Left": "D"}
MODE_RE = re.compile(rb"\x1b\[\?([\d;]+)([hl])")
DETACH_BYTE = b"\x1d"                  # Ctrl-] in `kopi attach`
# Markers a Claude Code session puts in the environment of everything it runs.  An agent that inherits them thinks it
# is a helper of that session (e.g. it stops saving its transcript, which is what the page's chat reads), so they are
# dropped: under kopi every agent is a session of its own.  Keys, settings and PATH are untouched.
INHERITED = ("CLAUDECODE", "CLAUDE_PID", "CLAUDE_EFFORT", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_EXECPATH",
             "CLAUDE_CODE_SESSION_ID", "CLAUDE_CODE_CHILD_SESSION", "CLAUDE_CODE_SESSION_ATTENDED",
             "CLAUDE_CODE_MESSAGING_SOCKET", "CLAUDE_CODE_MESSAGING_TOKEN", "CLAUDE_CODE_SSE_PORT")


def term_size(fd):
    try:
        rows, cols = struct.unpack("HHHH", fcntl.ioctl(fd, termios.TIOCGWINSZ, b"\0" * 8))[:2]
        return (cols, rows) if cols and rows else None
    except OSError:
        return None


def set_size(fd, cols, rows):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))


def write_all(fd, data):
    while data:
        try:
            data = data[os.write(fd, data):]
        except InterruptedError:
            continue


def proc_start(pid):
    try:
        with open(f"/proc/{pid}/stat") as f:
            return int(f.read().rsplit(")", 1)[1].split()[19])
    except (OSError, ValueError, IndexError):
        return None


class Client:
    def __init__(self, sock):
        self.sock, self.inbuf, self.out, self.watching, self.attach = sock, b"", bytearray(), False, False

    def send(self, obj):
        self.out += (json.dumps(obj) + "\n").encode()


class Kopi:
    def __init__(self, name, exe, args, detached):
        self.name, self.exe, self.args, self.detached = name, exe, args, detached
        self.io = not detached                     # copy bytes to/from the real terminal we were started in
        self.ring, self.trimmed, self.resized = bytearray(), False, False
        self.inq = bytearray()                     # bytes waiting to be written into the agent (non-blocking)
        self.timers = []                           # (when, bytes) e.g. the Enter after a paste
        self.clients = {}
        self.modes = {"paste": False, "appcur": False, "alt": False, "mouse": set()}
        self.tail = b""
        self.winch = self.hup = False
        self.saved = None

    # ── setup ──
    def start(self):
        self.size = (term_size(0) if self.io else None) or DETACHED_SIZE
        os.environ["KOPITIAM_WRAPPED"] = "1"
        for k in INHERITED:
            os.environ.pop(k, None)
        pid, fd = pty.fork()
        if pid == 0:                               # child: size the terminal before the agent looks at it
            try:
                set_size(0, *self.size)
                os.execv(self.exe, [self.name] + self.args)
            except OSError as e:
                os.write(2, f"kopi: cannot run {self.exe}: {e}\r\n".encode())
            os._exit(127)
        self.child, self.fd = pid, fd
        os.set_blocking(fd, False)
        os.makedirs(SOCK_DIR, mode=0o700, exist_ok=True)
        os.chmod(SOCK_DIR, 0o700)
        me = os.getpid()
        self.sock_path = os.path.join(SOCK_DIR, f"{me}.sock")
        self.meta_path = os.path.join(SOCK_DIR, f"{me}.json")
        try:
            os.unlink(self.sock_path)
        except FileNotFoundError:
            pass
        self.lsock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.lsock.bind(self.sock_path)
        os.chmod(self.sock_path, 0o600)
        self.lsock.listen(8)
        self.lsock.setblocking(False)
        self.write_meta()
        signal.signal(signal.SIGWINCH, lambda *_: setattr(self, "winch", True))
        for s in (signal.SIGHUP, signal.SIGTERM):
            signal.signal(s, lambda *_: setattr(self, "hup", True))
        if self.io:
            self.saved = termios.tcgetattr(0)
            tty.setraw(0)

    def write_meta(self):
        meta = {"pid": os.getpid(), "start": proc_start(os.getpid()), "child": self.child, "name": self.name,
                "cwd": os.getcwd(), "detached": self.detached, "cols": self.size[0], "rows": self.size[1],
                "startedAt": int(time.time() * 1000)}
        tmp = self.meta_path + ".tmp"
        with open(tmp, "w") as f:
            json.dump(meta, f)
        os.replace(tmp, self.meta_path)

    def restore(self):
        if self.saved is not None:
            try:
                termios.tcsetattr(0, termios.TCSAFLUSH, self.saved)
            except termios.error:
                pass

    def cleanup(self):
        self.restore()
        for c in list(self.clients.values()):
            c.sock.close()
        try:
            self.lsock.close()
        except OSError:
            pass
        for p in (self.sock_path, self.meta_path):
            try:
                os.unlink(p)
            except OSError:
                pass

    # ── output from the agent ──
    def feed(self, data):
        if self.io:
            write_all(1, data)
        self.ring += data
        if len(self.ring) > RING:
            del self.ring[: len(self.ring) - RING]
            self.trimmed = True
        scan = self.tail + data                    # track the modes that change what a key or a paste must look like
        for params, hl in MODE_RE.findall(scan):
            on = hl == b"h"
            for p in params.split(b";"):
                if p == b"2004":
                    self.modes["paste"] = on
                elif p == b"1":
                    self.modes["appcur"] = on
                elif p in (b"1049", b"47", b"1047"):
                    self.modes["alt"] = on
                elif p in (b"1000", b"1002", b"1003", b"1006", b"1015"):
                    (self.modes["mouse"].add if on else self.modes["mouse"].discard)(p.decode())
        self.tail = scan[-24:]
        if self.clients:
            msg = {"op": "out", "data": base64.b64encode(data).decode()}
            for c in list(self.clients.values()):
                if c.watching:
                    c.send(msg)
                    if len(c.out) > CLIENT_MAX:
                        self.drop(c)

    # ── input into the agent ──
    def type(self, data):
        self.inq += data

    def key_bytes(self, key):
        if key in ARROWS:
            return ("\x1bO" if self.modes["appcur"] else "\x1b[").encode() + ARROWS[key].encode()
        if key in KEYS:
            return KEYS[key]
        raise ValueError(f"key not allowed: {key}")

    def paste(self, text):
        body = text.replace("\r\n", "\n").encode()
        if self.modes["paste"]:
            self.type(b"\x1b[200~" + body.replace(b"\x1b", b"") + b"\x1b[201~")
        else:
            self.type(body.replace(b"\n", b" "))   # without bracketed paste a newline would submit early
        self.timers.append((time.monotonic() + PASTE_SETTLE, b"\r"))

    def set_size(self, cols, rows):
        """Resize the agent's terminal (the kernel sends it SIGWINCH) and tell the watching pages to follow."""
        if (cols, rows) == self.size:
            return
        self.size = (cols, rows)
        set_size(self.fd, cols, rows)
        self.resized = True
        self.write_meta()
        for c in list(self.clients.values()):
            if c.watching:
                c.send({"op": "size", "cols": cols, "rows": rows})

    def resize(self, cols, rows):
        self.set_size(max(20, min(int(cols), 500)), max(5, min(int(rows), 200)))

    # ── the socket ──
    def handle(self, c, msg):
        op = msg.get("op")
        if op == "text":                           # a whole message: pasted, then Enter
            text = str(msg.get("text") or "")
            if not text.strip():
                raise ValueError("empty message")
            self.paste(text)
        elif op == "key":
            self.type(self.key_bytes(str(msg.get("key"))))
        elif op == "input":                        # raw keystrokes from a terminal view (the page or `kopi attach`)
            self.type(base64.b64decode(msg.get("data") or ""))
        elif op == "resize":                       # only for an agent that has no real terminal of its own
            if not self.io:
                self.resize(msg.get("cols", 0), msg.get("rows", 0))
        elif op == "watch":                        # stream the output: what is kept so far, then everything new
            c.watching, c.attach = True, bool(msg.get("attach"))
            c.send({"op": "hello", "pid": os.getpid(), "child": self.child, "name": self.name, "cols": self.size[0],
                    "rows": self.size[1], "detached": self.detached})
            c.send({"op": "out", "data": base64.b64encode(bytes(self.ring)).decode(), "replay": True})
            if self.trimmed or self.resized:
                try:
                    os.kill(self.child, signal.SIGWINCH)   # the replay is partial: ask the agent to redraw
                except OSError:
                    pass
            return
        elif op == "info":
            c.send({"op": "info", "pid": os.getpid(), "child": self.child, "name": self.name, "cols": self.size[0],
                    "rows": self.size[1], "detached": self.detached,
                    "modes": dict(self.modes, mouse=sorted(self.modes["mouse"]))})
            return
        else:
            raise ValueError(f"unknown op: {op}")
        c.send({"ok": True})

    def drop(self, c):
        self.clients.pop(c.sock.fileno(), None)
        c.sock.close()

    def on_client(self, c):
        try:
            data = c.sock.recv(65536)
        except (BlockingIOError, InterruptedError):
            return
        except OSError:
            data = b""
        if not data:
            return self.drop(c)
        c.inbuf += data
        if len(c.inbuf) > 1024 * 1024:
            return self.drop(c)
        while b"\n" in c.inbuf:
            line, c.inbuf = c.inbuf.split(b"\n", 1)
            if not line.strip():
                continue
            try:
                self.handle(c, json.loads(line))
            except (ValueError, TypeError) as e:
                c.send({"ok": False, "error": str(e)})

    # ── job control ──
    # The agent runs in its own session, so the kernel discards a SIGTSTP it sends itself (Claude's Ctrl-Z) and would
    # leave it waiting forever for a SIGCONT.  So kopi does the suspending: it stops the agent and then itself, giving
    # the terminal back to your shell; `fg` resumes both and the agent redraws.
    def terminal_modes(self, on):
        seq = [("?2004", self.modes["paste"]), ("?1", self.modes["appcur"])] + [("?" + m, True) for m in sorted(self.modes["mouse"])]
        out = "".join(f"\x1b[{m}{'h' if on else 'l'}" for m, active in seq if active)
        if self.modes["alt"]:
            out = ("\x1b[?1049h" + out) if on else (out + "\x1b[?1049l")
        return (out + ("" if on else "\x1b[?25h\r\n")).encode()

    def suspend(self, stop_agent):
        if self.inq:                                       # hand over what was typed before Ctrl-Z first
            try:
                del self.inq[:os.write(self.fd, self.inq)]
            except OSError:
                pass
        if stop_agent:
            try:
                os.killpg(os.getpgid(self.child), signal.SIGSTOP)
            except OSError:
                pass
        if self.io:
            write_all(1, self.terminal_modes(False))       # cursor back, mouse off, leave the alternate screen
        self.restore()
        os.kill(os.getpid(), signal.SIGSTOP)
        if self.io:                                        # resumed by `fg`
            tty.setraw(0)
            write_all(1, self.terminal_modes(True))
            sz = term_size(0)
            if sz:
                self.set_size(*sz)
        try:
            os.killpg(os.getpgid(self.child), signal.SIGCONT)
            os.kill(self.child, signal.SIGWINCH)           # redraw
        except OSError:
            pass

    # ── main loop ──
    def loop(self):
        code = None
        while True:
            if self.hup:
                try:
                    os.kill(self.child, signal.SIGHUP)
                except OSError:
                    pass
                self.hup = False
            if self.winch and self.io:
                self.winch = False
                sz = term_size(0)
                if sz:
                    self.set_size(*sz)
            now = time.monotonic()
            due = [t for t in self.timers if t[0] <= now]
            for t in due:
                self.timers.remove(t)
                self.type(t[1])
            r = [self.fd, self.lsock] + [c.sock for c in self.clients.values()] + ([0] if self.io else [])
            w = ([self.fd] if self.inq else []) + [c.sock for c in self.clients.values() if c.out]
            wait = min([0.25] + [max(0, t[0] - now) for t in self.timers])
            try:
                rr, ww, _ = select.select(r, w, [], wait)
            except (InterruptedError, ValueError):
                continue
            if self.fd in rr:
                try:
                    data = os.read(self.fd, 65536)
                except BlockingIOError:
                    data = None
                except OSError:
                    data = b""                   # EIO: the agent closed its terminal (it exited)
                if data == b"":
                    break
                if data:
                    self.feed(data)
            if 0 in rr:
                try:
                    data = os.read(0, 65536)
                except OSError:
                    data = b""
                if data and b"\x1a" in data and self.name in ("claude", "codex"):   # Ctrl-Z: suspend, see above
                    self.type(data.split(b"\x1a", 1)[0])
                    self.suspend(stop_agent=True)
                elif data:
                    self.type(data)
                else:                              # our own terminal went away
                    self.io = False
                    self.hup = True
            if self.fd in ww and self.inq:
                try:
                    n = os.write(self.fd, self.inq)
                    del self.inq[:n]
                except (BlockingIOError, InterruptedError):
                    pass
                except OSError:
                    self.inq.clear()
            if self.lsock in rr:
                try:
                    s, _ = self.lsock.accept()
                    s.setblocking(False)
                    self.clients[s.fileno()] = Client(s)
                except OSError:
                    pass
            for c in list(self.clients.values()):
                if c.sock in rr:
                    self.on_client(c)
                if c.sock in ww and c.out and c.sock.fileno() in self.clients:
                    try:
                        n = c.sock.send(c.out)
                        del c.out[:n]
                    except (BlockingIOError, InterruptedError):
                        pass
                    except OSError:
                        self.drop(c)
            try:
                pid, status = os.waitpid(self.child, os.WNOHANG | os.WUNTRACED)
            except ChildProcessError:
                break
            if pid and os.WIFSTOPPED(status):
                if self.io:
                    self.suspend(stop_agent=False)
                else:
                    os.kill(self.child, signal.SIGCONT)
            elif pid:
                code = os.waitstatus_to_exitcode(status)
                self.drain()
                break
        for c in list(self.clients.values()):    # tell watchers, best effort
            try:
                c.sock.setblocking(True)
                c.sock.settimeout(0.5)
                c.sock.sendall(bytes(c.out) + (json.dumps({"op": "exit", "code": code}) + "\n").encode())
            except OSError:
                pass
        if code is None:
            try:
                code = os.waitstatus_to_exitcode(os.waitpid(self.child, 0)[1])
            except ChildProcessError:
                code = 0
        return code

    def drain(self):
        while True:
            try:
                data = os.read(self.fd, 65536)
            except OSError:
                return
            if not data:
                return
            self.feed(data)


def run(name, args, detached=False):
    exe = shutil.which(name)                       # PATH lookup: the shell function named `claude` is not visible here
    if not exe:
        sys.stderr.write(f"kopi: {name}: command not found\n")
        return 127
    interactive = os.isatty(0) and os.isatty(1)
    if not detached and (not interactive or any(a in ("-p", "--print", "-v", "--version", "-h", "--help") for a in args)):
        os.execv(exe, [name] + args)
    k = Kopi(name, exe, args, detached)
    k.start()
    try:
        code = k.loop()
    finally:
        k.cleanup()
    return 128 - code if code < 0 else code          # killed by a signal: the shell convention (Ctrl-C -> 130)


# ───────────────────────── kopi attach ─────────────────────────

def attach(pid):
    path = os.path.join(SOCK_DIR, f"{pid}.sock")
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        s.connect(path)
    except OSError:
        sys.stderr.write(f"kopi: no agent with pid {pid} (see ~/.kopitiam/sock)\n")
        return 1
    send = lambda o: s.sendall((json.dumps(o) + "\n").encode())
    send({"op": "watch", "attach": True})
    sz = term_size(0)
    if sz:
        send({"op": "resize", "cols": sz[0], "rows": sz[1]})
    saved = termios.tcgetattr(0)
    winch = [False]
    signal.signal(signal.SIGWINCH, lambda *_: winch.__setitem__(0, True))
    tty.setraw(0)
    buf, code = b"", 0
    try:
        while True:
            if winch[0]:
                winch[0] = False
                sz = term_size(0)
                if sz:
                    send({"op": "resize", "cols": sz[0], "rows": sz[1]})
            try:
                rr, _, _ = select.select([0, s], [], [], 0.5)
            except InterruptedError:
                continue
            if 0 in rr:
                data = os.read(0, 65536)
                if not data or DETACH_BYTE in data:
                    break
                send({"op": "input", "data": base64.b64encode(data).decode()})
            if s in rr:
                chunk = s.recv(262144)
                if not chunk:
                    break
                buf += chunk
                while b"\n" in buf:
                    line, buf = buf.split(b"\n", 1)
                    msg = json.loads(line)
                    if msg.get("op") == "out":
                        write_all(1, base64.b64decode(msg["data"]))
                    elif msg.get("op") == "exit":
                        code = msg.get("code") or 0
                        return code
    finally:
        termios.tcsetattr(0, termios.TCSAFLUSH, saved)
        sys.stdout.write("\r\n[kopi: detached]\r\n")
    return code


# ───────────────────────── shell hook ─────────────────────────

BEGIN, END = "# >>> kopitiam >>>", "# <<< kopitiam <<<"


def hook_block():
    k = shlex.quote(os.path.join(HERE, "kopi.py"))
    return f"""{BEGIN}  lets the Kopitiam page type into claude / codex. Remove with: kopi uninstall-shell
unalias kopi claude codex 2>/dev/null
kopi() {{ python3 {k} "$@"; }}
claude() {{ if [ -f {k} ]; then python3 {k} claude "$@"; else command claude "$@"; fi; }}
codex() {{ if [ -f {k} ]; then python3 {k} codex "$@"; else command codex "$@"; fi; }}
{END}
"""


def rc_files():
    home = os.path.expanduser("~")
    return [p for p in (os.path.join(home, ".zshrc"), os.path.join(home, ".bashrc")) if os.path.exists(p)]


def strip_block(text):
    return re.sub(rf"\n?{re.escape(BEGIN)}.*?{re.escape(END)}\n?", "\n", text, flags=re.S)


def installed():
    return any(BEGIN in open(p).read() for p in rc_files())


def install_shell(remove=False):
    files = rc_files()
    if not files:
        print("kopi: no ~/.zshrc or ~/.bashrc found")
        return 1
    for p in files:
        with open(p) as f:
            text = f.read()
        new = strip_block(text).rstrip("\n") + "\n"
        if not remove:
            new += "\n" + hook_block()
        if new != text:
            with open(p, "w") as f:
                f.write(new)
        print(f"{'removed from' if remove else 'installed in'} {p}")
    print("Open a new terminal (or run: exec $SHELL) for it to take effect." if not remove else
          "Open a new terminal for plain claude / codex to come back.")
    return 0


def main(argv):
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__.split("How it works")[0].strip())
        return 0
    if argv[0] == "install-shell":
        return install_shell()
    if argv[0] == "uninstall-shell":
        return install_shell(remove=True)
    if argv[0] == "attach" and len(argv) == 2 and argv[1].isdigit():
        return attach(int(argv[1]))
    if argv[0] == "--detach" and len(argv) >= 2:     # started by the Kopitiam server: no terminal of its own
        return run(argv[1], argv[2:], detached=True)
    return run(argv[0], argv[1:])


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
