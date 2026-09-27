"""Order-balanced provider-only replication for RQ2 opportunity contexts."""

from __future__ import annotations

import random
from collections import Counter
from typing import Any, Callable, Mapping, Sequence

from ecos_agent.optimization.experiments.rq2_adaptive_runner import (
    _one_observation,
    _provider_metadata,
)
from ecos_agent.optimization.experiments.rq2_knowledge_experiment import (
    RQ2_TREATMENTS,
    SAME_GATE_NO_SEMANTIC_GUIDANCE,
    AdaptiveConfig,
    rq2_treatment_projection,
)

LATIN_ROTATIONS = (
    RQ2_TREATMENTS,
    RQ2_TREATMENTS[1:] + RQ2_TREATMENTS[:1],
    RQ2_TREATMENTS[2:] + RQ2_TREATMENTS[:2],
    RQ2_TREATMENTS[3:] + RQ2_TREATMENTS[:3],
)
SHAM_TREATMENTS = (
    RQ2_TREATMENTS[-1],
    SAME_GATE_NO_SEMANTIC_GUIDANCE,
)
SHAM_ROTATIONS = (
    SHAM_TREATMENTS,
    SHAM_TREATMENTS[::-1],
)


def build_order_balanced_schedule(
    contexts: Sequence[Mapping[str, object]],
    *,
    seed: int,
    repeats: int = 3,
    workers: int = 4,
) -> dict[str, object]:
    """Assign one Latin rotation per design/checkpoint and expand call order."""
    if repeats < 1 or workers < 1:
        raise ValueError("repeats and workers must be positive")
    selected = sorted(
        (
            context
            for context in contexts
            if context.get("eligibility") == "eligible"
            and context.get("state_stratum") == "knowledge_opportunity"
        ),
        key=lambda context: (str(context["design"]), str(context["checkpoint"])),
    )
    by_design: dict[str, list[Mapping[str, object]]] = {}
    for context in selected:
        by_design.setdefault(str(context["design"]), []).append(context)
    if not selected or any(
        len(group) != len(LATIN_ROTATIONS) for group in by_design.values()
    ):
        raise ValueError(
            "each design must have exactly four eligible opportunity contexts"
        )

    assignments: list[dict[str, object]] = []
    for design, group in sorted(by_design.items()):
        rotation_ids = list(range(len(LATIN_ROTATIONS)))
        random.Random(f"{seed}:{design}").shuffle(rotation_ids)
        for context, rotation_id in zip(group, rotation_ids, strict=True):
            assignments.append(
                {
                    "design": design,
                    "checkpoint": context["checkpoint"],
                    "context_fingerprint": context["context_fingerprint"],
                    "rotation": f"R{rotation_id}",
                    "treatments": list(LATIN_ROTATIONS[rotation_id]),
                }
            )

    assignments.sort(key=lambda item: (str(item["design"]), str(item["checkpoint"])))
    for index, assignment in enumerate(assignments):
        assignment["worker_index"] = index % workers
        assignment["worker"] = f"{index % workers}/{workers}"

    observations: list[dict[str, object]] = []
    for round_number in range(1, repeats + 1):
        for assignment in assignments:
            sequence_id = (
                f"{assignment['design']}:{assignment['checkpoint']}:"
                f"round-{round_number}"
            )
            for position, treatment in enumerate(assignment["treatments"], start=1):
                observations.append(
                    {
                        "observation_id": f"{sequence_id}:position-{position}",
                        "sequence_id": sequence_id,
                        "sequence_rotation": assignment["rotation"],
                        "sequence_position": position,
                        "round": round_number,
                        "worker": assignment["worker"],
                        "worker_index": assignment["worker_index"],
                        "design": assignment["design"],
                        "checkpoint": assignment["checkpoint"],
                        "context_fingerprint": assignment["context_fingerprint"],
                        "treatment": treatment,
                    }
                )
    return {
        "seed": seed,
        "repeats": repeats,
        "workers": workers,
        "assignments": assignments,
        "observations": observations,
    }


