<a id="parameter.harden.liberty"></a>
## parameter.harden.liberty

**Meaning:** The Liberty-corner inventory reused by Harden.

**Role:** Harden takes the selected signoff item's Liberty files to derive its timing-model LIB.

**Source evidence:** **ecc.runner**, **ecc.module**, **config.harden**

<a id="parameter.harden.signoff"></a>
## parameter.harden.signoff

**Meaning:** The STA-to-RCX corner matrix reused by Harden.

**Role:** Harden requires the first resolved signoff item to locate the SDC and SPEF inputs for LIB generation.

**Source evidence:** **ecc.runner**, **ecc.module**, **config.harden**
