<a id="parameter.sizer.script_inputs"></a>
## parameter.sizer.script_inputs

**Meaning:** The generated Sizer environment and command files.

**Role:** The wrapper requires both files before invoking the fixed Sizer command; they materialize workspace paths and tool inputs.

**Source evidence:** **sizer.runner**, **sizer.builder**, **sizer.subflow**, **sizer.metrics**, **dreamplace.runner**, **ecc.runner**

<a id="parameter.sizer.staging_outputs"></a>
## parameter.sizer.staging_outputs

**Meaning:** The Sizer staging DEF and Verilog paths.

**Role:** Both files must exist before the wrapper can pass the result into DreamPlace legalization.

**Source evidence:** **sizer.runner**, **sizer.builder**, **sizer.subflow**, **sizer.metrics**, **dreamplace.runner**, **ecc.runner**
