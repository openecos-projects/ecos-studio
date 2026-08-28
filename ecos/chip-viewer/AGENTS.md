# ECOS Chip Viewer

These instructions apply to `ecos/chip-viewer/` and supplement the parent
instruction files.

## Workspace Layout

- This is a Rust 2021 Cargo workspace.
- `crates/chipgeom-format/` defines shared geometry records and schema constants.
- `crates/chipgeom-reader/` reads geometry manifests and memory-mapped data.
- `crates/chip-view-db/` owns the queryable layout database and spatial indexes.
- `crates/chip-display/` owns display roles, themes, and presentation metadata.
- `crates/chip-render/` converts database geometry into render data.
- `apps/chipgeom-probe-cli/` provides inspection and benchmark commands.
- `apps/chip-viewer-native/` provides the egui/wgpu native viewer.

## Architecture

- Geometry format, reading, indexing, display policy, and rendering are separate
  crates so lower layers do not depend on the GUI application.
- The native viewer runs outside Electron and is launched through the desktop
  Chip Viewer service.
- The probe CLI exercises the same format and database layers without starting
  the GUI.

## Validation

```bash
cd ecos/chip-viewer
cargo fmt --all -- --check
cargo test --workspace
```

Build the packaged native viewer with:

```bash
cargo build --release -p chip-viewer-native
```

## When Changing Geometry Contracts

- Treat `chipgeom-format` as the source of shared record and schema definitions.
- Check `chipgeom-reader`, `chip-view-db`, the probe CLI, and native viewer
  consumers together.
- Update focused fixtures and compatibility tests with any intentional format
  change.

## When Changing Native Integration

- Check `ecos/gui/apps/desktop-electron/electron/services/chipViewerService.ts`
  and `ecos/scripts/chip-viewer-native-wrapper.sh`.
- Verify both the Rust workspace and the Electron-side launch tests.

## Dependencies And Generated Files

- Use Cargo and commit the corresponding `Cargo.lock` update.
- Do not hand-edit `target/` or packaged binary outputs.
