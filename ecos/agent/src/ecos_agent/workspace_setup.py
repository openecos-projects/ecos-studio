"""Typed values and deterministic helpers for the GUI workspace wizard."""

import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

from ecos_agent.contracts import (
    GUI_WORKSPACE_FLOW_STEPS,
    GuiWorkspaceSetupProposal,
    recommended_gui_workspace_setup,
    resolve_gui_workspace_setup,
)
_IDENTIFIER = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
_MODULE = re.compile(r"^\s*module\s+([A-Za-z_][A-Za-z0-9_$]*)\b", re.MULTILINE)
_CLOCK = re.compile(r"\b(?:input|inout)\b[^;]*?\b([A-Za-z_][A-Za-z0-9_$]*(?:clk|clock)[A-Za-z0-9_$]*)\b", re.IGNORECASE)
_SDC_PERIOD = re.compile(r"\bcreate_clock\b[^\n]*?\s-period\s+([0-9]+(?:\.[0-9]+)?)")
_BLOCK_COMMENT = re.compile(r"/\*.*?\*/", re.DOTALL)
_LINE_COMMENT = re.compile(r"//[^\n]*")
_DISCOVERY_FIELDS = {".v": "rtl", ".sv": "rtl", ".f": "filelist", ".sdc": "sdc"}
_DISCOVERY_SKIPPED_DIRECTORIES = {".cache", ".git", ".venv", "__pycache__", "node_modules"}
_MAX_DISCOVERY_DIRECTORIES = 4_000
_MAX_DISCOVERY_CANDIDATES = 8
_ECOS_PDK_PARTS = ("ecos-studio", "pdk", "icsprout55-pdk")


@dataclass
class WorkspaceInputs:
    project_root: str = ""
    project_name: str = ""
    rtl_path: str = ""
    filelist_path: str = ""
    sdc_path: str = ""
    pdk_root: str = ""


def recommended_workspace_setup(_design_id: str | None = None) -> GuiWorkspaceSetupProposal:
    return recommended_gui_workspace_setup()


def merge_workspace_setup(
    current: GuiWorkspaceSetupProposal, proposal: GuiWorkspaceSetupProposal, stage: str
) -> GuiWorkspaceSetupProposal:
    if stage != "spec":
        raise ValueError("workspace setup stage is invalid")
    fields = {
        "workspace_name",
        "design_name",
        "top_module",
        "clock_name",
        "frequency_mhz",
        "max_fanout",
        "flow_end",
        "die_area_mode",
        "utilitization",
        "margin",
        "die_width",
        "die_height",
        "target_density",
        "target_overflow",
    }
    payload = current.model_dump(mode="json")
    suggested = proposal.model_dump(mode="json")
    for field in fields:
        if suggested[field] is not None:
            payload[field] = suggested[field]
    payload["summary"] = proposal.summary
    return resolve_gui_workspace_setup(GuiWorkspaceSetupProposal.model_validate(payload))


def normalize_path(
    value: str,
    *,
    label: str,
    suffixes: tuple[str, ...] = (),
    require_file: bool = False,
    require_directory: bool = False,
) -> str:
    path = value.strip()
    if not path or "\x00" in path or len(path) > 4096:
        raise ValueError(f"{label} must be a non-empty path")
    if require_file and require_directory:
        raise ValueError(f"{label} cannot require both a file and a directory")
    normalized = Path(path).expanduser().resolve()
    if suffixes and not normalized.name.lower().endswith(suffixes):
        suffix_text = " or ".join(suffixes)
        raise ValueError(f"{label} must end with {suffix_text}")
    if (require_file or require_directory) and not normalized.exists():
        raise ValueError(f"{label} does not exist")
    if require_file and not normalized.is_file():
        raise ValueError(f"{label} must be a file")
    if require_directory and not normalized.is_dir():
        raise ValueError(f"{label} must be a directory")
    return str(normalized)


def optional_path(value: str, *, label: str, suffixes: tuple[str, ...]) -> str:
    return (
        ""
        if not value.strip()
        else normalize_path(value, label=label, suffixes=suffixes, require_file=True)
    )


