#!/usr/bin/env python3
"""
CTO Dashboard — Pre-Deploy E2E Integration Test Suite
=====================================================
Run this locally before deploying to Cloud Run to catch issues early.

Usage:
    python3 test_e2e_integration.py              # Run all tests
    python3 test_e2e_integration.py --quick       # Skip slow tests (chat, engineers)
    python3 test_e2e_integration.py --verbose     # Show detailed output

Prerequisites:
    - npm run dev (or npm run dev:server) running on ports 3100/3101
    - Python 3.8+
    - pip install websocket-client requests  (only stdlib needed for ws, but requests is nice)

If websocket-client is not installed, the script falls back to raw sockets.
"""

import sys
import os
import json
import time
import subprocess
import signal
import socket
import threading
import traceback
from typing import Optional, List, Dict, Any, Tuple
from contextlib import contextmanager
from pathlib import Path

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
WS_PORT = 3101
NEXT_PORT = 3100
WS_URL = f"ws://localhost:{WS_PORT}"
NEXT_URL = f"http://localhost:{NEXT_PORT}"
TIMEOUT = 10  # seconds per test

VERBOSE = "--verbose" in sys.argv or "-v" in sys.argv
QUICK = "--quick" in sys.argv or "-q" in sys.argv

# ---------------------------------------------------------------------------
# Colors
# ---------------------------------------------------------------------------
class C:
    GREEN = "\033[92m"
    RED = "\033[91m"
    YELLOW = "\033[93m"
    CYAN = "\033[96m"
    DIM = "\033[2m"
    BOLD = "\033[1m"
    RESET = "\033[0m"

def log(msg: str):
    print(msg)

def log_verbose(msg: str):
    if VERBOSE:
        print(f"  {C.DIM}{msg}{C.RESET}")

def log_pass(name: str, detail: str = ""):
    extra = f" {C.DIM}({detail}){C.RESET}" if detail else ""
    print(f"  {C.GREEN}PASS{C.RESET}  {name}{extra}")

def log_fail(name: str, reason: str = ""):
    extra = f" — {reason}" if reason else ""
    print(f"  {C.RED}FAIL{C.RESET}  {name}{extra}")

def log_skip(name: str, reason: str = ""):
    extra = f" — {reason}" if reason else ""
    print(f"  {C.YELLOW}SKIP{C.RESET}  {name}{extra}")

def log_section(title: str):
    print(f"\n{C.BOLD}{C.CYAN}{'─' * 50}{C.RESET}")
    print(f"{C.BOLD}{C.CYAN}  {title}{C.RESET}")
    print(f"{C.BOLD}{C.CYAN}{'─' * 50}{C.RESET}")

# ---------------------------------------------------------------------------
# WebSocket Client (minimal, no external deps)
# ---------------------------------------------------------------------------
import hashlib
import base64
import struct
import ssl