def validate_order_balanced_schedule(schedule: Mapping[str, object]) -> None:
    """Fail closed if a prepared schedule loses its balance or identity."""
    observations = list(schedule["observations"])
    assignments = list(schedule["assignments"])
    repeats = int(schedule["repeats"])
    workers = int(schedule["workers"])
    if len({str(row["observation_id"]) for row in observations}) != len(observations):
        raise ValueError("duplicate observation ids")
    expected_rows = len(assignments) * repeats * len(RQ2_TREATMENTS)
    if len(observations) != expected_rows:
        raise ValueError(
            f"schedule has {len(observations)} rows, expected {expected_rows}"
        )
    if any(int(row["worker_index"]) >= workers for row in observations):
        raise ValueError("worker index is outside the registered worker count")

    by_sequence: dict[str, list[Mapping[str, object]]] = {}
    for row in observations:
        by_sequence.setdefault(str(row["sequence_id"]), []).append(row)
    for sequence_id, rows in by_sequence.items():
        ordered = sorted(rows, key=lambda row: int(row["sequence_position"]))
        if [int(row["sequence_position"]) for row in ordered] != [1, 2, 3, 4]:
            raise ValueError(f"invalid positions for {sequence_id}")
        if set(str(row["treatment"]) for row in ordered) != set(RQ2_TREATMENTS):
            raise ValueError(f"invalid treatments for {sequence_id}")
        if len({str(row["worker"]) for row in ordered}) != 1:
            raise ValueError(f"split worker assignment for {sequence_id}")

    by_design: dict[str, Counter[tuple[str, int]]] = {}
    for assignment in assignments:
        design = str(assignment["design"])
        for position, treatment in enumerate(assignment["treatments"], start=1):
            by_design.setdefault(design, Counter())[(str(treatment), position)] += 1
    if any(
        counts[(treatment, position)] != 1
        for counts in by_design.values()
        for treatment in RQ2_TREATMENTS
        for position in range(1, 5)
    ):
        raise ValueError("Latin position balance is incomplete")


def build_same_gate_sham_schedule(
    contexts: Sequence[Mapping[str, object]],
    *,
    seed: int,
    repeats: int = 3,
    workers: int = 4,
) -> dict[str, object]:
    """Counterbalance Dual and sham calls within each frozen context."""
    if repeats < 1 or workers < 1:
        raise ValueError("repeats and workers must be positive")
    selected = sorted(
        (
            context
            for context in contexts
            if context.get("eligibility") == "eligible"
            and context.get("state_stratum") == "knowledge_opportunity"
        ),
        key=lambda context: (str(context["design"]), str(context["checkpoint"])),
    )
    by_design: dict[str, list[Mapping[str, object]]] = {}
    for context in selected:
        by_design.setdefault(str(context["design"]), []).append(context)
    if not selected or any(len(group) != 4 for group in by_design.values()):
        raise ValueError("each design must have exactly four eligible opportunity contexts")

    assignments: list[dict[str, object]] = []
    for design, group in sorted(by_design.items()):
        rotation_ids = [0, 1, 0, 1]
        random.Random(f"{seed}:{design}:sham").shuffle(rotation_ids)
        for context, rotation_id in zip(group, rotation_ids, strict=True):
            assignments.append(
                {
                    "design": design,
                    "checkpoint": context["checkpoint"],
                    "context_fingerprint": context["context_fingerprint"],
                    "rotation": f"S{rotation_id}",
                    "treatments": list(SHAM_ROTATIONS[rotation_id]),
                }
            )
    assignments.sort(key=lambda item: (str(item["design"]), str(item["checkpoint"])))
    for index, assignment in enumerate(assignments):
        assignment["worker_index"] = index % workers
        assignment["worker"] = f"{index % workers}/{workers}"

    observations: list[dict[str, object]] = []
    for round_number in range(1, repeats + 1):
        for assignment in assignments:
            sequence_id = (
                f"{assignment['design']}:{assignment['checkpoint']}:"
                f"round-{round_number}"
            )
            for position, treatment in enumerate(assignment["treatments"], start=1):
                observations.append(
                    {
                        "observation_id": f"{sequence_id}:position-{position}",
                        "sequence_id": sequence_id,
                        "sequence_rotation": assignment["rotation"],
                        "sequence_position": position,
                        "round": round_number,
                        "worker": assignment["worker"],
                        "worker_index": assignment["worker_index"],
                        "design": assignment["design"],
                        "checkpoint": assignment["checkpoint"],
                        "context_fingerprint": assignment["context_fingerprint"],
                        "treatment": treatment,
                    }
                )
    return {
        "seed": seed,
        "repeats": repeats,
        "workers": workers,
        "assignments": assignments,
        "observations": observations,
    }


