"""Opt-in localhost HTTP boundary and shared request ledger for experiments."""
from __future__ import annotations

import fcntl
import hashlib
import json
import os
import secrets
import shutil
import tempfile
import threading
import tomllib
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Mapping
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener


class RequestAuditError(RuntimeError):
    pass


_BUDGETS = {"smoke": 6, "formal": 60, "rq2": 1, "rq1": 1}
_CORE_BUDGET = 7344
# Lowercase on the wire: the installed codex app-server resolves and forwards
# lowercase custom env_http_headers only (verified against 0.159.2); the proxy
# lookup is case-insensitive either way.
_TOKEN_HEADER = "x-ecos-audit-token"
_TOKEN_ENV = "ECOS_PROVIDER_HTTP_AUDIT_TOKEN"


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *_args: Any, **_kwargs: Any):
        return None


_NO_PROXY_OPENER = build_opener(ProxyHandler({}), _NoRedirect())


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _toml_string(value: str) -> str:
    return json.dumps(value)


def _effective_config(config: Mapping[str, Any]) -> dict[str, Any]:
    profile_name = config.get("profile")
    profile = (config.get("profiles") or {}).get(profile_name, {}) if profile_name else {}
    effective = dict(config)
    if isinstance(profile, dict):
        for key in ("model", "model_provider", "model_reasoning_effort", "model_catalog_json"):
            if key in profile:
                effective[key] = profile[key]
    return effective


def _provider_table(config: Mapping[str, Any]) -> tuple[str, dict[str, Any]]:
    config = _effective_config(config)
    active = config.get("model_provider")
    providers = config.get("model_providers") or {}
    if not isinstance(active, str) or not isinstance(providers.get(active), dict):
        raise RequestAuditError("active Codex provider is missing from CODEX_HOME/config.toml")
    return active, dict(providers[active])


def _write_provider_config(source: Path, destination: Path, proxy_url: str, token: str) -> tuple[str, dict[str, Any]]:
    try:
        parsed = _effective_config(tomllib.loads(source.read_text(encoding="utf-8")))
    except (OSError, tomllib.TOMLDecodeError) as exc:
        raise RequestAuditError("cannot read CODEX_HOME/config.toml") from exc
    provider_id, provider = _provider_table(parsed)
    original_headers = provider.get("env_http_headers") or {}
    if not isinstance(original_headers, dict) or any(
        not isinstance(k, str) or not isinstance(v, str) for k, v in original_headers.items()
    ):
        raise RequestAuditError("active provider env_http_headers is invalid")
    # Keep the original provider/account/header semantics, but force all child
    # traffic through the authenticated localhost boundary and disable hidden retry.
    provider = dict(provider)
    provider["base_url"] = proxy_url
    provider["request_max_retries"] = 0
    provider["stream_max_retries"] = 0
    provider["supports_websockets"] = False
    headers = dict(original_headers)
    headers[_TOKEN_HEADER] = _TOKEN_ENV
    provider["env_http_headers"] = headers
    env_key = provider.get("env_key")
    if env_key is not None and not isinstance(env_key, str):
        raise RequestAuditError("active provider env_key is invalid")

    # This is intentionally a small, explicit config projection rather than a
    # TOML rewrite dependency. It preserves the model/provider knobs used by the
    # app-server and rejects unsupported nested configuration rather than guessing.
    lines = []
    for key in ("model", "model_reasoning_effort", "model_catalog_json"):
        value = parsed.get(key)
        if value is not None:
            if not isinstance(value, (str, int, float, bool)):
                raise RequestAuditError(f"unsupported scalar Codex config: {key}")
            lines.append(f"{key} = {json.dumps(value)}")
    lines.append(f"model_provider = {_toml_string(provider_id)}")
    lines.append("")
    lines.append(f"[model_providers.{provider_id}]")
    scalar_keys = (
        "name", "env_key", "wire_api", "requires_openai_auth", "request_max_retries",
        "stream_max_retries", "supports_websockets", "supports_standalone_web_search",
        "stream_idle_timeout_ms", "websocket_connect_timeout_ms",
    )
    for key in scalar_keys:
        value = provider.get(key)
        if value is not None:
            if not isinstance(value, (str, int, float, bool)):
                raise RequestAuditError(f"unsupported provider config: {key}")
            lines.append(f"{key} = {json.dumps(value)}")
    lines.append(f"base_url = {_toml_string(proxy_url)}")
    for table_key in ("env_http_headers", "http_headers", "query_params"):
        values = provider.get(table_key)
        if values:
            if not isinstance(values, dict) or any(not isinstance(k, str) or not isinstance(v, str) for k, v in values.items()):
                raise RequestAuditError(f"unsupported provider headers: {table_key}")
            lines.append("")
            lines.append(f"[model_providers.{provider_id}.{table_key}]")
            lines.extend(f"{json.dumps(k)} = {json.dumps(v)}" for k, v in values.items())
    destination.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return provider_id, provider


