import ast
import importlib
from importlib.util import resolve_name
from pathlib import Path

import pytest


PACKAGE_ROOT = Path(__file__).parents[1] / "src" / "ecos_agent"
SCRIPT_ROOT = Path(__file__).parents[1] / "scripts"
TARGET_PACKAGES = ("optimization", "knowledge", "workspace", "codex", "gui")
FORBIDDEN_DEPENDENCIES = (
    ("optimization", "codex"),
    ("workspace", "gui"),
)


def _imported_names(node: ast.AST, package: str) -> tuple[str, ...]:
    if isinstance(node, ast.Import):
        return tuple(alias.name for alias in node.names)
    if not isinstance(node, ast.ImportFrom):
        return ()

    module = f"{'.' * node.level}{node.module or ''}"
    base = resolve_name(module, package) if node.level else module
    return (base, *(f"{base}.{alias.name}" for alias in node.names))


def _forbidden_imports(source: str, target: str) -> list[str]:
    violations: list[str] = []
    target_prefix = f"ecos_agent.{target}"
    for path in sorted(PACKAGE_ROOT.rglob("*.py")):
        relative = path.relative_to(PACKAGE_ROOT)
        if relative.parts[0] != source:
            continue
        package = ".".join(("ecos_agent", *relative.parts[:-1]))
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            for imported in _imported_names(node, package):
                if imported == target_prefix or imported.startswith(f"{target_prefix}."):
                    violations.append(f"{relative}:{node.lineno} imports {imported}")
    return violations


@pytest.mark.parametrize("package", TARGET_PACKAGES)
def test_domain_package_is_importable(package: str) -> None:
    importlib.import_module(f"ecos_agent.{package}")


@pytest.mark.parametrize(("source", "target"), FORBIDDEN_DEPENDENCIES)
def test_domain_dependency_direction(source: str, target: str) -> None:
    violations = _forbidden_imports(source, target)
    assert not violations, "Forbidden package dependencies:\n" + "\n".join(violations)


def test_scripts_are_thin_composition_roots() -> None:
    for path in sorted(SCRIPT_ROOT.glob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        definitions = [
            node
            for node in tree.body
            if isinstance(node, (ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef))
        ]
        assert not definitions, f"script contains implementation: {path.name}"


def test_obsolete_script_lanes_are_removed() -> None:
    assert not (SCRIPT_ROOT / "knowledge").exists()
    assert not (SCRIPT_ROOT / "run_equal_budget_harness.py").exists()
    assert not (SCRIPT_ROOT / "finalize_equal_budget_functional_smoke.py").exists()
    assert not (SCRIPT_ROOT / "run_equal_budget_experiment.py").exists()