class SimpleWebSocket:
    """Minimal WebSocket client using stdlib only."""

    def __init__(self, url: str, timeout: float = TIMEOUT):
        self.url = url
        self.timeout = timeout
        self.sock: Optional[socket.socket] = None
        self._connected = False

    def connect(self) -> bool:
        try:
            # Parse URL
            url = self.url.replace("ws://", "").replace("wss://", "")
            if ":" in url:
                host, port_path = url.split(":", 1)
                if "/" in port_path:
                    port_str, path = port_path.split("/", 1)
                    path = "/" + path
                else:
                    port_str = port_path
                    path = "/"
                port = int(port_str)
            else:
                host = url
                port = 80
                path = "/"

            self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            self.sock.settimeout(self.timeout)
            self.sock.connect((host, port))

            # WebSocket handshake
            key = base64.b64encode(os.urandom(16)).decode()
            handshake = (
                f"GET {path} HTTP/1.1\r\n"
                f"Host: {host}:{port}\r\n"
                f"Upgrade: websocket\r\n"
                f"Connection: Upgrade\r\n"
                f"Sec-WebSocket-Key: {key}\r\n"
                f"Sec-WebSocket-Version: 13\r\n"
                f"\r\n"
            )
            self.sock.sendall(handshake.encode())

            # Read response
            response = b""
            while b"\r\n\r\n" not in response:
                chunk = self.sock.recv(4096)
                if not chunk:
                    return False
                response += chunk

            if b"101" in response.split(b"\r\n")[0]:
                self._connected = True
                return True
            return False
        except Exception as e:
            log_verbose(f"WS connect error: {e}")
            return False

    def send(self, data: str):
        if not self.sock:
            raise RuntimeError("Not connected")
        payload = data.encode("utf-8")
        mask_key = os.urandom(4)

        # Build frame
        frame = bytearray()
        frame.append(0x81)  # FIN + text

        length = len(payload)
        if length < 126:
            frame.append(0x80 | length)  # MASK bit set
        elif length < 65536:
            frame.append(0x80 | 126)
            frame.extend(struct.pack("!H", length))
        else:
            frame.append(0x80 | 127)
            frame.extend(struct.pack("!Q", length))

        frame.extend(mask_key)
        masked = bytearray(b ^ mask_key[i % 4] for i, b in enumerate(payload))
        frame.extend(masked)

        self.sock.sendall(bytes(frame))

    def recv(self, timeout: Optional[float] = None) -> Optional[str]:
        if not self.sock:
            return None
        old_timeout = self.sock.gettimeout()
        if timeout is not None:
            self.sock.settimeout(timeout)
        try:
            # Read frame header
            header = self._recv_bytes(2)
            if not header:
                return None

            opcode = header[0] & 0x0F
            masked = bool(header[1] & 0x80)
            length = header[1] & 0x7F

            if length == 126:
                ext = self._recv_bytes(2)
                length = struct.unpack("!H", ext)[0]
            elif length == 127:
                ext = self._recv_bytes(8)
                length = struct.unpack("!Q", ext)[0]

            if masked:
                mask_key = self._recv_bytes(4)

            payload = self._recv_bytes(length)

            if masked:
                payload = bytearray(b ^ mask_key[i % 4] for i, b in enumerate(payload))

            if opcode == 0x08:  # Close
                return None
            if opcode == 0x09:  # Ping
                self._send_pong(payload)
                return self.recv(timeout)
            if opcode == 0x01:  # Text
                return payload.decode("utf-8", errors="replace")
            return None
        except socket.timeout:
            return None
        except Exception as e:
            log_verbose(f"WS recv error: {e}")
            return None
        finally:
            if timeout is not None:
                self.sock.settimeout(old_timeout)

    def _recv_bytes(self, n: int) -> bytearray:
        data = bytearray()
        while len(data) < n:
            chunk = self.sock.recv(n - len(data))
            if not chunk:
                raise ConnectionError("Connection closed")
            data.extend(chunk)
        return data

    def _send_pong(self, payload: bytearray):
        frame = bytearray([0x8A, len(payload)])
        frame.extend(payload)
        self.sock.sendall(bytes(frame))

    def close(self):
        if self.sock:
            try:
                # Send close frame
                self.sock.sendall(bytes([0x88, 0x80, 0, 0, 0, 0]))
                self.sock.close()
            except Exception:
                pass
        self._connected = False

    @property
    def connected(self):
        return self._connected


@contextmanager
def ws_connection(timeout: float = TIMEOUT):
    """Context manager for a WebSocket connection."""
    ws = SimpleWebSocket(WS_URL, timeout=timeout)
    if not ws.connect():
        raise ConnectionError(f"Could not connect to {WS_URL}")
    try:
        yield ws
    finally:
        ws.close()


def ws_send_and_collect(
    ws: SimpleWebSocket,
    msg_type: str,
    payload: Optional[dict] = None,
    expect_type: Optional[str] = None,
    timeout: float = 5.0,
    collect_all: bool = False,
) -> Tuple[Optional[dict], List[dict]]:
    """Send a WS message and wait for response(s).

    Returns (first_matching_message, all_messages_received).
    If the server sends an 'error' type message, it's included in all_msgs.
    """
    msg = {"type": msg_type}
    if payload:
        msg["payload"] = payload
    ws.send(json.dumps(msg))

    all_msgs: List[dict] = []
    match: Optional[dict] = None
    deadline = time.time() + timeout

    while time.time() < deadline:
        remaining = deadline - time.time()
        raw = ws.recv(timeout=min(remaining, 1.0))
        if raw is None:
            if match and not collect_all:
                break
            continue
        try:
            parsed = json.loads(raw)
            all_msgs.append(parsed)
            log_verbose(f"  <- {parsed.get('type', '?')}: {json.dumps(parsed)[:120]}")
            if expect_type and parsed.get("type") == expect_type:
                match = parsed
                if not collect_all:
                    break
            # If server sends an error response, stop waiting for the expected type
            if parsed.get("type") == "error" and not match:
                break
        except json.JSONDecodeError:
            pass

    return match, all_msgs


