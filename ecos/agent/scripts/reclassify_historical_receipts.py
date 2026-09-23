#!/usr/bin/env python3
"""Conservatively reclassify historical v2 parameter receipts without rewriting them."""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path
from typing import Any

_POLICY_VERSION = "historical-v2-conservative-v3-roles.v1"
_RECEIPT_NAME = "parameter_application_receipt.v2.json"

_NATIVE_CANDIDATE_FIELDS = {
    "floorplan.aspect_ratio": "configured_value",
    "floorplan.core_util": "configured_value",
    "place.target_density": "target_density",
    "place.cell_padding_x": "padding_sites",
    "place.target_overflow": "stop_overflow",
    "place.density_weight": "configured_density_weight",
    "place.routability_opt": "configured_routability_opt",
}
_REALIZED_CANDIDATE_FIELDS = {
    "place.target_density": "density_tensor_value",
    "place.target_overflow": "final_overflow",
}


def _receipt_paths(root: Path, group: str) -> list[Path]:
    return sorted(
        root.glob(
            f"{group}/*/workspaces/*/.agent/candidates/*/analysis/{_RECEIPT_NAME}"
        )
    )


def _metadata(path: Path, root: Path) -> tuple[str, str]:
    parts = path.relative_to(root).parts
    if len(parts) < 4 or parts[0] not in {"cells", "shadow-duplicate"}:
        raise ValueError(f"unexpected receipt path: {path}")
    return parts[1], parts[3]


def _relation(knob_id: str, requested: dict[str, Any], written: dict[str, Any], actual: Any) -> str:
    if requested["unit"] != written["unit"]:
        return "converted"
    if requested["value"] != actual:
        return "rederived-or-unknown"
    return "numeric-exact"


def _classify(path: Path, root: Path) -> dict[str, Any]:
    arm, design = _metadata(path, root)
    payload = json.loads(path.read_text(encoding="utf-8"))
    requested = payload.get("requested")
    materialization = payload.get("materialization")
    observation = payload.get("observation")
    context = payload.get("context")
    if not isinstance(requested, dict) or not {
        "knob_id",
        "unit",
        "value",
    } <= requested.keys():
        raise ValueError("missing requested value/unit/knob_id")
    if not isinstance(materialization, dict) or not {
        "written_value",
        "unit",
    } <= materialization.keys():
        raise ValueError("missing materialization written_value/unit")
    if not isinstance(observation, dict) or not observation:
        raise ValueError("missing observation")
    if not isinstance(context, dict) or not context:
        raise ValueError("missing context")

    written = {
        "value": materialization["written_value"],
        "unit": materialization["unit"],
    }
    actual = payload.get("actual_value")
    knob_id = requested["knob_id"]
    candidate_native_field = _NATIVE_CANDIDATE_FIELDS.get(knob_id)
    candidate_realized_field = _REALIZED_CANDIDATE_FIELDS.get(knob_id)
    return {
        "source": str(path.relative_to(root)),
        "receipt_id": payload.get("receipt_id"),
        "arm": arm,
        "design": design,
        "schema_version": payload.get("schema_version"),
        "legacy_status": payload.get("status"),
        "knob_id": knob_id,
        "requested": requested,
        "written": written,
        "consumed": None,
        "realized": None,
        "classification": {
            "requested": "determinable",
            "written": "determinable",
            "consumed": "unknown",
            "realized": "unknown",
            "historical_relation": _relation(knob_id, requested, written, actual),
            "reason": "v2 has no authoritative native-boundary consumed/realized source",
        },
        "legacy_actual_value": actual,
        "observation_candidate_fields": {
            "native": candidate_native_field if candidate_native_field in observation else None,
            "realized": candidate_realized_field
            if candidate_realized_field in observation
            else None,
        },
    }


def build_report(root: Path, expected_scope_count: int | None = None) -> dict[str, Any]:
    root = root.resolve()
    scope_paths = _receipt_paths(root, "cells")
    excluded_paths = _receipt_paths(root, "shadow-duplicate")
    errors: list[dict[str, str]] = []
    records: list[dict[str, Any]] = []
    for path in scope_paths:
        try:
            records.append(_classify(path, root))
        except (OSError, ValueError, json.JSONDecodeError) as exc:
            errors.append({"source": str(path.relative_to(root)), "error": str(exc)})

    if expected_scope_count is not None and len(scope_paths) != expected_scope_count:
        errors.append(
            {
                "source": ".",
                "error": f"expected {expected_scope_count} scope records, found {len(scope_paths)}",
            }
        )

    by_knob = Counter(record["knob_id"] for record in records)
    by_design = Counter(record["design"] for record in records)
    by_arm = Counter(
        "lat-ra"
        if "-lat-ra-" in record["arm"]
        else "lat-ro"
        if "-lat-ro-" in record["arm"]
        else "main"
        if "-main-" in record["arm"]
        else "other"
        for record in records
    )
    by_relation = Counter(
        record["classification"]["historical_relation"] for record in records
    )
    by_unit = Counter(
        (
            record["knob_id"],
            record["requested"]["unit"],
            record["written"]["unit"],
        )
        for record in records
    )
    by_status = Counter(record["legacy_status"] for record in records)
    by_schema = Counter(record["schema_version"] for record in records)
    return {
        "schema_version": "ecos.historical_receipt_reclassification.v1",
        "policy_version": _POLICY_VERSION,
        "input_root": str(root),
        "scope": {
            "included_prefix": "cells",
            "included_records": len(scope_paths),
            "excluded_shadow_duplicates": len(excluded_paths),
            "all_v2_files": len(scope_paths) + len(excluded_paths),
        },
        "counts": {
            "records_emitted": len(records),
            "required_shape_errors": len(errors),
            "requested_determinable": len(records),
            "written_determinable": len(records),
            "authoritative_consumed": 0,
            "consumed_unknown": len(records),
            "authoritative_realized": 0,
            "realized_unknown": len(records),
            "consumed_realized_unseparable": len(records),
        },
        "distributions": {
            "schema": dict(sorted(by_schema.items())),
            "legacy_status": dict(sorted(by_status.items())),
            "knob": dict(sorted(by_knob.items())),
            "design": dict(sorted(by_design.items())),
            "arm_family": dict(sorted(by_arm.items())),
            "historical_relation": dict(sorted(by_relation.items())),
            "unit": {
                f"{knob}:{requested}->{written}": count
                for (knob, requested, written), count in sorted(by_unit.items())
            },
        },
        "errors": errors,
        "records": records,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input_root", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--expected-scope-count", type=int, default=None)
    args = parser.parse_args()

    report = build_report(args.input_root, args.expected_scope_count)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(report["counts"], sort_keys=True))
    return 1 if report["errors"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
