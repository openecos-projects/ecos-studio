<a id="failure.place.dreamplace_import"></a>
## failure.place.dreamplace_import

`is_eda_exist()` catches a DreamPlace import exception, records `dreamplace: import failed`, and makes the step return `False`. Check the runtime `dreamplace` module and its compiled dependencies.

**Source evidence:** **dreamplace.utility**, **dreamplace.runner**

<a id="failure.place.missing_ecc_module"></a>
## failure.place.missing_ecc_module

The runner invokes DreamPlace only when `get_eda_instance()` returns an ECC module. If it returns no module, placement does not enter the module.

**Source evidence:** **dreamplace.runner**

<a id="failure.place.overflow_or_nonfinite_objective"></a>
## failure.place.overflow_or_nonfinite_objective

When final overflow exceeds `stop_overflow`, or the objective is `Inf` or `NaN`, `NonLinearPlace` skips legalization and detailed placement and returns infinite HPWL.

**Source evidence:** **dreamplace.nonlinear**

<a id="failure.place.infinite_hpwl"></a>
## failure.place.infinite_hpwl

`DreamplaceModule` treats `ppa["hpwl"] == inf` as a failure and returns `False`.

**Source evidence:** **dreamplace.module**

<a id="failure.place.missing_feature_map"></a>
## failure.place.missing_feature_map

The runner requests `feature_placement_map(json_path=step.feature.map)`. When the expected map is missing, it must not claim that QoR metrics were generated.

**Source evidence:** **dreamplace.runner**, **ecc.builder**

<a id="failure.place.missing_external_detailed_placer"></a>
## failure.place.missing_external_detailed_placer

When `detailed_place_engine` is configured but its path does not exist, `PlacementEngine` records only a warning. Detailed placement is disabled in the current default flow.

**Source evidence:** **dreamplace.placer**, **dreamplace.config**

<a id="failure.place.misleading_subflow_success"></a>
## failure.place.misleading_subflow_success

After DreamPlace returns, the runner unconditionally marks the subflow `run-placement` as successful, and `save_data` can later overwrite the result. Subflow success alone is not placement-success evidence; check terminal state, logs, and artifacts.

**Source evidence:** **dreamplace.runner**, **dreamplace.module**
