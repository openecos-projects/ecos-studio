import copy
import json
from dataclasses import replace

from ecos_agent.context_status import StatusSnapshots, gui_status_context
from ecos_agent.gui.session import ProviderSession
from ecos_agent.optimization.contracts import BudgetSnapshot, EpisodeBudget
from ecos_agent.optimization.planning import planning_context_payload
from tests.optimization.test_codex_proposal_provider import _context, _domain, _proposal_v2, _provider


def test_status_projects_gui_state_without_inventing_completion():
    session = ProviderSession(session_id="session-1")
    session.pending_interaction = {"request": {"requestId": "request-1"}}
    payload = {"session_state": gui_status_context(session)}
    original = copy.deepcopy(payload)
    snapshots = StatusSnapshots()
    first = snapshots.build(payload, "thread-1")
    assert first["phase"] == "home_ready"
    assert first["progress"]["completed"] is None
    assert first["progress"]["pending"] == ["request-1"]
    assert first["last_action"] is None
    assert first["environment"]["baseline"] == "first_snapshot"
    assert payload == original
    assert StatusSnapshots().build(payload, "thread-1") == first
    payload["session_state"]["phase"] = "workspace_confirmation"
    second = snapshots.build(payload, "thread-1")
    assert second["snapshot_seq"] == 2
    assert "phase" in second["environment"]["changed_fields"]
    payload["session_state"]["phase"] = "home_ready"
    assert "phase" in snapshots.build(payload, "thread-1")["environment"]["changed_fields"]
    assert snapshots.build(payload, "thread-2")["environment"]["baseline"] == "first_snapshot"


def test_status_projects_budget_and_history_without_changing_business_payload():
    budget = BudgetSnapshot(budget=EpisodeBudget.from_reference_rerun(10), consumed_candidates=2)
    context = replace(_context(), budget=budget)
    payload = planning_context_payload(context)
    original = copy.deepcopy(payload)
    status = StatusSnapshots().build(payload, "thread-1")
    assert status["scope"]["episode_id"] == context.context_ref.episode_id
    assert status["budget"]["remaining_candidates"] == budget.remaining_candidates
    assert status["budget"]["remaining_planning_calls"] == budget.remaining_planning_calls
    assert status["last_action"]["outcome"] == "degraded"
    assert status["last_action"]["terminal_observation_ref"] is None
    assert payload == original


def test_both_provider_lanes_receive_status(tmp_path, monkeypatch):
    provider = _provider(tmp_path)
    monkeypatch.setattr(provider, "_ensure_client", lambda: object())
    monkeypatch.setattr(provider, "_ensure_thread", lambda client: "thread-1")
    prompts = []
    context = _context()

    def run(prompt, schema, **kwargs):
        prompts.append(prompt)
        return json.dumps(_proposal_v2(context, _domain()))

    monkeypatch.setattr(provider, "_run_turn", run)
    provider.propose_v2(context, _domain())
    planning = json.loads(prompts[-1].split("USER AND EVIDENCE CONTEXT JSON\n")[1])
    assert planning["agent_status"]["phase"] == "optimization_planning"
    provider._request_json(
        system="Chat", user={"session_state": gui_status_context(ProviderSession("s"))}, output_schema={}
    )
    chat = json.loads(prompts[-1].split("USER AND EVIDENCE CONTEXT JSON\n")[1])
    assert chat["agent_status"]["phase"] == "home_ready"
    assert "session_state" not in chat