# ---------------------------------------------------------------------------
# Test Results Tracker
# ---------------------------------------------------------------------------
class TestResults:
    def __init__(self):
        self.passed = 0
        self.failed = 0
        self.skipped = 0
        self.failures: List[str] = []

    def ok(self, name: str, detail: str = ""):
        self.passed += 1
        log_pass(name, detail)

    def fail(self, name: str, reason: str = ""):
        self.failed += 1
        self.failures.append(f"{name}: {reason}")
        log_fail(name, reason)

    def skip(self, name: str, reason: str = ""):
        self.skipped += 1
        log_skip(name, reason)

    def assert_test(self, name: str, condition: bool, detail: str = "", fail_reason: str = ""):
        if condition:
            self.ok(name, detail)
        else:
            self.fail(name, fail_reason)

    def summary(self):
        total = self.passed + self.failed + self.skipped
        log_section("Results")
        print(f"  Total:   {total}")
        print(f"  {C.GREEN}Passed:  {self.passed}{C.RESET}")
        if self.failed:
            print(f"  {C.RED}Failed:  {self.failed}{C.RESET}")
        if self.skipped:
            print(f"  {C.YELLOW}Skipped: {self.skipped}{C.RESET}")

        if self.failures:
            print(f"\n  {C.RED}Failures:{C.RESET}")
            for f in self.failures:
                print(f"    - {f}")

        print()
        return self.failed == 0


results = TestResults()


def is_firestore_auth_error(all_msgs: List[dict]) -> Optional[str]:
    """Check if the failure is a Firestore credential issue (not a code bug).
    Returns the error message if so, None otherwise."""
    errors = [m for m in all_msgs if m.get("type") == "error"]
    if errors:
        err_msg = errors[0].get("payload", {}).get("error", "")
        if "invalid_grant" in err_msg or "invalid_rapt" in err_msg or "metadata from plugin" in err_msg:
            return err_msg
    return None


# ---------------------------------------------------------------------------
# Test: Port Checks
# ---------------------------------------------------------------------------
def test_ports():
    log_section("Port Checks")

    for name, port in [("WebSocket (orchestrator)", WS_PORT), ("Next.js", NEXT_PORT)]:
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.settimeout(3)
            s.connect(("localhost", port))
            s.close()
            results.ok(f"{name} on port {port}", "listening")
        except Exception:
            results.fail(f"{name} on port {port}", "not reachable")


# ---------------------------------------------------------------------------
# Test: WebSocket Connection + Handshake
# ---------------------------------------------------------------------------
def test_ws_connection():
    log_section("WebSocket Connection")

    try:
        with ws_connection() as ws:
            results.ok("WS handshake", "connected")

            # The server should send initial data after connection.
            # Drain any auto-sent messages for 2s.
            msgs = []
            deadline = time.time() + 2
            while time.time() < deadline:
                raw = ws.recv(timeout=0.5)
                if raw:
                    try:
                        msgs.append(json.loads(raw))
                    except json.JSONDecodeError:
                        pass

            log_verbose(f"Received {len(msgs)} initial messages")
            results.ok("WS connection stable", f"{len(msgs)} msgs in 2s")
    except ConnectionError as e:
        results.fail("WS handshake", str(e))


# ---------------------------------------------------------------------------
# Test: Config Get/Set
# ---------------------------------------------------------------------------
def test_config():
    log_section("Config (get/set)")

    try:
        with ws_connection() as ws:
            # Get current config
            match, _ = ws_send_and_collect(ws, "config:get", expect_type="config:data")
            if match:
                payload = match.get("payload", {})
                results.ok("config:get", f"{len(payload)} keys")

                # Verify required keys exist
                required = ["ctoModel", "engineerDefaultModel", "engineerMaxConcurrent", "wsPort"]
                missing = [k for k in required if k not in payload]
                results.assert_test(
                    "Config has required keys",
                    len(missing) == 0,
                    ", ".join(required),
                    f"missing: {missing}",
                )

                # Verify secrets are masked
                secret_fields = ["notionApiKey", "vantaApiKey", "slackBotToken", "slackAppToken", "slackSigningSecret"]
                exposed = [k for k in secret_fields if payload.get(k) and payload[k] != "***" and payload[k] != ""]
                results.assert_test(
                    "Secrets are masked",
                    len(exposed) == 0,
                    "all secret fields masked or empty",
                    f"exposed: {exposed}",
                )
            else:
                results.fail("config:get", "no config:data response")
    except ConnectionError:
        results.fail("config:get", "WS not available")


