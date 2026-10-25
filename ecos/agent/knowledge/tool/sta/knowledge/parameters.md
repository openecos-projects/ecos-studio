<a id="parameter.sta.liberty"></a>
## parameter.sta.liberty

**Meaning:** The Liberty-corner inventory.

**Role:** It maps each STA corner name and temperature to the Liberty files used for timing runs.

**Source evidence:** **ecc.runner**, **ecc.module**, **config.sta**

<a id="parameter.sta.max_parallel_corners"></a>
## parameter.sta.max_parallel_corners

**Meaning:** The `max_parallel_corners` configuration field for sta.

**Role:** It is parsed by the underlying stage tool and has effect only when that tool consumes the field.

**Source evidence:** **ecc.runner**, **ecc.module**, **config.sta**

<a id="parameter.sta.signoff"></a>
## parameter.sta.signoff

**Meaning:** The STA-to-RCX corner signoff matrix.

**Role:** It expands each Liberty corner into the RCX corners that must be analyzed.

**Source evidence:** **ecc.runner**, **ecc.module**, **config.sta**