def merge_workspace_inputs(current: WorkspaceInputs, proposal: GuiWorkspaceSetupProposal) -> WorkspaceInputs:
    project_root = normalize_path(
        proposal.project_root if proposal.project_root is not None else current.project_root,
        label="Project Root",
        require_directory=True,
    )
    return WorkspaceInputs(
        project_root=project_root,
        project_name=derive_project_name(project_root),
        rtl_path=normalize_path(
            proposal.rtl_path if proposal.rtl_path is not None else current.rtl_path,
            label="RTL path",
            suffixes=(".v", ".sv"),
            require_file=True,
        ),
        filelist_path=optional_path(
            proposal.filelist_path if proposal.filelist_path is not None else current.filelist_path,
            label="Filelist path",
            suffixes=(".f",),
        ),
        sdc_path=optional_path(
            proposal.sdc_path if proposal.sdc_path is not None else current.sdc_path,
            label="SDC path",
            suffixes=(".sdc",),
        ),
        pdk_root=normalize_path(
            proposal.pdk_root if proposal.pdk_root is not None else current.pdk_root,
            label="PDK path",
            require_directory=True,
        ),
    )


def derive_project_name(project_root: str) -> str:
    name = Path(project_root).name
    if not _IDENTIFIER.fullmatch(name):
        raise ValueError("Project Root must end with a valid project name")
    return name


def normalize_identifier(value: str, *, label: str) -> str:
    candidate = value.strip()
    if not _IDENTIFIER.fullmatch(candidate):
        raise ValueError(f"{label} must be an identifier")
    return candidate


def parse_number(value: str, *, label: str, lower: float, upper: float, default: float) -> float:
    if not value.strip():
        return default
    try:
        number = float(value)
    except ValueError as exc:
        raise ValueError(f"{label} must be a number") from exc
    if not lower <= number <= upper:
        raise ValueError(f"{label} must be between {lower:g} and {upper:g}")
    return number


def workspace_search_roots(project_root: str) -> tuple[str, ...]:
    root = Path(normalize_path(project_root, label="Project Root", require_directory=True))
    return (str(root),)


def discover_design_file_candidates(design_name: str, roots: Iterable[str | Path]) -> dict[str, list[str]]:
    matches = {field: [] for field in set(_DISCOVERY_FIELDS.values())}
    if not _IDENTIFIER.fullmatch(design_name):
        return _rank_discovered_paths(matches)
    remaining = _MAX_DISCOVERY_DIRECTORIES
    for root in _discovery_roots(roots):
        for directory, directories, filenames in os.walk(root, topdown=True, followlinks=False):
            remaining -= 1
            if remaining < 0:
                return _rank_discovered_paths(matches)
            directories[:] = sorted(name for name in directories if name not in _DISCOVERY_SKIPPED_DIRECTORIES)
            for filename in sorted(filenames):
                field = _DISCOVERY_FIELDS.get(Path(filename).suffix.lower())
                if field is None:
                    continue
                candidate = (Path(directory) / filename).resolve()
                if _is_discovery_candidate(candidate, root, design_name):
                    matches[field].append(candidate)
    return _rank_discovered_paths(matches)


def discover_ecos_pdk_paths(project_root: str | Path) -> list[str]:
    root = Path(project_root).expanduser().resolve()
    candidates = {
        candidate.resolve()
        for ancestor in (root, *root.parents)
        if (candidate := ancestor.joinpath(*_ECOS_PDK_PARTS)).is_dir()
    }
    return [str(path) for path in sorted(candidates)]


def _discovery_roots(roots: Iterable[str | Path]) -> tuple[Path, ...]:
    candidates = {Path(root).expanduser().resolve() for root in roots}
    return tuple(sorted((root for root in candidates if root.is_dir()), key=str))


def _is_discovery_candidate(path: Path, root: Path, design_name: str) -> bool:
    try:
        relative = path.relative_to(root)
    except ValueError:
        return False
    parts = [part.casefold() for part in relative.parts]
    return path.is_file() and (path.stem.casefold() == design_name.casefold() or design_name.casefold() in parts)


def _rank_discovered_paths(matches: dict[str, list[Path]]) -> dict[str, list[str]]:
    return {
        field: [str(path) for path in sorted(set(paths), key=lambda path: (len(path.parts), str(path)))[:_MAX_DISCOVERY_CANDIDATES]]
        for field, paths in matches.items()
    }


def display_path(path: str) -> str:
    candidate = Path(path)
    try:
        return "~/" + candidate.resolve().relative_to(Path.home().resolve()).as_posix()
    except ValueError:
        return str(candidate)


def infer_design_defaults(rtl_path: str, sdc_path: str, design_name: str = "") -> dict[str, Any]:
    source = _without_verilog_comments(_read_text(rtl_path))
    modules = _MODULE.findall(source)
    top_module = design_name if design_name in modules else (modules[0] if modules else Path(rtl_path).stem)
    clock = _CLOCK.search(source)
    frequency_mhz = _frequency_from_sdc(sdc_path)
    return {
        "top_module": top_module,
        "clock_name": clock.group(1) if clock else "clk",
        "frequency_mhz": frequency_mhz if frequency_mhz is not None else 50,
    }


