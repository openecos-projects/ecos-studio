#!/usr/bin/env python

"""Standalone JSON CLI used by the ECOS Studio desktop runtime."""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections.abc import Callable, Sequence
from importlib.metadata import PackageNotFoundError, version


if hasattr(sys, "_MEIPASS"):
    os.chdir(sys._MEIPASS)


def _default_service_factory():
    from ecos_server.ecc.services import ecc_service

    return ecc_service()


def _default_version_provider() -> str:
    try:
        return version("ecc")
    except PackageNotFoundError:
        return "unknown"


def _response_to_record(response) -> dict:
    if hasattr(response, "model_dump"):
        payload = response.model_dump()
    else:
        payload = response.dict()
    return {
        "type": "result",
        "cmd": payload.get("cmd", ""),
        "response": payload.get("response", "error"),
        "data": payload.get("data", {}),
        "message": payload.get("message", []),
    }


def _print_record(response) -> None:
    print(json.dumps(_response_to_record(response), separators=(",", ":")), flush=True)


def _dispatch(service, cmd: str, data: dict):
    from ecos_server.ecc.schemas import ECCRequest

    return service.dispatch(ECCRequest(cmd=cmd, data=data))


def _wrap_load_failure(response, cmd: str):
    from ecos_server.ecc.schemas import ECCResponse

    payload = _response_to_record(response)
    return ECCResponse(
        cmd=cmd,
        response=payload["response"],
        data=payload["data"],
        message=payload["message"],
    )


def _load_workspace(service, directory: str):
    return _dispatch(service, "load_workspace", {"directory": directory})


def _is_ok(response) -> bool:
    return getattr(response, "response", "") in {"success", "warning"}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="ecc")
    parser.add_argument("--version", action="store_true", help="Print ECC runtime version")
    subparsers = parser.add_subparsers(dest="command")

    workspace = subparsers.add_parser("workspace", help="Workspace commands")
    workspace_subparsers = workspace.add_subparsers(dest="workspace_command")

    create = workspace_subparsers.add_parser("create")
    create.add_argument("--input-json", required=True)
    create.add_argument("--json", action="store_true")

    load = workspace_subparsers.add_parser("load")
    load.add_argument("--directory", required=True)
    load.add_argument("--json", action="store_true")

    run_flow = workspace_subparsers.add_parser("run-flow")
    run_flow.add_argument("--directory", required=True)
    run_flow.add_argument("--json", action="store_true")
    run_flow.add_argument("--rerun", action="store_true")

    run_step = workspace_subparsers.add_parser("run-step")
    run_step.add_argument("--directory", required=True)
    run_step.add_argument("--step", required=True)
    run_step.add_argument("--json", action="store_true")
    run_step.add_argument("--rerun", action="store_true")

    get_info = workspace_subparsers.add_parser("get-info")
    get_info.add_argument("--directory", required=True)
    get_info.add_argument("--step", required=True)
    get_info.add_argument("--id", required=True)
    get_info.add_argument("--json", action="store_true")

    get_home = workspace_subparsers.add_parser("get-home")
    get_home.add_argument("--directory", required=True)
    get_home.add_argument("--json", action="store_true")

    return parser


def run(
    argv: Sequence[str] | None = None,
    *,
    service_factory: Callable[[], object] = _default_service_factory,
    version_provider: Callable[[], str] = _default_version_provider,
) -> int:
    parser = build_parser()
    args = parser.parse_args(list(argv) if argv is not None else None)

    if args.version:
        print(f"ecc {version_provider()}")
        return 0

    if args.command != "workspace" or args.workspace_command is None:
        parser.print_help(sys.stderr)
        return 2

    service = service_factory()
    workspace_command = args.workspace_command

    if workspace_command == "create":
        with open(args.input_json, encoding="utf-8") as input_file:
            data = json.load(input_file)
        response = _dispatch(service, "create_workspace", data)
    elif workspace_command == "load":
        response = _load_workspace(service, args.directory)
    elif workspace_command == "run-flow":
        load_response = _load_workspace(service, args.directory)
        response = (
            _dispatch(service, "rtl2gds", {"rerun": args.rerun})
            if _is_ok(load_response)
            else _wrap_load_failure(load_response, "rtl2gds")
        )
    elif workspace_command == "run-step":
        load_response = _load_workspace(service, args.directory)
        response = (
            _dispatch(service, "run_step", {"step": args.step, "rerun": args.rerun})
            if _is_ok(load_response)
            else _wrap_load_failure(load_response, "run_step")
        )
    elif workspace_command == "get-info":
        load_response = _load_workspace(service, args.directory)
        response = (
            _dispatch(service, "get_info", {"step": args.step, "id": args.id})
            if _is_ok(load_response)
            else _wrap_load_failure(load_response, "get_info")
        )
    elif workspace_command == "get-home":
        load_response = _load_workspace(service, args.directory)
        response = (
            _dispatch(service, "home_page", {})
            if _is_ok(load_response)
            else _wrap_load_failure(load_response, "home_page")
        )
    else:
        parser.error(f"unknown workspace command: {workspace_command}")

    _print_record(response)
    return 0 if _is_ok(response) else 1


def main() -> None:
    sys.exit(run())


if __name__ == "__main__":
    main()
