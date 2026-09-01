# ECOS Chip Viewer

These instructions apply to `ecos/chip-viewer/` and supplement the parent
instruction files.

## Architecture

- Geometry format, reading, indexing, display policy, and rendering are separate
  crates so lower layers do not depend on the GUI application.
- The native viewer runs outside Electron and is launched through the desktop
  Chip Viewer service.
- The probe CLI exercises the same format and database layers without starting
  the GUI.

## Development Workflow

- Run `cargo fmt --all` after making Rust changes.
- While iterating, run the affected package or test with
  `cargo test -p <package> [<test-name>]`.
- Before publishing, run:

```bash
cd ecos/chip-viewer
cargo fmt --all -- --check
cargo test --workspace
```

- Build the packaged native viewer after changing startup, rendering, native
  resources, or packaging integration:

```bash
cargo build --release -p chip-viewer-native
```

- Keep the workspace building on Linux, macOS, and Windows unless a change is
  explicitly platform-specific.

## Rust Conventions

- Inline variables in `format!` arguments when possible.
- Collapse nested `if` statements and prefer method references over redundant
  closures.
- Prefer exhaustive `match` statements when the variants are known.
- Avoid boolean or ambiguous `Option` parameters when an enum, named method, or
  newtype makes the call site clearer.
- Keep modules private by default and expose only the crate API required by
  consumers.
- Add documentation to new traits describing their role and implementation
  expectations.

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

## Review Guidelines

- Do not add substantial new behavior to
  `apps/chip-viewer-native/src/app.rs`; add a focused module and move related
  tests and documentation with the implementation.
- Apply the same rule to existing large `lib.rs` and rendering modules: extend
  them only for small changes that belong to their current responsibility.
- Treat geometry schemas, persisted edit records, CLI arguments and output, and
  the Electron launch contract as compatibility surfaces.
- For reader, index, query, or rendering hot paths, review allocations,
  full-dataset copies, and loss of memory-mapped or spatially bounded behavior.
- Prefer assertions on complete values or records instead of checking fields
  individually when practical.

## Dependencies And Generated Files

- Use Cargo and commit the corresponding `Cargo.lock` update.
- Do not hand-edit `target/` or packaged binary outputs.
