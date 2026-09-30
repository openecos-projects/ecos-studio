<a id="artifact.place.outputs"></a>
## artifact.place.outputs

**Meaning:** The place artifact set is the collection of source artifacts, structured feature and QoR records, GUI geometry data, and execution logs produced around a DreamPlace placement run. Each file exposes a different view of the same placed design state or of the analysis performed on it.

**Calculation:** The DreamPlace runner updates the ECC database, produces placement-map features, persists the physical outputs and checkpoint, then runs QoR analysis and plotting. The records below identify the actual content and generation chain for every published or reserved place artifact path.

**Source evidence:** **ecc.builder**, **dreamplace.runner**, **ecc.runner**

<a id="artifact.place.output_def"></a>
## artifact.place.output_def

**Meaning:** The placed DEF is the physical-design interchange file exported from the current ECC database. Compared with the floorplan input DEF, its COMPONENTS section contains the standard-cell placement coordinates and row orientation written back by DreamPlace; it also carries the current die, rows, pins, blockages, macros, and net connectivity.

**Calculation:** `NonLinearPlace` applies the optimized movable-cell positions to `macroPlaceDB`, which unscales the coordinates and writes them into ECC. The common place `save_data` path then invokes `def_save` on that updated database.

**Source evidence:** **dreamplace.nonlinear**, **dreamplace.placer**, **dreamplace.runner**, **ecc.runner**, **ecc.module**

<a id="artifact.place.output_verilog"></a>
## artifact.place.output_verilog

**Meaning:** The place Verilog is a gate-level logical-netlist export of the current ECC database: module structure, cell instances, ports, and logical net connectivity. It does not encode physical placement coordinates; those belong to the DEF, GDS, database checkpoint, and geometry snapshot.

**Calculation:** After DreamPlace has updated the in-memory design, `save_data` calls `verilog_save`, which delegates to ECC's netlist exporter and writes the resulting logical connectivity to this path.

**Source evidence:** **dreamplace.runner**, **ecc.runner**, **ecc.module**

<a id="artifact.place.output_gds"></a>
## artifact.place.output_gds

**Meaning:** The place GDS is a binary physical-layout export of the current ECC database. It represents the die-level physical geometry and current placed instance hierarchy, including the standard-cell locations produced by placement, in stream format suitable for physical-layout viewers.

**Calculation:** The placement solution is written into ECC before the common persistence path calls `gds_save`; ECC serializes that current physical database as the GDS file.

**Source evidence:** **dreamplace.nonlinear**, **dreamplace.runner**, **ecc.runner**, **ecc.module**

<a id="artifact.place.output_db"></a>
## artifact.place.output_db

**Meaning:** The place database directory is an ECC checkpoint for subsequent flow stages. Its layout files include metadata, units, die, layers, sites, rows, routing grids, cell masters, via rules, and vias; its design files include metadata, instances, IO pins, nets, special nets, blockages, regions, slots, groups, and fills.

**Calculation:** The common persistence path calls `save_data` after placement. The next stage can load this directory to reconstruct the same placed ECC database instead of reparsing the source design.

**Source evidence:** **dreamplace.runner**, **ecc.runner**, **ecc.module**

<a id="artifact.place.output_image"></a>
## artifact.place.output_image

**Meaning:** This is the reserved direct PNG path exposed by the step-output schema. The placement visualizations are instead the placement plots generated from the QoR metrics and feature-map data, such as the metric chart and density or congestion heatmaps.

**Calculation:** The builder allocates this path, while `run_analysis` invokes `ECCToolsPlot` to write plot files beside the analysis and feature inputs. The standard place runner has no writer that targets `output.image`, so this reserved path is not emitted as the placement result itself.

**Source evidence:** **ecc.builder**, **ecc.runner**, **ecc.plot**

<a id="artifact.place.output_json"></a>
## artifact.place.output_json

**Meaning:** This is the reserved JSON-export path for a serialized current ECC design. It is distinct from the feature JSON files and from the GUI geometry snapshot; the standard place flow does not publish a design JSON at this path.

**Calculation:** The builder allocates the path and `ECCToolsModule` exposes `json_save`, but the common place persistence path does not call it. It also intentionally skips view-JSON serialization because the GUI reads the geometry snapshot.

**Source evidence:** **ecc.builder**, **ecc.runner**, **ecc.module**

<a id="artifact.place.geometry"></a>
## artifact.place.geometry

**Meaning:** The geometry directory is the GUI-rendering snapshot of the placed ECC database. `geometry.manifest` identifies the active epoch and the side files holding shape records, owners, packed geometry payload, names, shape-ID mapping, view tiles, layer, site, master, via, grid, connectivity, net, bus, and group metadata.

**Calculation:** After saving the placed database, the common persistence path calls `geometry_snapshot_save` for the place step and requires `geometry.manifest` to exist. The snapshot writer emits epoch-local side files and publishes the manifest that references them.

**Source evidence:** **ecc.builder**, **ecc.runner**, **ecc.module**, **ecc.geometry**