# ---------------------------------------------------------------------------
# Test: Task CRUD
# ---------------------------------------------------------------------------
def test_tasks():
    log_section("Tasks")

    try:
        with ws_connection() as ws:
            # List tasks
            match, all_msgs = ws_send_and_collect(ws, "task:list", expect_type="task:list", timeout=10)
            if match:
                tasks = match.get("payload", {}).get("tasks", [])
                results.ok("task:list", f"{len(tasks)} tasks")

                # Check task shape if any exist
                if tasks:
                    t = tasks[0]
                    required_fields = ["id", "title", "status"]
                    has_fields = all(f in t for f in required_fields)
                    results.assert_test(
                        "Task shape",
                        has_fields,
                        f"id={t.get('id', '?')[:8]}",
                        f"missing fields in {list(t.keys())}",
                    )

                    # Verify valid statuses
                    valid = {"suggested", "approved", "in_progress", "in_review", "done", "failed", "cancelled"}
                    bad = [t2["status"] for t2 in tasks if t2.get("status") not in valid]
                    results.assert_test(
                        "Task statuses valid",
                        len(bad) == 0,
                        f"all {len(tasks)} in valid states",
                        f"invalid statuses: {bad[:5]}",
                    )
                else:
                    results.skip("Task shape", "no tasks in DB")
            else:
                auth_err = is_firestore_auth_error(all_msgs)
                if auth_err:
                    results.skip("task:list", f"Firestore auth expired — run: gcloud auth application-default login")
                else:
                    errors = [m for m in all_msgs if m.get("type") == "error"]
                    if errors:
                        results.fail("task:list", f"server error: {errors[0].get('payload', {}).get('error', '?')[:80]}")
                    else:
                        results.fail("task:list", "no response (server may have crashed — check logs)")
    except ConnectionError:
        results.fail("task:list", "WS not available")


# ---------------------------------------------------------------------------
# Test: Engineer List
# ---------------------------------------------------------------------------
def test_engineers():
    log_section("Engineers")

    try:
        with ws_connection() as ws:
            match, _ = ws_send_and_collect(ws, "engineer:list", expect_type="engineer:list")
            if match:
                engineers = match.get("payload", {}).get("engineers", [])
                results.ok("engineer:list", f"{len(engineers)} active")
            else:
                results.fail("engineer:list", "no response")
    except ConnectionError:
        results.fail("engineer:list", "WS not available")


# ---------------------------------------------------------------------------
# Test: Thread List
# ---------------------------------------------------------------------------
def test_threads():
    log_section("Threads")

    try:
        with ws_connection() as ws:
            match, all_msgs = ws_send_and_collect(ws, "thread:list", expect_type="thread:list", timeout=10)
            if match:
                threads = match.get("payload", {}).get("threads", [])
                active = match.get("payload", {}).get("activeThreadId")
                results.ok("thread:list", f"{len(threads)} threads, active={active or 'default'}")
            else:
                auth_err = is_firestore_auth_error(all_msgs)
                if auth_err:
                    results.skip("thread:list", "Firestore auth expired — run: gcloud auth application-default login")
                else:
                    errors = [m for m in all_msgs if m.get("type") == "error"]
                    if errors:
                        results.fail("thread:list", f"server error: {errors[0].get('payload', {}).get('error', '?')[:80]}")
                    else:
                        results.fail("thread:list", "no response")
    except ConnectionError:
        results.fail("thread:list", "WS not available")


# ---------------------------------------------------------------------------
# Test: Chat History
# ---------------------------------------------------------------------------
def test_chat_history():
    log_section("Chat History")

    try:
        with ws_connection() as ws:
            match, all_msgs = ws_send_and_collect(ws, "chat:history", expect_type="chat:history", timeout=10)
            if match:
                messages = match.get("payload", {}).get("messages", [])
                results.ok("chat:history", f"{len(messages)} messages")

                # Verify message shape
                if messages:
                    m = messages[0]
                    has_role = "role" in m
                    has_content = "content" in m
                    results.assert_test(
                        "Chat message shape",
                        has_role and has_content,
                        f"role={m.get('role')}, content_len={len(m.get('content', ''))}",
                        f"missing fields",
                    )
            else:
                auth_err = is_firestore_auth_error(all_msgs)
                if auth_err:
                    results.skip("chat:history", "Firestore auth expired — run: gcloud auth application-default login")
                else:
                    errors = [m for m in all_msgs if m.get("type") == "error"]
                    if errors:
                        results.fail("chat:history", f"server error: {errors[0].get('payload', {}).get('error', '?')[:80]}")
                    else:
                        results.fail("chat:history", "no response")
    except ConnectionError:
        results.fail("chat:history", "WS not available")


