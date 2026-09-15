"""Step-catalog sync contracts.

The optimization runtime converts planning stages through ``ECCStepName``;
every candidate target must therefore map to valid flow steps, and the agent
catalog must stay identical to the Electron ``ECC_FLOW_STEPS`` list.
"""

from __future__ import annotations

import re
from pathlib import Path

from ecos_agent.ecc_contracts import ECCStepName
from ecos_agent.optimization.contracts import OptimizationKnob
from ecos_agent.optimization.execution import (
    candidate_observation_stage,
    candidate_target_step,
)

from tests.paths import AGENT_ROOT

GUI_FLOW_STEPS_PATH = (
    AGENT_ROOT.parent
    / "gui"
    / "packages"
    / "shared"
    / "src"
    / "contracts"
    / "eccFlowSteps.ts"
)


def test_every_knob_observes_only_valid_flow_steps() -> None:
    for knob in OptimizationKnob:
        stage = candidate_observation_stage(candidate_target_step(knob))
        ECCStepName(stage)  # raises ValueError on the 'Floorplan'-style leak


def test_floorplan_target_observes_the_post_floorplan_step() -> None:
    assert candidate_target_step(OptimizationKnob.FLOORPLAN_CORE_UTIL) == "Floorplan"
    assert candidate_observation_stage("Floorplan") == "postFloorplan"
    assert candidate_observation_stage("place") == "place"


def test_agent_catalog_matches_the_gui_flow_steps() -> None:
    source = GUI_FLOW_STEPS_PATH.read_text(encoding="utf-8")
    block = re.search(r"ECC_FLOW_STEPS = \[(.*?)\] as const", source, re.DOTALL)
    assert block is not None, "ECC_FLOW_STEPS not found in eccFlowSteps.ts"
    gui_steps = re.findall(r"'([^']+)'", block.group(1))

    assert [step.value for step in ECCStepName] == gui_steps