<a id="artifact.place.view_json"></a>
## artifact.place.view_json

**Meaning:** This is the reserved directory for a view-JSON package, whose API would write a manifest and layout package files for the current ECC design. The standard place flow uses the geometry snapshot instead, so it does not emit this package.

**Calculation:** The builder allocates the directory and `ECCToolsModule.view_json_save` can create the package, but `save_data` explicitly skips view-JSON serialization and directs the GUI to the geometry snapshot.

**Source evidence:** **ecc.builder**, **ecc.runner**, **ecc.module**

<a id="artifact.place.feature_db"></a>
## artifact.place.feature_db

**Meaning:** This JSON is the source-derived summary of the placed ECC database. Its top-level content includes `Design Information`, `Design Layout`, `Design Statis`, `Instances`, `Macros Statis`, `Macros`, `Nets`, `Layers`, and `Pins`, which describe the design state from which placement metrics and plots are interpreted.

**Calculation:** The common persistence path calls `feature_sammry`, which invokes ECC's feature-summary builder to extract those categories from the current database and serialize them to JSON.

**Source evidence:** **dreamplace.runner**, **ecc.runner**, **ecc.module**, **ecc.feature_summary**

<a id="artifact.place.feature_step"></a>
## artifact.place.feature_step

**Meaning:** This reserved file would contain the stage-specific `place` feature summary, including the placement-tool summary produced for a normal ECOS placement step. It is not emitted by the DreamPlace place runner.

**Calculation:** `feature_step` can call ECC's `feature_tool` with `place`, but the DreamPlace runner invokes the common persistence function with `feature_step=False`; the call is skipped and no `place.step.json` is written.

**Source evidence:** **dreamplace.runner**, **ecc.runner**, **ecc.module**, **ecc.feature_manager**, **ecc.feature_summary**

<a id="artifact.place.feature_map"></a>
## artifact.place.feature_map

**Meaning:** This JSON is the placement evaluation-map index. It records the generated density, pin-density, net-density, RUDY, LUT-RUDY, and EGR map resources that the GUI and plotting code use to render placement heatmaps.

**Calculation:** Immediately after DreamPlace returns, the place runner calls `feature_placement_map`. ECC initializes the placement evaluator, builds the union placement-evaluation summary, and serializes the map-resource paths through `feature_pl_eval`.

**Source evidence:** **dreamplace.runner**, **ecc.module**, **ecc.feature_manager**, **ecc.feature_union**, **ecc.feature_parser**

<a id="artifact.place.qor_metrics"></a>
## artifact.place.qor_metrics

**Meaning:** This JSON is the structured per-metric QoR record for the place step. Its top-level `"metrics"` array contains entries with an identifier, display name, value, unit, category, optimization direction, scope, rating, confidence, and source selector; the payload also records its schema, tool, step, design, detail records, source files, and integrity status.

**Calculation:** ECC builds step metrics from the placed feature data, maps recognized values into QoR records, rejects records whose source escapes the current step feature directory, sorts the surviving records, and writes the resulting payload with `save_qor_metrics`.

**Source evidence:** **dreamplace.runner**, **ecc.runner**, **ecc.metrics**

<a id="artifact.place.qor_summary"></a>
## artifact.place.qor_summary

**Meaning:** This JSON is the quality-status summary derived from the place QoR metrics. It contains the analysis and quality status, metric count, per-dimension counts, the top-level `"gates"` array, missing-metric diagnostics, and the name of the backing metrics file.

**Calculation:** ECC rebuilds the QoR metric payload, groups records by category, determines valid or incomplete analysis status from metric availability and source integrity, evaluates the step quality gates, and writes the summary with `save_qor_summary`.

**Source evidence:** **dreamplace.runner**, **ecc.runner**, **ecc.metrics**

<a id="artifact.place.qor_hotspots"></a>
## artifact.place.qor_hotspots

**Meaning:** This JSON is the actionable QoR-hotspot subset for the place step. A hotspot is a recognized congestion symptom, represented with its kind, warning severity, metric ID, display name, value, unit, category, source selector, and description rather than as every bin of a heatmap.

**Calculation:** ECC first builds the QoR metric records, then retains only recognized place congestion metrics such as EGR total or peak overflow and RUDY or LUT-RUDY peak utilization when their numeric value > 0. Each retained record receives the fixed warning severity and its evidence source before `save_qor_hotspots` writes the list.

**Source evidence:** **dreamplace.runner**, **ecc.runner**, **ecc.metrics**

<a id="artifact.place.log"></a>
## artifact.place.log

**Meaning:** The place log is the chronological DreamPlace execution record. It contains root logger messages for parameter setup, placement-database initialization, nonlinear placement progress and final PPA, congestion extraction, warnings, and failures; the default standalone filename is `dreamplace_placement.log` when no step log path is supplied.

**Calculation:** `DreamplaceModule` chooses `step.log.file` when available, otherwise its default filename, opens it in write mode, and temporarily attaches it as a root logger handler around the whole placement run.

**Source evidence:** **dreamplace.module**, **dreamplace.placer**