class _ProxyHandler(BaseHTTPRequestHandler):
    server: "_AuditServer"

    def do_POST(self) -> None:  # noqa: N802
        audit = self.server.audit
        if self.headers.get(_TOKEN_HEADER) != audit.token:
            self._reject(403)
            return
        raw_path = self.raw_requestline.split(b" ", 2)[1].decode("ascii", "replace") if self.raw_requestline else self.path
        if raw_path not in {"/responses", "/responses/compact"} or self.path not in {"/responses", "/responses/compact"}:
            self._reject(403)
            return
        try:
            length = int(self.headers.get("Content-Length", "-1"))
            if length < 0 or length > audit.max_body_bytes:
                self._reject(413)
                return
            body = self.rfile.read(length)
            if audit.model is not None:
                try:
                    request_model = json.loads(body).get("model")
                except (json.JSONDecodeError, AttributeError):
                    request_model = None
                if request_model is not None and request_model != audit.model:
                    self._reject(403)
                    return
            reservation = audit.reserve(self.path, body)
        except RequestAuditError:
            self._reject(429)
            return
        headers = {"Content-Type": self.headers.get("Content-Type", "application/json")}
        try:
            audit.dispatched(reservation)
            response = audit.forward(self.path, body, headers)
            status = response.status
            payload = response.read()
            content_type = response.headers.get("Content-Type", "application/json")
        except Exception as exc:  # transport failures are counted, never retried here
            from urllib.error import HTTPError
            if isinstance(exc, HTTPError):
                status, payload = exc.code, exc.read()
                content_type = exc.headers.get("Content-Type", "application/json")
            else:
                audit.outcome(reservation, error=type(exc).__name__)
                self._reject(502)
                return
        audit.outcome(reservation, status=status)
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.end_headers()
        self.wfile.write(payload)

    def _reject(self, status: int) -> None:
        self.send_response(status)
        self.end_headers()

    def log_message(self, *_args: object) -> None:
        return


class _AuditServer(ThreadingHTTPServer):
    allow_reuse_address = False
    daemon_threads = True

    def __init__(self, address: tuple[str, int], audit: "RequestAudit") -> None:
        self.audit = audit
        super().__init__(address, _ProxyHandler)