def workspace_setup_contract(
    proposal: GuiWorkspaceSetupProposal,
    inputs: WorkspaceInputs,
    language: str,
    setup_id: str,
) -> dict[str, Any]:
    proposal = resolve_gui_workspace_setup(proposal)
    inputs = _validated_workspace_inputs(inputs)
    _validate_workspace_proposal(proposal, inputs)
    start_index = GUI_WORKSPACE_FLOW_STEPS.index(proposal.flow_start or "Synthesis")
    end_index = GUI_WORKSPACE_FLOW_STEPS.index(proposal.flow_end or "Harden")
    if start_index > end_index:
        raise ValueError("workspace flow start must not follow its end")
    workspace_directory = _workspace_directory(inputs, proposal)
    return {
        "schema_version": "flow-agent.workspace_setup_contract.v2",
        "title": "冻结的 Workspace 执行合同" if language == "zh" else "Frozen workspace execution contract",
        "setup_id": setup_id,
        "requires_gui_review": True,
        "directory": workspace_directory,
        "pdk": "ics55",
        "pdk_root": inputs.pdk_root,
        "rtl_list": [inputs.rtl_path],
        "filelist": inputs.filelist_path or None,
        "sdc": inputs.sdc_path or None,
        "origin_def": "",
        "origin_verilog": "",
        "design_input_mode": "rtl",
        "pdk_config": {"mode": "default", "tech_lef": [], "cell_lef": [], "liberty": []},
        "pdk_config_mode": "default",
        "project_context": {
            "mode": "create",
            "project_name": inputs.project_name,
            "project_root": inputs.project_root,
            "project_json_path": str(Path(inputs.project_root) / "project.json"),
        },
        "parameters": {
            "clock": proposal.clock_name or "",
            "design": proposal.design_name or "",
            "description": proposal.description or "",
            "die_area_mode": proposal.die_area_mode,
            "frequency_max": proposal.frequency_mhz,
            "margin": proposal.margin,
            "max_fanout": proposal.max_fanout,
            "target_density": proposal.target_density,
            "target_overflow": proposal.target_overflow,
            "top_module": proposal.top_module or "",
            "utilitization": proposal.utilitization,
        },
        "flow_config": {
            "start_step": proposal.flow_start,
            "end_step": proposal.flow_end,
            "steps": list(GUI_WORKSPACE_FLOW_STEPS[start_index : end_index + 1]),
        },
    }


def _validated_workspace_inputs(inputs: WorkspaceInputs) -> WorkspaceInputs:
    project_root = normalize_path(
        inputs.project_root, label="Project Root", require_directory=True
    )
    return WorkspaceInputs(
        project_root=project_root,
        project_name=derive_project_name(project_root),
        rtl_path=normalize_path(inputs.rtl_path, label="RTL path", suffixes=(".v", ".sv"), require_file=True),
        filelist_path=optional_path(inputs.filelist_path, label="Filelist path", suffixes=(".f",)),
        sdc_path=optional_path(inputs.sdc_path, label="SDC path", suffixes=(".sdc",)),
        pdk_root=normalize_path(inputs.pdk_root, label="PDK path", require_directory=True),
    )


def _validate_workspace_proposal(
    proposal: GuiWorkspaceSetupProposal, inputs: WorkspaceInputs
) -> None:
    if not proposal.workspace_name:
        raise ValueError("Workspace Name must be provided")
    if not proposal.design_name:
        raise ValueError("Design Name must be provided")
    if not proposal.top_module:
        raise ValueError("Top Module Name must be provided")
    modules = _MODULE.findall(_without_verilog_comments(_read_text(inputs.rtl_path)))
    if proposal.top_module not in modules:
        raise ValueError("Top Module Name must be declared by the RTL path")


def _workspace_directory(inputs: WorkspaceInputs, proposal: GuiWorkspaceSetupProposal) -> str:
    workspace_name = proposal.workspace_name
    if not workspace_name:
        raise ValueError("Workspace Name must be provided")
    directory = Path(inputs.project_root) / workspace_name
    if directory.exists():
        raise ValueError("Workspace directory already exists; choose a different Workspace Name")
    return str(directory)


def _without_verilog_comments(source: str) -> str:
    return _LINE_COMMENT.sub("", _BLOCK_COMMENT.sub("", source))


def _read_text(path: str) -> str:
    try:
        return Path(path).read_text(encoding="utf-8", errors="ignore")[:1_000_000]
    except OSError:
        return ""


def _frequency_from_sdc(path: str) -> float | None:
    match = _SDC_PERIOD.search(_read_text(path))
    if match is None:
        return None
    period_ns = float(match.group(1))
    return round(1000 / period_ns, 6) if period_ns > 0 else None
