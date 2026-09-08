---
status: accepted
---

# Use origin/main as the ECC integration baseline

The ECC backend-architecture PR is rebuilt from the latest ECC `origin/main`.
Accepted product decisions may explicitly override main; otherwise main owns
the module structure, compatibility behavior, CLI behavior and bug fixes. The
old refactor history is implementation evidence, not a source tree to merge or
an oracle whose every behavior must be preserved.

In particular, ECC keeps main's existing Workspace recognition and migration
behavior and its current Flow completion semantics. The strict recreation
policy and synthesis LEC `Warning` continuation from the earlier integration
design are not restored. This supersedes ADR 0043's no-migration and mandatory
Workspace recreation decision; it does not create a second Descriptor or give
Studio ownership of Workspace parsing or migration.

Only capabilities required by the ECC CLI, accepted domain contracts or the
current ECOS Studio Runtime Adapter are ported onto main. ECC's obsolete
Runtime/RPC implementation is removed in the same PR because ECOS Studio owns
that process and transport boundary. Other files changed by both histories are
rebuilt on main's current structure rather than accepted wholesale from the old
branch.

The target ECC branch is updated as a sequence of reviewable commits covering
the parameter-filter fix, Workspace/Project contracts, Revision and Snapshot,
headless execution/analysis/Signoff, and final CLI integration plus Runtime/RPC
removal. Tests travel with their behavior. The existing branch receives a local
backup reference, and the remote branch is replaced only after the ECC and
Runtime Adapter acceptance checks pass, using `--force-with-lease`.

The parent ECOS Studio branch is not rewritten as part of this operation. Its
ECC gitlink is updated only after the independent ECC PR is merged and the
referenced ECC commit is published.
