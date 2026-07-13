# ECC Geometry Snapshot Flow Design

## Goal

Every successful physical RTL-to-GDS step must write a geometry snapshot for
the GUI at `<step>/output/geometry/geometry.manifest`. A failure to create the
snapshot makes the step unsuccessful.

The physical steps are floorplan, netlist optimization, placement,
legalization, CTS, routing, DRC, and filler. Synthesis is excluded because it
does not produce a physical iDB design or a DEF suitable for geometry
rendering.

## Architecture

Geometry snapshot creation will use the in-memory iDB held by
`idm::DataManager`. This avoids re-reading the step DEF and all LEF files after
each flow step.

1. Add a reusable C++ geometry snapshot exporter in `geometry_builder`. It
   accepts `idb::IdbDesign`, `idb::IdbLayout`, and an output directory; rebuilds
   a `GeometryStore`; adds layer and design metadata; and writes the snapshot.
2. Expose the exporter through the existing `py_idb` module as
   `geometry_snapshot_save(output_dir)`, returning `False` for unavailable iDB
   data or write failures.
3. Add the matching `ECCToolsModule.geometry_snapshot_save()` Python wrapper.
4. Extend the common `ecc_runner.save_data()` path to call the wrapper after
   the step DEF has been saved. Both the ECC runner and the DreamPlace runner
   already use this function, so one integration covers all physical steps.

The standalone `ecc-geometry-snapshot` executable remains available for the
Chip Viewer recovery and edit workflow. It is not used by the normal ECC flow.

## Workspace Contract

`tools/ecc/builder.py` will declare these output entries for ECC-like steps:

- `geometry`: `<step>/output/geometry`
- `geometry_manifest`: `<step>/output/geometry/geometry.manifest`

The Electron workspace resource service will expose the manifest in the layout
resource response. Chip Viewer continues using the same on-disk path; when the
flow has already produced a current manifest, it opens it without rebuilding.

## Failure Semantics

`save_data()` returns `False` when the geometry export returns `False`. The
subflow save-data state must record failure in that case.

Engine flow completion must require both a successful tool return value and
the expected files. Physical steps additionally require the geometry manifest.
This prevents a valid DEF/GDS from masking a failed geometry export.

## Packaged Runtime

The AppImage already contains `ecc-geometry-snapshot` and the ECC shared
libraries in `resources/binaries/_internal/ecc_tools_bin/lib`. The standalone
binary currently has a development-machine RUNPATH. For packaged Linux runs,
the ECC runtime environment will prepend that library directory to
`LD_LIBRARY_PATH` when it exists. This makes Chip Viewer recovery and edit
commands independent of the build-tree path.

## Tests

- C++ coverage for the reusable exporter using a minimal iDB design and layout.
- Python unit coverage that verifies the new wrapper calls `ecc_py` with the
  geometry directory.
- ECC runner coverage that checks geometry export is requested and a failure
  causes `save_data()` to fail.
- Engine-flow coverage that a failed runner result or a missing geometry
  manifest cannot produce a successful physical step.
- Electron resource-service coverage for the geometry manifest and packaged
  runtime-environment coverage for the library path.
- Existing geometry C++ tests, focused Python tests, focused Electron tests,
  and an AppImage-level binary inspection/run check.

## Non-Goals

- Geometry snapshot creation for synthesis-only output.
- Replacing the existing Chip Viewer edit bridge.
- Changing the geometry snapshot file schema or expanding iDB geometry
  coverage beyond the current `GeometryBuilder` implementation.
