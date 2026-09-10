"""Read-only entry points for the two-design knowledge pilot."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from ecos_agent.optimization.experiments.knowledge_metrics import action_divergence, build_feedback_ledger, summarize_mediation
from ecos_agent.optimization.experiments.knowledge_mediation import read_jsonl, summarize_planning_audit
from ecos_agent.optimization.experiments.frozen_contexts import validate_context_bank
from ecos_agent.optimization.experiments.knowledge_protocol import validate_design_ids


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    for command in ("preflight", "audit", "offline"):
        item = sub.add_parser(command)
        item.add_argument("--design", nargs="+", required=True)
        item.add_argument("--mediation", type=Path)
        item.add_argument("--output", type=Path)
        item.add_argument("--contexts", type=Path)
    args = parser.parse_args(argv)
    designs = validate_design_ids(args.design)
    if args.command == "preflight":
        payload = {"schema_version": "ecos.knowledge_pilot_preflight.v1", "design_ids": list(designs)}
    elif args.command == "offline":
        if args.contexts is None or args.mediation is None:
            parser.error("offline requires --contexts JSON and --mediation JSONL")
        contexts = json.loads(args.contexts.read_text(encoding="utf-8"))
        if not isinstance(contexts, list):
            parser.error("contexts must be a JSON array")
        validate_context_bank(contexts, design_id=designs[0])
        rows = read_jsonl(args.mediation)
        selected = [row for row in rows if row.get("design_id") in designs]
        payload = {"schema_version": "ecos.knowledge_offline_pilot.v1", "design_ids": list(designs),
                   "contexts": len(contexts), "mediation": summarize_mediation(selected),
                   "action_divergence": action_divergence(selected),
                   "offline_gate": bool(selected) and action_divergence(selected)["divergent"]}
    else:
        if args.mediation is None:
            parser.error("audit requires --mediation JSONL")
        rows = read_jsonl(args.mediation)
        if "planning-provider-audit" in args.mediation.name:
            payload = summarize_planning_audit(rows)
        else:
            selected = [row for row in rows if row.get("design_id") in designs]
            payload = {**summarize_mediation(selected), "feedback_ledger": build_feedback_ledger(selected)}
    rendered = json.dumps(payload, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.write_text(rendered, encoding="utf-8")
    else:
        print(rendered, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
