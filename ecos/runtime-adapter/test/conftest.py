import importlib.util
from pathlib import Path

import pytest


def _ecc_test_helpers():
    path = Path(__file__).parents[3] / "ecc" / "test" / "conftest.py"
    spec = importlib.util.spec_from_file_location("ecc_test_helpers", path)
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot load ECC test helpers from {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def minimal_ics55_pdk_factory():
    return _ecc_test_helpers().create_minimal_ics55_pdk
