---
status: accepted
---

# Top Module is confirmed at Workspace create and then read-only

Studio does not let the user edit Top Module after Workspace create while the design inputs stay the same. The New Workspace wizard lists every Discovered Module Candidate from the HDL that this wizard will hand to ECC, preselects the heuristic default, and requires the user to confirm a candidate before create proceeds. The confirmed name becomes committed Workspace Identity and is thereafter read-only on that input set.

The discovery set is the HDL that this wizard will hand to ECC. For an RTL-start flow that is either the selected RTL files or the sources expanded from a selected filelist, not both: ECC rejects `rtl` and `filelist` together. Design Files enforces that exclusive choice before the user can leave the step: a filelist clears or disables the RTL list, and an RTL list clears or disables the filelist. When Project Manifest defaults include both, the wizard prefills filelist only. Spec Setting then discovers only the submitted set. For Floorplan-or-later, the set is `origin_verilog`. Filelist expansion matches ECC: direct HDL paths only. Nested `-f` / `-v` / `-y` are not expanded. Gzip-compressed HDL is decompressed before discovery. After comment stripping, discovery matches `module` and `macromodule` declarations, including an optional `(* ... *)` attribute prefix. It does not collect `interface`, `package`, or VHDL `entity`. Duplicate names appear once. `ifdef` / `ifndef` branches are not preprocessed; every declaration in those branches is a candidate. The wizard has no `+define` step. PDK Verilog is not part of the discovery set.

If any selected HDL file is readable, create cannot proceed until at least one candidate exists and the user confirms a name from that list. Free-text names outside the list are rejected. A readable file with no `module` or `macromodule` may be skipped; if every readable file is skipped, that is zero candidates and Spec Setting stays blocked.

Partial read failure fails the whole discovery: if any selected RTL, the filelist itself, or an expanded source cannot be read (including gzip decompress failure), Spec Setting and Agent confirm cannot submit. The user returns to Design Files. Studio does not continue with a partial list.

Total read failure is a free-text exception: every HDL path in the discovery set is unreadable (missing, unreadable, or gzip decompress failure). Spec Setting and Agent confirm then allow a Verilog identifier so create is not deadlocked. This is not an “other…” choice beside a list. Readable text with zero `module` / `macromodule` names still blocks. An empty filelist or empty RTL selection is Design Files not ready, not free-text.

Discovery is bounded (file count, per-file size, and total bytes). Hitting a bound or timeout is incomplete discovery: show that the set is too large or did not finish, and allow a Verilog identifier so create is not deadlocked. Incomplete discovery is not a truncated candidate list. Partial read failure of some files while others remain in bound still fails closed without free-text.

A free-text Top Module must match `[A-Za-z_][A-Za-z0-9_$]*` after trimming. Empty strings, spaces, paths, and dotted names are rejected. The escape hatch lifts “must come from the list”, not “must be a legal identifier”.

Confirmation stays on Spec Setting. The free-text Top Module field becomes a searchable dropdown of every unique candidate. Filtering is in the control; discovery is in Electron. The heuristic default is listed first and marked as suggested. The list is not truncated and does not fall back to free-text because it is long. Discovery runs when entering Spec Setting and when Design Files paths change. The wizard does not add a seventh step.

After the user has seen the dropdown, selection is preserved unless it is no longer valid:

- Input paths change: rediscover. Keep the current selection if it is still in the new list; otherwise apply the new heuristic.
- Only Design Name changes and the candidate list is unchanged: if the current value is still the suggested default (the user has not picked another candidate), recompute the suggestion from the new Design Name and update the selection. If the user already picked another candidate, do not overwrite it.

The heuristic is a suggestion, not an override of a user confirmation.

The preselected value is the heuristic Top Module, not the first name in file order. The first still-present candidate in this order wins:

1. Source Workspace committed Top Module, when this wizard is creating from an existing Workspace step output and that name is still in the new list
2. Project Manifest `top_module`
3. Design Name
4. The unique discovered name that no other discovered module instantiates, after comment stripping (regex only; no Slang or Yosys). `Foo` counts as instantiated only when another discovered module's body contains a Verilog-like instance of that candidate: `Foo inst (` or `Foo #(...) inst (`. Names that are not in the candidate list, `interface` uses, and unit-library cells are ignored.
5. Among uninstantiated names, the closest match to Design Name or source file stem, excluding `*_tb`, `tb_*`, and `*_test`
6. The first remaining uninstantiated name in stable sort order, otherwise the first candidate

A missing or unread source identity is skipped; the rest of the order still runs. This is still a create-time suggestion, not a lock to the source Workspace.

Exact identifier match is case-sensitive, matching Verilog. Rank 5 may use case-insensitive closeness only to order remaining uninstantiated names; the submitted value is always an exact discovered identifier.

Macros, `generate`, bind, and `ifdef` can mis-rank. Heuristics only preselect; they do not hide other candidates and do not submit without confirmation. Instantiation ranking never hides a candidate.

This is not silent auto-fill. Studio does not invent a post-create in-place identity command, does not lift `workspace_structure_change_requires_update`, and does not accept Top Module through `workspace.updateConfiguration`.

If the confirmed Top Module is wrong on the same inputs, the user creates a New Workspace. Replacing design inputs, PDK installation, Flow structure or other bound resources remains a structural Workspace Update and is not a Top Module identity editor.

When Update Workspace changes the selected RTL, filelist, or `origin_verilog` **paths**, Studio rediscovers candidates with the same rules. The previous Top Module stays preselected if it is still in the new list; otherwise the heuristic default is preselected. Submit still requires a name from the new list. Unchanged input paths keep Top Module as read-only text of the committed name in Spec Setting, not a disabled dropdown.

Studio does not watch file contents. Discovery runs when the user selects or changes those paths, not continuously. Opening an existing Backend Workspace, Home, and Step Configuration do not rediscover modules or warn that the committed name is missing from current files. If the same paths later no longer declare the committed Top Module, a later Flow may fail; that is not an identity editor. Update Workspace submit still fails closed when the committed name is absent from rediscovery after input paths change.

Agent create uses the same candidate list and confirmation rule. The Agent chat no longer collects Top Module as free text and does not run a “Top Module Name” prompt. The setup contract stays `flow-agent.workspace_setup_contract.v2`; `top_module` may be empty or a heuristic default from the Electron discovery API. The existing Agent GUI review panel shows the candidate dropdown. Confirm stays disabled until a list item is selected. After confirmation, the create request carries the confirmed name. The Agent cannot submit a name outside the list, cannot confirm on the user's behalf, and cannot create with zero candidates. Review does not open the six-step wizard only to pick Top Module. This iteration does not add a v3 contract.

Discovery and confirmation live in Studio / Electron. An Electron desktop service discovers candidates from the selected paths and returns the list plus the heuristic default. The wizard and Agent GUI review both consume that local API. Renderer does not parse HDL. Agent `infer_design_defaults` is not the product discovery path.

ECC `workspace.create` and structural `workspace.update` keep requiring a nonempty `topModule` and do not gain a “name must appear in submitted HDL” check. This iteration does not add an Adapter discovery protocol. CLI or a direct Adapter caller can still submit a nonempty name that Studio would have rejected.

The Config hub shows committed Top Module as read-only identity. It does not offer Edit Top Module or route that field through Update Workspace. Update Workspace remains the path for replacing inputs, PDK, or Flow; Top Module is reconfirmed there only when those input paths change.

This iteration locks only Top Module on Backend Workspace create, Update Workspace, and Agent GUI review. Clock, Design name, and PDK family stay create-time fields and may still change through structural Update Workspace. Studio does not discover clock ports in this iteration. Frontend Workspace create, `cpu_top_module`, and ecc-fe filelists are unchanged.

The first implementation ships create-time discovery and confirmation only: the New Workspace dropdown, Update Workspace reconfirm when input paths change, the Electron discovery API, and post-create read-only Top Module. Promoting Step Configuration into the Config hub shell is a later iteration. Local implementation spec: [Backend Create-time Top Module Confirmation v1](../specs/backend-create-time-top-module-confirmation-v1.zh-CN.md).

ADR 0045 is superseded.