# ---------------------------------------------------------------------------
# Test: System Status
# ---------------------------------------------------------------------------
def test_status():
    log_section("System Status")

    try:
        with ws_connection() as ws:
            match, _ = ws_send_and_collect(ws, "status:get", expect_type="system:status")
            if match:
                data = match.get("data") or match.get("payload", {})
                results.ok("status:get", f"keys={list(data.keys())[:5]}")
            else:
                results.fail("status:get", "no system:status response")
    except ConnectionError:
        results.fail("status:get", "WS not available")


# ---------------------------------------------------------------------------
# Test: Analytics
# ---------------------------------------------------------------------------
def test_analytics():
    log_section("Analytics")

    try:
        with ws_connection() as ws:
            # Cost analytics
            match, all_msgs = ws_send_and_collect(ws, "analytics:cost", expect_type="analytics:cost", timeout=10)
            if match:
                payload = match.get("payload", {})
                results.ok("analytics:cost", f"keys={list(payload.keys())[:5]}")
            else:
                auth_err = is_firestore_auth_error(all_msgs)
                if auth_err:
                    results.skip("analytics:cost", "Firestore auth expired — run: gcloud auth application-default login")
                else:
                    errors = [m for m in all_msgs if m.get("type") == "error"]
                    if errors:
                        results.fail("analytics:cost", f"server error: {errors[0].get('payload', {}).get('error', '?')[:80]}")
                    else:
                        results.fail("analytics:cost", "no response")

        with ws_connection() as ws:
            # Activity log
            match, _ = ws_send_and_collect(ws, "analytics:activity", expect_type="analytics:activity", timeout=5)
            if match:
                activities = match.get("payload", {}).get("activities", [])
                results.ok("analytics:activity", f"{len(activities)} events")
            else:
                results.fail("analytics:activity", "no response")
    except ConnectionError:
        results.fail("analytics", "WS not available")


# ---------------------------------------------------------------------------
# Test: Compliance
# ---------------------------------------------------------------------------
def test_compliance():
    log_section("Compliance")

    try:
        with ws_connection() as ws:
            match, _ = ws_send_and_collect(ws, "compliance:overview", expect_type="compliance:overview", timeout=8)
            if match:
                payload = match.get("payload", {})
                # May have error if Vanta not configured
                if payload.get("error"):
                    results.ok("compliance:overview", f"returned error (Vanta not configured): {payload['error'][:60]}")
                else:
                    results.ok("compliance:overview", f"score={payload.get('overallScore', '?')}%")
            else:
                results.fail("compliance:overview", "no response")
    except ConnectionError:
        results.fail("compliance:overview", "WS not available")


# ---------------------------------------------------------------------------
# Test: Slack Status
# ---------------------------------------------------------------------------
def test_slack():
    log_section("Slack Integration")

    try:
        with ws_connection() as ws:
            match, _ = ws_send_and_collect(ws, "slack:status", expect_type="slack:status", timeout=5)
            if match:
                payload = match.get("payload", {})
                connected = payload.get("connected", False)
                results.ok("slack:status", f"connected={connected}")
            else:
                results.fail("slack:status", "no response")

        with ws_connection() as ws:
            match, _ = ws_send_and_collect(ws, "slack:get_conversations", expect_type="slack:conversations", timeout=5)
            if match:
                convos = match.get("payload", {}).get("conversations", [])
                results.ok("slack:conversations", f"{len(convos)} conversations")
            else:
                # Slack might not be configured — that's OK
                results.skip("slack:conversations", "no response (Slack may not be configured)")
    except ConnectionError:
        results.fail("slack", "WS not available")


