"""Local-only HTTP boundary tests: no real provider configuration or credentials."""
import hashlib
import http.client
import json
import threading
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

from ecos_agent.codex.request_audit import RequestAudit, RequestAuditError


@pytest.fixture
def upstream():
    received = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            body = self.rfile.read(int(self.headers['Content-Length']))
            received.append((self.path, body, dict(self.headers)))
            self.send_response(503 if b'failure' in body else 200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(b'{}')

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = threading.Thread(target=server.serve_forever)
    thread.start()
    yield server.server_port, received
    server.shutdown()
    server.server_close()
    thread.join()


def environment(tmp_path, port, *, stage='smoke', episode='episode-1'):
    home = tmp_path / 'home'
    home.mkdir(exist_ok=True)
    (home / 'catalog.json').write_text('{"models": []}')
    (home / 'config.toml').write_text(f'''model_provider = "ZAI"
model = "mock-model"
model_reasoning_effort = "high"
model_catalog_json = "{home / 'catalog.json'}"
[model_providers.ZAI]
name = "mock"
base_url = "http://127.0.0.1:{port}/v1"
env_key = "ZAI_API_KEY"
wire_api = "responses"
request_max_retries = 4
stream_max_retries = 6
[model_providers.ZAI.env_http_headers]
x-test-account = "MOCK_ACCOUNT"
''')
    audit_dir = tmp_path / 'audit'
    if not audit_dir.exists():
        RequestAudit.initialize(audit_dir, batch_id='batch-1')
    return {'CODEX_HOME': str(home), 'ZAI_API_KEY': 'fake-key', 'MOCK_ACCOUNT': 'fake-account',
            'ECOS_PROVIDER_HTTP_AUDIT_DIR': str(audit_dir),
            'ECOS_PROVIDER_HTTP_AUDIT_STAGE': stage,
            'ECOS_PROVIDER_HTTP_AUDIT_EPISODE_ID': episode,
            'ECOS_PROVIDER_HTTP_AUDIT_PLANNING_REQUEST_ID': 'planning-1'}


def post(audit, body=b'{"model":"mock-model"}', path='/responses', token=True):
    conn = http.client.HTTPConnection('127.0.0.1', audit.port, timeout=5)
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['X-Ecos-Audit-Token'] = audit.token
    conn.request('POST', path, body, headers)
    response = conn.getresponse()
    status = response.status
    response.read()
    conn.close()
    return status


def rows(env):
    return [json.loads(line) for line in (Path(env['ECOS_PROVIDER_HTTP_AUDIT_DIR']) / 'requests.jsonl').read_text().splitlines()]


def test_actual_body_compaction_failure_and_no_recharge(tmp_path, upstream):
    port, received = upstream
    env = environment(tmp_path, port)
    audit = RequestAudit.from_env(env)
    with audit:
        assert post(audit, b'{"model":"mock-model","input":"failure"}') == 503
        assert post(audit, path='/responses/compact') == 200
        for _ in range(4):
            assert post(audit) == 200
        assert post(audit) == 429
    with RequestAudit.from_env(env) as resumed:
        assert post(resumed) == 429
    assert len(received) == 6
    records = rows(env)
    reservations = [r for r in records if r['event'] == 'reserved']
    assert len(reservations) == 6
    assert len([r for r in records if r['event'] == 'dispatched']) == 6
    assert len([r for r in records if r['event'] == 'outcome']) == 6
    for record, (_, body, headers) in zip(reservations, received):
        assert record['episode_id'] == 'episode-1'
        assert record['planning_request_id'] == 'planning-1'
        assert record['body_sha256'] == hashlib.sha256(body).hexdigest()
        assert (Path(env['ECOS_PROVIDER_HTTP_AUDIT_DIR']) / record['body_file']).read_bytes() == body
        assert headers['Authorization'] == 'Bearer fake-key'
        assert next(value for key, value in headers.items() if key.lower() == 'x-test-account') == 'fake-account'
        assert 'X-Ecos-Audit-Token' not in headers
    serialized = json.dumps(records)
    assert 'fake-key' not in serialized and 'fake-account' not in serialized
    assert str(port) not in serialized


def test_allowlist_auth_and_trial_single_shot(tmp_path, upstream):
    port, received = upstream
    env = environment(tmp_path, port, stage='rq2')
    with RequestAudit.from_env(env) as audit:
        for path in ['/responses?x=1', '//responses', '/responses/../models', '/models', 'http://example.org/responses']:
            assert post(audit, path=path) == 403
        assert post(audit, token=False) == 403
        assert post(audit, b'{"model":"other"}') == 403
        assert post(audit) == 200
        assert post(audit, path='/responses/compact') == 429
    assert len(received) == 1


def test_concurrent_proxy_instances_share_episode_limit(tmp_path, upstream):
    port, received = upstream
    env = environment(tmp_path, port)
    with RequestAudit.from_env(env) as a, RequestAudit.from_env(env) as b:
        with ThreadPoolExecutor(max_workers=12) as pool:
            statuses = list(pool.map(lambda i: post(a if i % 2 else b), range(12)))
    assert statuses.count(200) == 6
    assert statuses.count(429) == 6
    assert len(received) == 6


def test_opt_in_and_explicit_non_reinitializable_ledger(tmp_path, upstream):
    assert RequestAudit.from_env({}) is None
    with pytest.raises(RequestAuditError):
        RequestAudit.from_env({'ECOS_PROVIDER_HTTP_AUDIT_STAGE': 'rq1'})
    env = environment(tmp_path, upstream[0])
    with pytest.raises((FileExistsError, RequestAuditError)):
        RequestAudit.initialize(Path(env['ECOS_PROVIDER_HTTP_AUDIT_DIR']), batch_id='batch-1')
    (Path(env['ECOS_PROVIDER_HTTP_AUDIT_DIR']) / 'requests.jsonl').unlink()
    with pytest.raises((FileNotFoundError, RequestAuditError)):
        RequestAudit.from_env(env)


def test_child_codex_config_preserves_provider_semantics_but_closes_retries(tmp_path, upstream):
    env = environment(tmp_path, upstream[0])
    audit = RequestAudit.from_env(env)
    child = audit.child_env(env)
    child_config = json.loads(json.dumps(toml_load(Path(child['CODEX_HOME']) / 'config.toml')))
    provider = child_config['model_providers']['ZAI']
    assert provider['base_url'].startswith('http://127.0.0.1:')
    assert provider['env_key'] == 'ZAI_API_KEY'
    assert provider['env_http_headers']['x-test-account'] == 'MOCK_ACCOUNT'
    assert provider['env_http_headers']['x-ecos-audit-token'] == 'ECOS_PROVIDER_HTTP_AUDIT_TOKEN'
    assert provider['request_max_retries'] == 0
    assert provider['stream_max_retries'] == 0
    assert provider['supports_websockets'] is False
    assert child['ECOS_PROVIDER_HTTP_AUDIT_TOKEN'] == audit.token
    audit.close()


def toml_load(path: Path) -> dict:
    import tomllib
    return tomllib.loads(path.read_text(encoding='utf-8'))