def validate_same_gate_sham_schedule(schedule: Mapping[str, object]) -> None:
    """Fail closed if the paired sham schedule loses counterbalance."""
    observations = list(schedule["observations"])
    assignments = list(schedule["assignments"])
    repeats = int(schedule["repeats"])
    workers = int(schedule["workers"])
    if len({str(row["observation_id"]) for row in observations}) != len(observations):
        raise ValueError("duplicate observation ids")
    expected_rows = len(assignments) * repeats * len(SHAM_TREATMENTS)
    if len(observations) != expected_rows:
        raise ValueError(f"schedule has {len(observations)} rows, expected {expected_rows}")
    if any(int(row["worker_index"]) >= workers for row in observations):
        raise ValueError("worker index is outside the registered worker count")
    by_sequence: dict[str, list[Mapping[str, object]]] = {}
    for row in observations:
        by_sequence.setdefault(str(row["sequence_id"]), []).append(row)
    for sequence_id, rows in by_sequence.items():
        ordered = sorted(rows, key=lambda row: int(row["sequence_position"]))
        if [int(row["sequence_position"]) for row in ordered] != [1, 2]:
            raise ValueError(f"invalid positions for {sequence_id}")
        if tuple(str(row["treatment"]) for row in ordered) not in SHAM_ROTATIONS:
            raise ValueError(f"invalid treatment order for {sequence_id}")
        if len({str(row["worker"]) for row in ordered}) != 1:
            raise ValueError(f"split worker assignment for {sequence_id}")
    for design in {str(item["design"]) for item in assignments}:
        rotations = [
            str(item["rotation"])
            for item in assignments
            if str(item["design"]) == design
        ]
        if sorted(rotations) != ["S0", "S0", "S1", "S1"]:
            raise ValueError("sham order is not counterbalanced within design")


def run_order_balanced_worker(
    contexts: Sequence[Mapping[str, object]],
    *,
    schedule: Mapping[str, object],
    worker_index: int,
    provider_factory: Callable[[], Any],
    config: AdaptiveConfig,
    completed_observation_ids: set[str] | None = None,
    on_observation: Callable[[Mapping[str, object]], None] | None = None,
) -> dict[str, object]:
    """Run one registered worker; existing observation IDs are continuation-safe."""
    validate_order_balanced_schedule(schedule)
    workers = int(schedule["workers"])
    if worker_index < 0 or worker_index >= workers:
        raise ValueError("worker index is outside the registered worker count")
    completed = completed_observation_ids or set()
    context_by_fingerprint = {
        str(context["context_fingerprint"]): context for context in contexts
    }
    planned = [
        row
        for row in schedule["observations"]
        if int(row["worker_index"]) == worker_index
    ]
    missing = sorted(
        {
            str(row["context_fingerprint"])
            for row in planned
            if str(row["context_fingerprint"]) not in context_by_fingerprint
        }
    )
    if missing:
        raise ValueError(f"scheduled contexts are absent from bank: {missing}")

    provider = provider_factory()
    provider.select_model(config.model)
    if hasattr(provider, "set_model_settings"):
        provider.set_model_settings(reasoning_effort=config.reasoning_effort)
    metadata = _provider_metadata(provider)
    if metadata.get("model") != config.model:
        provider.close()
        raise ValueError(
            f"provider model drift: {metadata.get('model')} != {config.model}"
        )

    projection_cache: dict[tuple[str, str], Mapping[str, object]] = {}
    produced = 0
    skipped = 0
    statuses: Counter[str] = Counter()
    try:
        for item in planned:
            observation_id = str(item["observation_id"])
            if observation_id in completed:
                skipped += 1
                continue
            fingerprint = str(item["context_fingerprint"])
            treatment = str(item["treatment"])
            context = context_by_fingerprint[fingerprint]
            key = (fingerprint, treatment)
            if key not in projection_cache:
                projection_cache[key] = rq2_treatment_projection(
                    context, treatment=treatment
                )
            projection = projection_cache[key]
            observation_context = {
                **context,
                "context_treatment_sha256": projection["context_treatment_sha256"],
            }
            row = _one_observation(
                provider,
                context=observation_context,
                projected=projection["planning_context"],
                treatment=treatment,
                repeat=int(item["round"]),
                config=config,
                worker=str(item["worker"]),
                metadata=metadata,
            )
            row.update(
                observation_id=observation_id,
                sequence_id=item["sequence_id"],
                sequence_rotation=item["sequence_rotation"],
                sequence_position=item["sequence_position"],
                round=item["round"],
            )
            produced += 1
            statuses[str(row["schema_status"])] += 1
            if on_observation is not None:
                on_observation(row)
    finally:
        provider.close()
    return {
        "schema_version": "ecos.rq2_order_balanced_worker.v1",
        "worker": f"{worker_index}/{workers}",
        "planned": len(planned),
        "produced": produced,
        "continued": skipped,
        "schema_status_counts": dict(sorted(statuses.items())),
        "model_metadata": metadata,
        "ecc_executions": 0,
    }