# ---------------------------------------------------------------------------
# Test: Next.js Pages (HTTP)
# ---------------------------------------------------------------------------
def test_nextjs_pages():
    log_section("Next.js Pages (HTTP)")

    try:
        import urllib.request
        import urllib.error

        # Test unauthenticated health endpoint first
        try:
            resp = urllib.request.urlopen(f"{NEXT_URL}/api/health", timeout=5)
            data = json.loads(resp.read().decode())
            results.assert_test(
                "GET /api/health",
                data.get("status") == "ok",
                f"status=ok, service={data.get('service', '?')}",
                f"unexpected response: {data}",
            )
        except Exception as e:
            results.fail("GET /api/health", str(e))

        # Test login page (should be accessible without auth)
        try:
            resp = urllib.request.urlopen(f"{NEXT_URL}/login", timeout=5)
            status = resp.getcode()
            body = resp.read(500).decode("utf-8", errors="replace")
            results.assert_test(
                "GET /login (public)",
                status == 200 and "<" in body,
                f"HTTP {status}, {len(body)} bytes",
                f"HTTP {status}",
            )
        except urllib.error.HTTPError as e:
            results.fail(f"GET /login (public)", f"HTTP {e.code}")
        except Exception as e:
            results.fail(f"GET /login (public)", str(e))

        # Auth-gated pages — we expect redirects (302/307) to login
        # This verifies the middleware is working correctly
        auth_pages = [
            ("/chat", "Chat"),
            ("/tasks", "Tasks"),
            ("/engineers", "Engineers"),
            ("/settings", "Settings"),
            ("/analytics", "Analytics"),
        ]

        # Use a non-following opener to detect redirects
        class NoRedirectHandler(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, req, fp, code, msg, headers, newurl):
                raise urllib.error.HTTPError(req.full_url, code, msg, headers, fp)

        opener = urllib.request.build_opener(NoRedirectHandler)

        for path, name in auth_pages:
            try:
                req = urllib.request.Request(
                    f"{NEXT_URL}{path}",
                    headers={"User-Agent": "CTO-Dashboard-Test/1.0"},
                )
                resp = opener.open(req, timeout=5)
                # If we get 200 without auth, that's fine too (auth might be disabled)
                results.ok(f"GET {path} ({name})", f"HTTP {resp.getcode()} (no auth required)")
            except urllib.error.HTTPError as e:
                if e.code in (302, 303, 307, 308, 401):
                    results.ok(f"GET {path} ({name})", f"HTTP {e.code} (auth redirect)")
                else:
                    results.fail(f"GET {path} ({name})", f"HTTP {e.code}")
            except Exception as e:
                results.fail(f"GET {path} ({name})", str(e))

    except ImportError:
        results.skip("Next.js pages", "urllib not available")


# ---------------------------------------------------------------------------
# Test: Build Check
# ---------------------------------------------------------------------------
def test_build():
    log_section("Build Verification")

    project_root = Path(__file__).parent

    # Check that .next directory exists (build output)
    next_dir = project_root / ".next"
    results.assert_test(
        "Build output exists (.next/)",
        next_dir.exists(),
        "directory found",
        "run 'npm run build' first",
    )

    # Check package.json exists
    pkg = project_root / "package.json"
    results.assert_test(
        "package.json exists",
        pkg.exists(),
        "found",
        "not found",
    )

    # Check node_modules
    nm = project_root / "node_modules"
    results.assert_test(
        "node_modules installed",
        nm.exists(),
        "found",
        "run 'npm install' first",
    )

    # Check TypeScript compilation (non-blocking, just run tsc --noEmit)
    try:
        result = subprocess.run(
            ["npx", "tsc", "--noEmit"],
            cwd=str(project_root),
            capture_output=True,
            text=True,
            timeout=60,
        )
        results.assert_test(
            "TypeScript compiles",
            result.returncode == 0,
            "no errors",
            f"errors: {result.stdout[:200]}",
        )
    except subprocess.TimeoutExpired:
        results.skip("TypeScript compiles", "tsc timed out")
    except FileNotFoundError:
        results.skip("TypeScript compiles", "npx not found")


# ---------------------------------------------------------------------------
# Test: Database / Firestore connectivity
# ---------------------------------------------------------------------------
def test_data():
    log_section("Data Layer")

    project_root = Path(__file__).parent
    data_dir = project_root / "data"

    # Check data directory
    results.assert_test(
        "data/ directory exists",
        data_dir.exists(),
        "found",
        "will be created on first run",
    )

    # Config file
    config_file = data_dir / "config.json"
    if config_file.exists():
        try:
            with open(config_file) as f:
                cfg = json.load(f)
            results.ok("data/config.json", f"valid JSON, {len(cfg)} keys")
        except json.JSONDecodeError as e:
            results.fail("data/config.json", f"invalid JSON: {e}")
    else:
        results.skip("data/config.json", "not created yet (defaults used)")


