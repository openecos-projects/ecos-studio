# Read visible Workspace Flow status from the Workspace

Project Management uses `project.json` to organize Projects and Workspaces, and reads `home/flow.json` for the execution status of rendered Workspace rows. It reads and watches only rows exposed by expansion, preview limits, and search; it reuses bounded reads, caching, and filesystem notifications, and checks process liveness only for registered executions. This preserves the Project index without requiring CLI mutations to maintain a second copy of execution status; full doctor scans remain an explicit Project action, and unavailable or interrupted state is shown explicitly.

Keep individual Flow step names and states when reading list status: multiple actual steps may share one Project Management phase. Running rows show the actual ongoing step from the Flow, including when an older operation projection is still present.

Browsing an existing Project index is read-only and does not invoke `project reconcile`, which scans and can repair every Workspace. Recovery remains in explicit Workspace lifecycle operations; projects without an index retain the existing migration path.
