import json

import pytest

from ecos_agent.hashing import file_sha256
from ecos_agent.optimization.pdk_evidence import pdk_fingerprint, site_width_dbu


def resolved_workspace(root, width=400):
    resource = root / 'vendor.lib'
    resource.write_text('library(test) {}')
    (root / 'home').mkdir()
    context = {
        'schema_version': 1,
        'content_digest': 'a' * 64,
        'resource_root': str(root),
        'resources': {'cells': {'path': 'vendor.lib', 'sha256': file_sha256(resource).removeprefix("sha256:")}},
        'site_width_dbu': width,
    }
    (root / 'home/ecc-pdk-context.json').write_text(json.dumps(context))
    return resource


def test_selected_site_comes_from_ecc_context(tmp_path):
    resolved_workspace(tmp_path)
    assert site_width_dbu(tmp_path) == 400


def test_content_drift_is_rejected(tmp_path):
    resource = resolved_workspace(tmp_path)
    assert pdk_fingerprint(tmp_path) == 'sha256:' + 'a' * 64
    resource.write_text('changed timing')
    with pytest.raises(ValueError, match='content differs'):
        pdk_fingerprint(tmp_path)


def test_missing_site_is_rejected(tmp_path):
    resolved_workspace(tmp_path, None)
    with pytest.raises(ValueError, match='site width is unavailable'):
        site_width_dbu(tmp_path)


def test_missing_context_does_not_guess_a_process(tmp_path):
    with pytest.raises(ValueError, match='resolved PDK context is unavailable'):
        site_width_dbu(tmp_path)