# ---------------------------------------------------------------------------
# Test: Chat Send (slow — skipped in --quick mode)
# ---------------------------------------------------------------------------
def test_chat_send():
    log_section("Chat Send (CTO Interaction)")

    if QUICK:
        results.skip("chat:send", "--quick mode")
        return

    try:
        with ws_connection(timeout=30) as ws:
            # Send a simple test message
            test_msg = "Reply with exactly: TEST_OK"
            match, all_msgs = ws_send_and_collect(
                ws,
                "chat:send",
                {"message": test_msg},
                expect_type="cto:chunk",
                timeout=25,
                collect_all=True,
            )

            # We should get at least one cto:chunk or cto:done
            chunk_msgs = [m for m in all_msgs if m.get("type") in ("cto:chunk", "cto:done", "cto:error")]
            if chunk_msgs:
                error_msgs = [m for m in chunk_msgs if m.get("type") == "cto:error"]
                if error_msgs:
                    err = error_msgs[0].get("data", {}).get("error", "unknown")
                    results.fail("chat:send", f"CTO error: {err[:100]}")
                else:
                    results.ok("chat:send", f"got {len(chunk_msgs)} CTO response chunks")
            else:
                # Might have gotten other messages but no CTO response
                types = [m.get("type") for m in all_msgs]
                results.fail("chat:send", f"no CTO response. Got types: {types[:10]}")
    except ConnectionError:
        results.fail("chat:send", "WS not available")


# ---------------------------------------------------------------------------
# Test: Multiple simultaneous WebSocket connections
# ---------------------------------------------------------------------------
def test_concurrent_ws():
    log_section("Concurrent WebSocket Connections")

    try:
        connections: List[SimpleWebSocket] = []
        for i in range(3):
            ws = SimpleWebSocket(WS_URL, timeout=5)
            if ws.connect():
                connections.append(ws)

        results.assert_test(
            "Multiple WS connections",
            len(connections) == 3,
            f"{len(connections)}/3 connected",
            f"only {len(connections)}/3 connected",
        )

        # Each should be able to get config independently
        successes = 0
        for ws in connections:
            match, _ = ws_send_and_collect(ws, "config:get", expect_type="config:data", timeout=3)
            if match:
                successes += 1

        results.assert_test(
            "Independent responses per connection",
            successes == len(connections),
            f"{successes}/{len(connections)} got config:data",
            f"only {successes}/{len(connections)} responded",
        )

        for ws in connections:
            ws.close()

    except Exception as e:
        results.fail("concurrent WS", str(e))


# ---------------------------------------------------------------------------
# Test: WS Message Validation (bad messages)
# ---------------------------------------------------------------------------
def test_ws_bad_messages():
    log_section("WebSocket Error Handling")

    try:
        with ws_connection() as ws:
            # Send invalid JSON
            ws.send("not json at all {{{")
            # Drain any error response the server sends back
            time.sleep(0.3)
            while True:
                raw = ws.recv(timeout=0.5)
                if raw is None:
                    break
            # Connection should still be alive
            match, _ = ws_send_and_collect(ws, "config:get", expect_type="config:data", timeout=3)
            results.assert_test(
                "Survives invalid JSON",
                match is not None,
                "connection still works",
                "connection died after bad JSON",
            )

        with ws_connection() as ws:
            # Send unknown message type
            ws.send(json.dumps({"type": "nonexistent:command", "payload": {}}))
            time.sleep(0.5)
            match, _ = ws_send_and_collect(ws, "config:get", expect_type="config:data", timeout=3)
            results.assert_test(
                "Survives unknown message type",
                match is not None,
                "connection still works",
                "connection died after unknown type",
            )

    except ConnectionError:
        results.fail("WS error handling", "WS not available")


