<a id="parameter.drc.workspace_config"></a>
## parameter.drc.workspace_config

**Meaning:** The DRC workspace-configuration boundary.

**Role:** The runner passes it to `run_drc` together with the step report path after DRC initialization.

**Source evidence:** **ecc.runner**, **ecc.module**

<a id="parameter.drc.report_path"></a>
## parameter.drc.report_path

**Meaning:** The step-specific DRC report destination.

**Role:** It receives the DRC engine report and is separate from the persisted DRC feature JSON.

**Source evidence:** **ecc.runner**, **ecc.module**