class RequestAudit:
    """Opt-in, fail-closed, process-local proxy backed by an NFS append ledger."""

    max_body_bytes = 32 * 1024 * 1024

    def __init__(self, directory: Path, *, stage: str, episode_id: str, planning_request_id: str,
                 upstream_url: str, provider_id: str, env: Mapping[str, str], model: str | None = None, token: str | None = None) -> None:
        if stage not in _BUDGETS or not episode_id or not planning_request_id:
            raise RequestAuditError("invalid audit stage or stable identifiers")
        split = urlsplit(upstream_url)
        if split.scheme not in {"http", "https"} or not split.hostname or split.username or split.password:
            raise RequestAuditError("active provider base_url is not an allowed absolute URL")
        self.directory = directory
        self.stage, self.episode_id = stage, episode_id
        self.planning_request_id = planning_request_id
        self.upstream_url = upstream_url.rstrip("/")
        self.provider_id = provider_id
        self.model = model
        self.upstream_headers = self._resolve_headers(env)
        self.token = token or secrets.token_urlsafe(32)
        self._server: _AuditServer | None = None
        self._thread: threading.Thread | None = None
        self._temp_home: tempfile.TemporaryDirectory[str] | None = None
        self._context_lock = threading.Lock()

    @classmethod
    def initialize(cls, directory: Path, *, batch_id: str) -> None:
        directory = Path(directory)
        directory.mkdir(parents=True, exist_ok=False)
        directory.chmod(0o700)
        (directory / "bodies").mkdir(mode=0o700)
        (directory / "ledger.lock").touch(mode=0o600)
        (directory / "requests.jsonl").touch(mode=0o600)
        (directory / "manifest.json").write_text(
            json.dumps({"schema_version": "ecos.provider_http_audit.v1", "batch_id": batch_id}, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        (directory / "manifest.json").chmod(0o600)

    @classmethod
    def from_env(cls, env: Mapping[str, str]) -> "RequestAudit | None":
        directory_value = env.get("ECOS_PROVIDER_HTTP_AUDIT_DIR")
        if not directory_value:
            if any(key.startswith("ECOS_PROVIDER_HTTP_AUDIT_") for key in env):
                raise RequestAuditError("provider HTTP audit configuration is incomplete")
            return None
        required = ("ECOS_PROVIDER_HTTP_AUDIT_STAGE", "ECOS_PROVIDER_HTTP_AUDIT_EPISODE_ID", "ECOS_PROVIDER_HTTP_AUDIT_PLANNING_REQUEST_ID", "CODEX_HOME")
        if any(not env.get(key) for key in required):
            raise RequestAuditError("provider HTTP audit configuration is incomplete")
        directory = Path(directory_value)
        if not (directory / "manifest.json").is_file() or not (directory / "ledger.lock").is_file() or not (directory / "requests.jsonl").is_file():
            raise RequestAuditError("provider HTTP audit ledger is not initialized")
        source = Path(env["CODEX_HOME"]) / "config.toml"
        # Bind after the active provider has been resolved. No endpoint is written to the ledger.
        parsed = _effective_config(tomllib.loads(source.read_text(encoding="utf-8")))
        provider_id, provider = _provider_table(parsed)
        upstream = provider.get("base_url")
        if not isinstance(upstream, str):
            raise RequestAuditError("active provider base_url is missing")
        query_params = provider.get("query_params") or {}
        if query_params:
            if not isinstance(query_params, dict) or any(not isinstance(k, str) or not isinstance(v, str) for k, v in query_params.items()):
                raise RequestAuditError("active provider query_params are invalid")
            upstream = upstream + ("&" if "?" in upstream else "?") + urlencode(query_params)
        model = parsed.get("model")
        if model is not None and not isinstance(model, str):
            raise RequestAuditError("active Codex model is invalid")
        audit = cls(directory, stage=env["ECOS_PROVIDER_HTTP_AUDIT_STAGE"], episode_id=env["ECOS_PROVIDER_HTTP_AUDIT_EPISODE_ID"], planning_request_id=env["ECOS_PROVIDER_HTTP_AUDIT_PLANNING_REQUEST_ID"], upstream_url=upstream, provider_id=provider_id, model=model, env=env)
        return audit

    @property
    def single_shot(self) -> bool:
        return self.stage in {"rq1", "rq2"}

    def set_context(self, *, planning_request_id: str, episode_id: str | None = None) -> None:
        if not planning_request_id:
            raise RequestAuditError("planning_request_id must not be empty")
        with self._context_lock:
            self.planning_request_id = planning_request_id
            if episode_id is not None:
                self.episode_id = episode_id

    def child_env(self, env: Mapping[str, str]) -> dict[str, str]:
        if self._server is None:
            self.start()
        assert self._server is not None
        if self._temp_home is None:
            self._temp_home = tempfile.TemporaryDirectory(prefix="ecos-codex-audit-")
            home = Path(self._temp_home.name)
            source_home = Path(env["CODEX_HOME"])
            source_config = source_home / "config.toml"
            _write_provider_config(source_config, home / "config.toml", f"http://127.0.0.1:{self.port}", self.token)
            (home / "config.toml").chmod(0o600)
            catalog = source_home / "models.json"
            if catalog.is_file() and not (home / "models.json").exists():
                shutil.copy2(catalog, home / "models.json")
        child = dict(env)
        child["CODEX_HOME"] = self._temp_home.name
        child[_TOKEN_ENV] = self.token
        return child

    @property
    def port(self) -> int:
        if self._server is None:
            raise RequestAuditError("audit server is not started")
        return self._server.server_address[1]

    def start(self) -> None:
        if self._server is None:
            self._server = _AuditServer(("127.0.0.1", 0), self)
            self._thread = threading.Thread(target=self._server.serve_forever, name="ecos-provider-audit", daemon=True)
            self._thread.start()

    def close(self) -> None:
        if self._server is not None:
            self._server.shutdown()
            self._server.server_close()
            if self._thread is not None:
                self._thread.join(timeout=2)
            self._server = None
        if self._temp_home is not None:
            self._temp_home.cleanup()
            self._temp_home = None

    def __enter__(self) -> "RequestAudit":
        self.start()
        return self

    def __exit__(self, *_args: object) -> None:
        self.close()

    def _resolve_headers(self, env: Mapping[str, str]) -> dict[str, str]:
        source = tomllib.loads((Path(env["CODEX_HOME"]) / "config.toml").read_text(encoding="utf-8"))
        _, provider = _provider_table(source)
        headers: dict[str, str] = {}
        env_key = provider.get("env_key")
        if isinstance(env_key, str) and env.get(env_key):
            headers["Authorization"] = f"Bearer {env[env_key]}"
        configured = provider.get("env_http_headers") or {}
        for name, variable in configured.items():
            if name.lower() == _TOKEN_HEADER.lower():
                continue
            value = env.get(variable) if isinstance(variable, str) else None
            if value:
                headers[name] = value
        for name, value in (provider.get("http_headers") or {}).items():
            if isinstance(name, str) and isinstance(value, str):
                headers[name] = value
        return headers

    def _with_lock(self):
        lock = (self.directory / "ledger.lock").open("r+")
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        return lock

    def _append(self, record: dict[str, Any], lock) -> None:
        with (self.directory / "requests.jsonl").open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(record, sort_keys=True, separators=(",", ":")) + "\n")
            stream.flush()
            os.fsync(stream.fileno())

    def reserve(self, path: str, body: bytes) -> str:
        body_hash = _sha256(body)
        request_id = uuid.uuid4().hex
        body_file = Path("bodies") / f"{request_id}.bin"
        body_path = self.directory / body_file
        with body_path.open("wb") as stream:
            stream.write(body)
            stream.flush()
            os.fsync(stream.fileno())
        body_path.chmod(0o600)
        lock = self._with_lock()
        try:
            records = [json.loads(line) for line in (self.directory / "requests.jsonl").read_text(encoding="utf-8").splitlines() if line]
            reserved = sum(record.get("event") == "reserved" for record in records)
            episode_reserved = sum(record.get("event") == "reserved" and record.get("stage") == self.stage and record.get("episode_id") == self.episode_id for record in records)
            if reserved >= _CORE_BUDGET or episode_reserved >= _BUDGETS[self.stage]:
                body_path.unlink(missing_ok=True)
                raise RequestAuditError("provider HTTP audit budget exhausted")
            with self._context_lock:
                record = {"event": "reserved", "request_id": request_id, "stage": self.stage, "episode_id": self.episode_id, "planning_request_id": self.planning_request_id, "provider_id": self.provider_id, "path": path, "body_file": str(body_file), "body_sha256": body_hash}
            self._append(record, lock)
        finally:
            fcntl.flock(lock.fileno(), fcntl.LOCK_UN)
            lock.close()
        return request_id

    def forward(self, path: str, body: bytes, headers: Mapping[str, str]):
        request = Request(self.upstream_url + path, data=body, headers=dict(self.upstream_headers) | dict(headers), method="POST")
        return _NO_PROXY_OPENER.open(request, timeout=120)

    def dispatched(self, request_id: str) -> None:
        lock = self._with_lock()
        try:
            self._append({"event": "dispatched", "request_id": request_id}, lock)
        finally:
            fcntl.flock(lock.fileno(), fcntl.LOCK_UN)
            lock.close()

    def outcome(self, request_id: str, *, status: int | None = None, error: str | None = None) -> None:
        lock = self._with_lock()
        try:
            record = {"event": "outcome", "request_id": request_id, "status": status, "error": error}
            self._append(record, lock)
        finally:
            fcntl.flock(lock.fileno(), fcntl.LOCK_UN)
            lock.close()
