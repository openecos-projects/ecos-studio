# Parameter Acceptance 2026-08-27

The generated JSON manifest records native receipts, terminal observations,
materialization snapshots, and independent replay hashes without copying the
ignored flow outputs into Git.

Historical generated classification: **Engineering Complete** for all eight
target knobs in the 2026-08-27 artifact revision. This directory is retained
as historical acceptance evidence and must not be cited as current
final-revision Engineering Complete without regenerating the report with the
current validator and current candidate artifacts.
`place.routability_opt=false` is recorded as an effective negative arm when its
native receipt is `applied/not_activated`; this preserves the branch diagnostic
without rejecting the candidate. No QoR or research claim is made from this
artifact.

The current validator has no built-in candidate set. Regeneration requires an
explicit candidate for every knob, at least one verified episode root, and the
expected revisions. For example:

```bash
PYTHONPATH=src uv run python scripts/build_parameter_acceptance.py \
  --workspace "$WORKSPACE" \
  --output "$OUTPUT" \
  --candidate floorplan.core_util=candidate-fb53a8688a8318c2-candidate-accept-core-util-v3-20260827 \
  --candidate floorplan.aspect_ratio=candidate-91962560dc60ce20-candidate-accept-aspect-ratio-v3b-20260827 \
  --candidate synth.max_fanout=candidate-native-max-fanout-v9-20260827 \
  --candidate place.target_density=candidate-accept-rerun-smoke2-20260827 \
  --candidate place.target_overflow=candidate-accept-target-overflow-v3-20260827 \
  --candidate place.cell_padding_x=candidate-accept-cell-padding-v3-20260827 \
  --candidate place.routability_opt=candidate-routability-false-parent-v3b-20260827 \
  --candidate place.density_weight=candidate-accept-density-weight-v3-20260827 \
  --episode-root "$EPISODE_ROOT" \
  --expected-ecos-revision "$(git rev-parse HEAD)" \
  --expected-ecc-revision "$ECC_REVISION"
```

`WORKSPACE` must name the retained ECC workspace, `OUTPUT` must name a new
acceptance output directory, and `EPISODE_ROOT` must name a retained directory under the workspace's
`.agent/optimization`; `ECC_REVISION` must equal the revision returned by the
ECC handshake and embedded in every candidate receipt.
