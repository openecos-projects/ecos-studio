import hashlib

import pytest

from ecos_agent.knowledge.generation import general_details
from ecos_agent.knowledge.retriever import GlobalKnowledgeRetriever
from ecos_agent.knowledge.step import load_default_general_knowledge_bundles
from ecos_agent.optimization.parameters.semantics import load_parameter_cards


def test_unknown_knob_cannot_be_silently_removed_from_a_binding():
    binding = {"knobs": [{"knob_id": "floorplan.global_right_padding"}]}
    with pytest.raises(ValueError, match="parameter card is unavailable"):
        general_details._binding_actions(binding, load_parameter_cards())


def test_analog_is_rendered_from_compiled_actions():
    binding = {"analog_quality": "coarse", "knobs": []}
    actions = [{"knob_id": "place.routability_opt", "direction": "enable"}]
    assert general_details._analog(binding, actions) == (
        "enable `place.routability_opt` (coarse analog)"
    )
    assert "No authorized knob" in general_details._analog(binding, [])


def test_native_evidence_is_checked_against_source(tmp_path, monkeypatch):
    monkeypatch.setattr(general_details, "ECOS_ROOT", tmp_path)
    source = tmp_path / "consumer.py"
    source.write_text("value = requested\n", encoding="utf-8")
    statement = {"evidence": [{
        "source_id": "source.consumer", "source_path": "consumer.py",
        "start": 1, "end": 1, "span": "value = requested\n",
        "span_sha256": hashlib.sha256(b"value = requested\n").hexdigest(),
    }]}
    assert general_details._validate_evidence(statement) == {
        "source.consumer": "consumer.py"
    }
    source.write_text("value = ignored\n", encoding="utf-8")
    with pytest.raises(ValueError, match="source evidence"):
        general_details._validate_evidence(statement)


@pytest.mark.parametrize("stage,query,entity", [
    ("place", "EGR routing pressure tighten stop_overflow threshold density convergence trial",
     "strategy.congestion.trial_tighter_density_convergence.v1"),
    ("place", "stronger initial density penalty coefficient gradient balanced initialization",
     "strategy.congestion.trial_stronger_initial_density_penalty.v1"),
    ("floorplan", "die-util core whitespace lower utilization larger area exploration",
     "strategy.congestion.trial_core_whitespace.v1"),
    ("floorplan", "aspect ratio above one trial lower configured ratio geometry perimeter",
     "strategy.wirelength.trial_wide_core_shape.v1"),
])
def test_new_knob_strategies_are_retrievable_with_source_limits(stage, query, entity):
    retriever = GlobalKnowledgeRetriever(load_default_general_knowledge_bundles())
    answer = retriever.reply_for_stages(query, (stage,))
    assert answer is not None
    assert entity in answer.entity_ids
    assert "source_derived_hypothesis" in answer.text
    assert "Binding limits" in answer.text