def run_same_gate_sham_worker(
    contexts: Sequence[Mapping[str, object]],
    *,
    schedule: Mapping[str, object],
    worker_index: int,
    provider_factory: Callable[[], Any],
    config: AdaptiveConfig,
    completed_observation_ids: set[str] | None = None,
    on_observation: Callable[[Mapping[str, object]], None] | None = None,
) -> dict[str, object]:
    """Run the provider-only Dual-vs-sham paired replication."""
    validate_same_gate_sham_schedule(schedule)
    workers = int(schedule["workers"])
    if worker_index < 0 or worker_index >= workers:
        raise ValueError("worker index is outside the registered worker count")
    completed = completed_observation_ids or set()
    context_by_fingerprint = {
        str(context["context_fingerprint"]): context for context in contexts
    }
    planned = [
        row
        for row in schedule["observations"]
        if int(row["worker_index"]) == worker_index
    ]
    provider = provider_factory()
    provider.select_model(config.model)
    if hasattr(provider, "set_model_settings"):
        provider.set_model_settings(reasoning_effort=config.reasoning_effort)
    metadata = _provider_metadata(provider)
    if metadata.get("model") != config.model:
        provider.close()
        raise ValueError(f"provider model drift: {metadata.get('model')} != {config.model}")
    projection_cache: dict[tuple[str, str], Mapping[str, object]] = {}
    produced = 0
    skipped = 0
    statuses: Counter[str] = Counter()
    try:
        for item in planned:
            observation_id = str(item["observation_id"])
            if observation_id in completed:
                skipped += 1
                continue
            fingerprint = str(item["context_fingerprint"])
            treatment = str(item["treatment"])
            context = context_by_fingerprint[fingerprint]
            key = (fingerprint, treatment)
            if key not in projection_cache:
                projection_cache[key] = rq2_treatment_projection(context, treatment=treatment)
            projection = projection_cache[key]
            row = _one_observation(
                provider,
                context={
                    **context,
                    "context_treatment_sha256": projection["context_treatment_sha256"],
                },
                projected=projection["planning_context"],
                treatment=treatment,
                repeat=int(item["round"]),
                config=config,
                worker=str(item["worker"]),
                metadata=metadata,
            )
            row.update(
                observation_id=observation_id,
                sequence_id=item["sequence_id"],
                sequence_rotation=item["sequence_rotation"],
                sequence_position=item["sequence_position"],
                round=item["round"],
            )
            produced += 1
            statuses[str(row["schema_status"])] += 1
            if on_observation is not None:
                on_observation(row)
    finally:
        provider.close()
    return {
        "schema_version": "ecos.rq2_same_gate_sham_worker.v1",
        "worker": f"{worker_index}/{workers}",
        "planned": len(planned),
        "produced": produced,
        "continued": skipped,
        "schema_status_counts": dict(sorted(statuses.items())),
        "model_metadata": metadata,
        "ecc_executions": 0,
    }
