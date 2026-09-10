"""Read-only entry points for the two-design knowledge pilot."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from ecos_agent.optimization.experiments.knowledge_metrics import build_feedback_ledger, summarize_mediation
from ecos_agent.optimization.experiments.knowledge_mediation import read_jsonl, summarize_planning_audit
from ecos_agent.optimization.experiments.knowledge_protocol import validate_design_ids


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    for command in ("preflight", "audit"):
        item = sub.add_parser(command)
        item.add_argument("--design", nargs="+", required=True)
        item.add_argument("--mediation", type=Path)
        item.add_argument("--output", type=Path)
    args = parser.parse_args(argv)
    designs = validate_design_ids(args.design)
    if args.command == "preflight":
        payload = {"schema_version": "ecos.knowledge_pilot_preflight.v1", "design_ids": list(designs)}
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