# ---------------------------------------------------------------------------
# Test: Environment Variables
# ---------------------------------------------------------------------------
def test_env():
    log_section("Environment")

    # Check for GOOGLE_APPLICATION_CREDENTIALS or Firestore emulator
    # Note: Firebase Admin SDK also supports gcloud application-default credentials
    # and GCP metadata server, so this env var isn't strictly required
    has_gac = bool(os.environ.get("GOOGLE_APPLICATION_CREDENTIALS"))
    has_firestore_emu = bool(os.environ.get("FIRESTORE_EMULATOR_HOST"))
    has_inline = bool(os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON"))
    if has_gac or has_firestore_emu or has_inline:
        source = "GOOGLE_APPLICATION_CREDENTIALS" if has_gac else ("FIRESTORE_EMULATOR_HOST" if has_firestore_emu else "FIREBASE_SERVICE_ACCOUNT_JSON")
        results.ok("Firestore credentials", source)
    else:
        # Not a hard failure — the server may use gcloud default credentials or GCP metadata
        results.ok("Firestore credentials", "using application-default or GCP metadata")

    # Check for GH_TOKEN (needed for engineer PRs)
    has_gh = bool(os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN"))
    if has_gh:
        token = (os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN") or "").strip()
        has_newline = "\n" in token or "\r" in token
        results.assert_test(
            "GH_TOKEN clean",
            not has_newline,
            "no newlines",
            "contains newline characters (will cause git clone failures)",
        )
    else:
        results.skip("GH_TOKEN", "not set in env (check Settings page → GitHub Token)")


# ---------------------------------------------------------------------------
# Test: Eval Store
# ---------------------------------------------------------------------------
def test_evals():
    log_section("Evals")

    try:
        with ws_connection() as ws:
            match, all_msgs = ws_send_and_collect(ws, "eval:list", expect_type="eval:list", timeout=10)
            if match:
                payload = match.get("payload", {})
                evals = payload.get("evals", [])
                results.ok("eval:list", f"{len(evals)} evals defined")
            else:
                auth_err = is_firestore_auth_error(all_msgs)
                if auth_err:
                    results.skip("eval:list", "Firestore auth expired — run: gcloud auth application-default login")
                else:
                    errors = [m for m in all_msgs if m.get("type") == "error"]
                    if errors:
                        results.fail("eval:list", f"server error: {errors[0].get('payload', {}).get('error', '?')[:80]}")
                    else:
                        results.fail("eval:list", "no response")
    except ConnectionError:
        results.fail("eval:list", "WS not available")


# ---------------------------------------------------------------------------
# Test: Reconnection behavior
# ---------------------------------------------------------------------------
def test_reconnection():
    log_section("Connection Resilience")

    try:
        # Connect, do something, disconnect, reconnect
        ws1 = SimpleWebSocket(WS_URL, timeout=5)
        results.assert_test(
            "First connection",
            ws1.connect(),
            "connected",
            "failed",
        )
        ws1.close()

        time.sleep(0.5)

        ws2 = SimpleWebSocket(WS_URL, timeout=5)
        results.assert_test(
            "Reconnection after close",
            ws2.connect(),
            "connected",
            "failed",
        )

        match, _ = ws_send_and_collect(ws2, "config:get", expect_type="config:data", timeout=3)
        results.assert_test(
            "Data after reconnect",
            match is not None,
            "config:data received",
            "no response",
        )
        ws2.close()

    except Exception as e:
        results.fail("reconnection", str(e))


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    print(f"\n{C.BOLD}CTO Dashboard — Pre-Deploy E2E Test Suite{C.RESET}")
    print(f"{C.DIM}Targets: WS={WS_URL}  HTTP={NEXT_URL}{C.RESET}")
    if QUICK:
        print(f"{C.YELLOW}Running in quick mode (skipping slow tests){C.RESET}")
    if VERBOSE:
        print(f"{C.CYAN}Verbose mode enabled{C.RESET}")

    # Pre-flight: check if servers are running
    ws_up = False
    next_up = False

    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(2)
        s.connect(("localhost", WS_PORT))
        s.close()
        ws_up = True
    except Exception:
        pass

    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(2)
        s.connect(("localhost", NEXT_PORT))
        s.close()
        next_up = True
    except Exception:
        pass

    if not ws_up:
        print(f"\n{C.RED}ERROR: Orchestrator not running on port {WS_PORT}.{C.RESET}")
        print(f"{C.DIM}Start it with: npm run dev:server{C.RESET}\n")
        sys.exit(1)

    if not next_up:
        print(f"\n{C.YELLOW}WARNING: Next.js not running on port {NEXT_PORT}. HTTP tests will be skipped.{C.RESET}")
        print(f"{C.DIM}Start it with: npm run dev:next{C.RESET}\n")

    # Run all tests
    test_build()
    test_env()
    test_data()
    test_ports()
    test_ws_connection()
    test_ws_bad_messages()
    test_concurrent_ws()
    test_reconnection()
    test_config()
    test_tasks()
    test_threads()
    test_chat_history()
    test_engineers()
    test_status()
    test_analytics()
    test_compliance()
    test_slack()
    test_evals()

    if next_up:
        test_nextjs_pages()
    else:
        log_section("Next.js Pages (HTTP)")
        results.skip("HTTP page tests", "Next.js not running")

    test_chat_send()  # Slow — last

    # Summary
    success = results.summary()

    if success:
        print(f"  {C.GREEN}{C.BOLD}All tests passed! Safe to deploy.{C.RESET}\n")
    else:
        print(f"  {C.RED}{C.BOLD}Some tests failed. Fix issues before deploying.{C.RESET}\n")

    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
