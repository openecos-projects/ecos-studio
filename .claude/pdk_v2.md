# ICS55 PDK v2 迁移方案与实施记录

本文件记录本机迁移的依据、代码修改、安装和实际验证。分析以文件内容、
Liberty/LEF 和发布 checksum 为准；“flow 完成”与 foundry signoff 分开记录。
后续 ECC 的内置 `ics55` 默认只使用 v2/后续兼容布局，不再自动回退 H7 库。

## 1. 基线、分支与范围

| 仓库 | 分析起点 | 本次处理 |
| --- | --- | --- |
| ECOS Studio (`ecos_studio_2`) | `980f14a9` | 创建 `yell/ics55_v2`，修改 GUI 资源识别、Agent、PDK gitlink |
| 当前 ECC | `ef66a01a66c66bc760d7d8f9802ca44f2bbb20ff` | 从当前 revision 创建 `yell/ics55_v2`，没有切到 main 或其它版本 |
| `ecc-tools` | `73fdc135c3224d73693285f84fa003a1cc33b7cb` | `yell/ics55_v2`，drive/VT family、metal LVS、v2 原生测试与 CI |
| `ecc-dreamplace` | `31c25f8c8926f581fb8a712107fe5751ee701396` | `yell/ics55_v2`，buffer/profile/VT 后缀 |
| Xplace（DreamPlace 子仓库） | `aafcef8cda5d2ba221640250eca809a8e047b7b5` | `yell/ics55_v2`，未定义 PG layer 的 LEF/GRDB 边界 |
| `ecc-sizer` | `eba239d` | `yell/ics55_v2`，Liberty 识别、scalar LUT、物理 pin 校验、打包 |
| `ecos-installer` | 本机原 checkout | `yell/ics55_v2`，实际 registry/installer 的生成源 |
| ECC-FE | `5da54e61aa4c3c49bb86bc3c5d2bb2337db644df` | 已与 Studio main gitlink 和 origin/main 对齐，无需改代码/分支 |
| v2 PDK | `25ed1437181f293b3792342a1fc0f3d2af0398cc` | 按后续授权，将 implant 层声明合入默认分支 `v2`，提交 `7d83e6d8b0427ae1b5e76b43a112f26fbabe4a50` |

开始前 Studio 的 `ecc` gitlink，以及 ECC 的 `ecc-dreamplace` gitlink 已与
父仓库记录不同；这些原有状态保留。Sizer 起点落后 origin/main 28 个提交，
没有混入这 28 个提交。首次本机验证时源码尚未提交；按用户后续要求，
迁移代码现已提交到各仓库的 `yell/ics55_v2` 分支并上传 GitHub，见第 8 节。

旧 PDK 基线：
`/nfs/home/huangzengrong/.local/share/ecc/pdks/icsprout55/v1.10.103`。
新 PDK 分析输入：
`/nfs/home/huangzengrong/projects/pdk/icsprout55-pdk-v2`。
新 release：`v2-2026.10.28`。

重要修正：`icsprout55-pdk-v2` 仓库是私有仓库，但同一个 `25ed1437...`
commit 及 v2 release assets 已在公开的 `openecos-projects/icsprout55-pdk`
可获取。首次迁移因此保持 `.gitmodules` 的公开 URL 和产品内目录
`pdk/icsprout55-pdk`，仅切换 PDK checkout/gitlink；无需引入私有仓库下载权限。
嵌套 PLL、DDR 继续使用 PDK 固定的 commit（分别以 `6ebb1a8`、`7660f6e`
开头），不升级到最新版本。

2026-11-14 的 implant 层归属调整已通过私有 PDK PR #1 合入默认分支
`v2`，提交 `7d83e6d8b0427ae1b5e76b43a112f26fbabe4a50`。用户明确要求
仅更新私有 v2 仓库、后续下载使用授权访问。因此当前 `.gitmodules`、ECC
CI pin、ecc-tools CI 和安装器基础包均改为私有仓库；不更新公开镜像。
Liberty/GDS 原有发布包没有修改，继续使用原公开 release 的固定文件。

ECC CI 的 `icsprout55-pdk` artifact 现只包含 `pdk-source.json` 和
`fetch-pdk.sh`，后续 ECC/Studio job 按同一 CI run 的 manifest 授权下载，
不再把完整 PDK 上传到公开 artifact。相关仓库需配置 `PDK_READ_TOKEN`
（私有 PDK Contents: read；ECC 可复用已有 `GH_TOKEN`）。Studio 的递归
submodule checkout 也使用此 token。当前公共 CI provenance lock 不能伪造为
本地构建结果；待新 ECC CI 成功后按仓库流程刷新 `.github/ecc-ci-toolchain.json`。

安装器通过 `gh api` 下载基础包，可使用 `gh auth login` 或 `GH_TOKEN`；
GUI Resource Manager 使用启动环境的 `GH_TOKEN` / `GITHUB_TOKEN`，仅对
固定的私有 PDK GitHub API 地址发送认证，转向 codeload 时不转发 token。
基础包 SHA-256：`a66877ff439f13960fccea2fe45a9e41b7eab1f84ef3fd7453c452fb928642e3`，
安装版本为 `v2-2026.10.28-7d83e6d`，避免复用已安装的同日期旧基础包。
nightly 完整包包含私有 PDK，只允许发布到已核验的私有
`NIGHTLY_RELEASE_REPO`；默认公开目标会明确失败，不发布私有数据。

本轮验证记录：

- ECC 源码全套测试：4427 passed、3 skipped、1 deselected、4 xfailed；
  ECC Agent 272 passed；ecc-tools Python API 22 passed。
- 系统 CLI / 新技术 LEF：GCD 21/21（含 CTS/Harden）；桌面 E2E 17 passed、
  11 skipped。E2E 是私有下载入口调整前对本机已安装 PDK 的验证；下载入口
  改动后没有重复约 49 分钟的完整物理流程。
- GUI 下载改动后 `pnpm run check` 通过：infra 7、shared 224、renderer
  1691、desktop 1564 passed；desktop 另有 1 skipped。新增授权下载测试 5 项。
- `python3 -m unittest discover -s .github/scripts/tests -v`：19 passed。
- installer `nix flake check` 全部通过；安装器 E2E 34 passed，包括模拟
  `gh api` 的私有 PDK 安装、checksum 校验及不输出 token。
- 授权获取真实 GitHub archive 后，核对生成 registry 的 hash/strip_prefix，
  技术 LEF SHA-256 为 `8fae4f13f733e77460cf79573df7ffbbd48ee73841d701792e4b7416c118b3ed`。
- Studio `make build` 再次完成，包含 chip-viewer native、Agent、AppImage、deb。
  使用 `dev-studio-v2-env.sh` 指定本机验证过的 Sizer，避免取 main 的其他构建。
- `xvfb-run -a env ECOS_ELECTRON_DISABLE_GPU=1 ECOS_ELECTRON_DISABLE_SANDBOX=1
  pnpm run desktop:smoke` 通过。直接在无 DISPLAY 的终端启动会失败，已在
  Xvfb 环境复验通过。
- 实际 registry URL 检查中，私有 PDK GitHub API 入口通过；整份 registry
  检查未通过，24 个原有 GitHub 公共下载地址在默认 5 秒 HEAD/SSL 超时。
  这是尚未通过的网络可达性检查，不能记为全量下载成功；见
  `logs/ics55-private-registry-urls.log`。真实私有基础包另已完整下载并校验。
- 工作流 `actionlint` 通过（声明忽略已有的自托管 runner 名称检查）；下载脚本
  `shellcheck` 通过。远端 CI 尚未验证：需要各仓库的 `PDK_READ_TOKEN`，
  然后才能产生新 ECC CI run 并刷新产品 provenance lock。未将本地登录凭据
  自动上传为 GitHub secret，也未发布安装器/registry 到生产下载站点。

验证日志和构建文件保存在
`/nfs/home/huangzengrong/projects/benchmark/ics55-native-pdk-artifacts`。
ARM9 后续检查见其中 `arm9-analysis.md`：现有工作区仍在 DR 计算，PA→GR
接入层契约导致全量 fallback，需独立修复路由器；本轮仅检查，未中断用户运行。

## 2. PDK 差异与采用的契约

| 内容 | 系统旧 PDK | v2 | 代码影响 |
| --- | --- | --- | --- |
| tech LEF | `prtech/techLEF/N551P6M{,_ecos}.lef` | 同路径、两份 SHA256 均与旧版相同 | routing stack/DBU 路径不变，但不能只用 tech hash 区分 PDK |
| layermap | `techfile/icsprout55.layermap` | SHA256 相同 | GDS layer mapping 路径不变 |
| stdcell 根 | `ics55_LLSC_H7C_V1p10C100/ics55_LLSC_H7C{R,L,H}` | `ICsprout55_SC9T_BASIC_{SVT,LVT,HVT}` | 所有默认 LEF/lib 路径重写 |
| cell LEF | `ics55_LLSC_H7C*_ecos.lef` | `lef/ICsprout55_9T<VT>_basic.lef` | 每 VT 719 个 master |
| core site | `core7`，高 1.4 µm | `SC9T_site`，宽 0.2、高 1.8 µm，DBU=1000 | 新 site 定义在 cell LEF，不能只扫描 tech LEF |
| cell 名 | `...H7R/H7L/H7H` | `..._9TSVT/_9TLVT/_9THVT` | synthesis、sizer、drive family、CTS、filler 全部迁移 |
| stdcell PG | 旧 view 契约 | `VDD/VSS/VNW/VPW` | 全局连接补充 VNW→VDD、VPW→VSS |
| IO | 深层旧 `ICsprout_55LLULP1233_IO_251013` 布局 | `IP/IO/{lef,liberty,gds,verilog,cdl,...}` | IO 路径/site/电源名不同；默认 core flow 不强制加载 IO |
| release archive | H7C archive | `ICsprout55_SC9T_BASIC_<VT>_liberty_nldm.tar.bz2` 等 | 下载 registry、安装 marker、测试归档同步更新 |

每 VT 的 719 个 LEF master 与所用 SS NLDM 的 719 个 cell 名集合完全一致。
v2 提供每 VT 16 个 NLDM 和 16 个 CCS corner；本次后端使用 NLDM。默认
1.2 V 域：SS 1.08 V、TT 1.2 V、FF 1.32 V。另有 SS 0.9 V / TT 1.0 V /
FF 1.1 V 的 1.0 V 域，本次不混入。

STA 的逻辑 corner 名保留，文件后缀更新为：

| 组 | v2 Liberty corner 后缀（每组 HVT/LVT/SVT） |
| --- | --- |
| MAX | `ss_v1p08_125c_basic_nldm.lib` |
| WCL | `ss_v1p08_-40c_basic_nldm.lib` |
| TYP | `tt_v1p2_25c_basic_nldm.lib` |
| MIN | `ff_v1p32_-40c_basic_nldm.lib` |
| ML | `ff_v1p32_125c_basic_nldm.lib` |

RC corner 名 `TYPICAL/RCbest/RCworst/Cbest/Cworst` 保持。电压/温度选择是
本次工程默认策略，并不等于新的 foundry signoff 认证。

| 用途 | v2 默认 |
| --- | --- |
| core / IO / corner site | `SC9T_site` / `IOSite` / `CornerSite` |
| tie high / low | `TIEHIX1_9TSVT` / `TIELOX1_9TSVT`，输出 `Y`（旧版为 `Z`） |
| ABC driver | `BUFX0P5_9TSVT` |
| fixed buffer | `BUFX1_9TLVT` |
| CTS / drive table | `BUFX8/12/16/24_9TLVT`；v2 没有旧的 20 倍驱动 |
| filler | `FILL32/16/8/4/2/1_9TSVT`；没有 FILL64 |
| decap | `FILLCAP32/16/8/4_9TSVT` |
| well tap / row-edge tap | `TAPX1_9TSVT`，LEF 宽 1.0 µm |

v2 没有独立命名的 endcap。当前实现沿用 row-edge 放 tap 的工程策略，
`end_cap/side_endcap` 使用 `TAPX1_9TSVT`；不是宣称它已被 foundry 确认为
专用 endcap。另一 tap `TAPVNPWX1_9TSVT` 宽 0.8 µm，未擅自混用。
PDN、row 数、utilization、tap 间距和面积都必须以新 LEF 重新计算；不能
把旧 H7 GCD 的坐标/面积直接当作 v2 golden。

Yosys latch 映射也不能只替换后缀：低/高电平 latch 为 LATNQ/LATQ，clock
pin 分别 CKN/CK；reset 对应 LATNRNQ/LATRNQ、RN，set 对应
LATNSNQ/LATSNQ、SN；三态 buffer 是 TBUFX、A/OE/Y。

### 真实 view 审计发现

审计结果保存于 `ics55-v2-artifacts/pdk-cell-audit.json`，检查了三组 SS NLDM 与 LEF：

- 每 VT 16 个 scalar timing tables。旧 Sizer 仅支持 1D/2D，release build
  关闭 assert 后解引用空 axis，preplace SIGSEGV。现支持 scalar、1D、2D，
  缺失维度复制常量值；保留时间/电容单位和二维转置。
- 每 VT 四个 BENC 单元（X0P5/1/2/4）的 Liberty 引脚 M1/M2 与 LEF
  MET1/MET2 不一致。不能安全猜测连接关系；ECC `dont_use` 加 `BENCX*`，
  Sizer 根据物理 pin 实际匹配剔除不可用 sizing candidate，并输出原因。
  不修改 release 文件、不重命名设计 netlist。
- CKGT/CKGTN 的 M/PM 是 Liberty `direction: internal`，并非漏掉的外部
  LEF pin；Sizer 跳过内部节点。不得把这一差异误报为 PDK 错误。
- SVT LEF 没有未定义 layer；LVT 引用 NVT1/PVT1，HVT 引用 NVT3/PVT3，
  原始 layermap 已分别定义 17/1、18/1、21/1、22/1。2026-11-14 已将
  四个 MASTERSLICE 声明并入 PDK 的 `prtech/techLEF/N551P6M_ecos.lef`，
  经 PDK v2 PR #1 合入默认分支 `v2`（`7d83e6d8b0427ae1b5e76b43a112f26fbabe4a50`）。
  ECC 不再携带或加载独立 implant 补充 LEF；默认 LEF 列表只含 PDK 中
  的 SVT/LVT/HVT 单元文件。原始 OBS 几何、GDS 编号及 routing 规则保持不变。
  使用此版 ECC 时应同步更新 PDK 技术 LEF，旧工作区的显式 LEF 覆盖需重新解析。

IO LEF 为 `IP/IO/lef/IC055L_GPIO3P3V_CDG_6M.lef` 与
`IC055L_PAD_1P6M_5IM_T4M2.lef`，Verilog 是
`IP/IO/verilog/IC055L_GPIO3P3V_CDG.v`。IO Liberty 使用
`ic055l_gpio3p3v_cdg_*_nldm.lib`，PG 是 IOVDD/COREVDD/IOGND/COREGND。
本次 GCD 为 core-only，未对 pad ring、多电压 IO 或全部 IO corner 做
签核验证。旧 `_ICS55_INVALID_IO_LIBS` 只保护显式旧文件名，不会改写 v2 IO；
它不是 v2 IO 合格证明。

## 3. 分仓库修改方案及已实施内容

### ECC

- `chipcompiler/data/pdk.py`：内置 ICS55 绑定 v2，要求三 VT LEF/lib 完整，
  不再通过 `is_file` 过滤掉缺失的必需库而伪装成功。路径优先级仍为显式
  root > 环境变量 > parent PDK 路径；缺失 v2 view 给出校验错误。
- `data/config_params/{floorplan,sta,dreamplace,dreamplace_cooptimization}.py`
  及对应 `tools/ecc/configs/*.json`、DreamPlace JSON：site、tap、filler、
  PG global connect、五组 STA corner、buffer/suffix 一起更新。
- `tools/yosys/builder.py`、`scripts/yosys_synthesis.tcl`：LVT+SVT 用于综合，
  HVT 留给 backend/STA，识别 `_9THVT_`；更新 driver、latch、DFF、tristate
  名称和 pin。保留旧 H7 matcher 仅用于显式历史输入。
- 测试最小 PDK fixture、workspace/CLI override、Yosys 和 placement
  regression 的默认值迁移；历史 SPEF/DEF/netlist 不能只替换字符串。
- `chipcompiler/docs/ecc-config-ref.cn.md` 更新默认说明。
- PDK 原生技术 LEF 补齐 LVT/HVT OBS 的缺层；`module.gds_save`
  必须传播 native false，禁止 filler 在 stream-out 失败后标记成功。
- PyInstaller 自动收集 `chipcompiler` 时排除 vendored checkout；运行时
  依赖用独立显式 collector 收集，避免源码构建目录中的旧 `.so` 混入包。
- `.github/revision.toml` 的 PDK pin/release 更新为 v2；CI 解压后验证
  `release-files.sha256`。Sizer 的新正式 CI artifact 尚未发布，旧 Sizer
  CI pin 不伪造，发布顺序见第 6 节。

### ecc-tools / ecc-dreamplace

`ecc-tools/src/operation/iSTA/interface/LibertyDataExporter.cpp` 的 family
regex 同时识别 `X<drive>_9T(HVT|LVT|SVT)` 和历史 `X<drive>H7[HRL]`，
包括 `0P5` 等小数驱动。否则新 buffer 全部成为 singleton，丢失 drive/VT
分组。现有 `ista_liberty_export_contract` 加入真实行为回归。

金属 LVS 的 PDN graph 原先将只含 MASTERSLICE/IMPLANT 的 VNW/VPW 当作
金属端子，导致每个实例两次假断路。现在保留 logical supply assignment，
仅把全部几何均为这些已知非布线层的供电端子移出金属连接检查，并在 JSON
记录 `non_routing_supply_terminals`。空 pin、未知层、cut-only、混合金属
pin 仍参与 PDN 检查；原生测试覆盖这些边界。ECC checklist 为这部分生成
`coverage.lvs.substrate` advisory/unavailable，明确需要 foundry 阱/衬底
提取；不声称金属 LVS 已验证井连接。真实 VDD/VSS 金属开短路门槛保持零。

DreamPlace 的 `flows/buffer_drive_table.py` 和
`ops/buffer_insertion/drive_type_table.py` 两处都从 8/12/16/20 改为
8/12/16/24，并同步 `buffering_profiles.py`、`flow_profiles.py`、params、
iEDA/OpenROAD 导入的后缀。内部历史 RVT 标签可表示当前 SVT，不改变通用
算法的数据枚举。显式测试旧名字的用例保留作为历史解析回归。

完整 flow 进一步暴露 Xplace 的 `cpp_to_py/common/io/file_lefdef_db.cpp` 问题：
v2 的 VNW/VPW 使用 NP/PP MASTERSLICE；Xplace 有意仅保留 routing/cut
layer，但其 pin reader 原先仍在 release build 中把空 Layer 引用写入 Shape，随后
`GRDatabase::addCellObs()` SIGSEGV。现仅对未定义的 POWER/GROUND 层警告并
略过其几何，保留 pin 及其它有效 routing shape；SIGNAL pin 的未知层明确
拒绝，`Database::load()` 传播 LEF 解析错误。新增原生回归覆盖 fixed cell
上的未知 bias layer、rectangle/polygon、后续有效 M1 shape，以及未知
signal layer 的失败路径。未关闭 GPUGR；非布线层不被伪装成金属 routing layer。
Xplace 的兼容 commit 已单独上传，DreamPlace gitlink 已同步，见第 8 节。

原生 API CI 同步迁移：`test/refresh_ics55_fixture.py` 从已经完成全部
21 个阶段的 v2 GCD 工作区重建 DEF/Verilog/SPEF/config 夹具，记录各文件
SHA256，禁止对旧 H7 netlist 做字符串替换。测试使用 SC9T 几何、v2 buffer
family、MX2 的 S pin；对 clock-gate 的 TIELO 常量控制保留 backend RAT
检查，其余有效 setup endpoint 继续验证 capture deadline。CI 固定公开 PDK
commit/release 并校验完整发布 checksum。独立 ecc-tools 测试因此也不再依赖
系统旧 H7 PDK。

### ecc-sizer

实际绑定点是 `src/lib_parser.cpp` 的 `Circuit::lib_parser()`：
旧逻辑只匹配小写 `ics55`，v2 库名 `ICsprout55_9TSVT_...` 不命中。
现对库名做大小写无关识别，在默认 `num_vt=1` 的 ECC env 中设置三 VT 和
`_9THVT/_9TSVT/_9TLVT` 后缀。已显式配置的多 VT 环境不覆盖。旧 H7
识别仅为历史输入兼容，ECC 新工作区不会选择旧 PDK。

真实 GCD 暴露的两处兼容性问题也在 Sizer 修复：

1. `src/liberty_lut.{h,cpp}` 从 parser 提取 LUT 转换，支持 scalar、单点
   axis、一维和二维，避免空 axis、越界访问，补充 CTest。
2. Liberty→物理 master/pin 匹配审查，BENC 不能进入 sizing candidate；
   内部 Liberty 节点不被当成外部 pin。残留缺 pin 不再依赖 release build
   中会消失的 assert，而给出明确错误。

为了可构建/可替换的安装包，还修复了 Tcl 头使用依赖提供的 include path、
vendored greedy legalization 的 double 模板显式实例化，以及打包脚本：
匹配构建时 Tcl 版本、readelf/awk 的 pipefail/SIGPIPE、Nix 只读 Tcl 文件
复制后的写权限。Sizer 不硬编码 PDK 绝对路径；继续由 ECC 生成 LEF/lib/
DEF/Verilog/SDC 参数。

### Studio GUI / Agent / ECC-FE / Viewer

**GUI 需要同步更新。** Electron main 的
`pdkInventoryService.ts` 与 `resourceManagerService.ts` 必需文件集合从
H7 改为 v2 tech + 三 VT LEF + 三 VT 默认 Liberty；资源导入、完整性校验、
安装/更新、镜像失败、部分安装等测试归档跟随 v2 布局。Vue renderer 的
展示流程及 IPC schema 没有 PDK 单元名依赖，不需要为此新增界面或改合同。

Agent 新增 `optimization/pdk_evidence.py` 供 runtime/calibrate/experiment
共用：从 cell LEF 读取 SC9T_site、从 tech LEF 读取 DBU；fingerprint 纳入
标准单元 LEF 和 Liberty，避免相同 tech LEF 让 v1/v2 共用旧 replay cache。
大 Liberty 使用项目已有的 size/mtime/head-tail fingerprint 策略，LEF 和
tech 全 hash；它是缓存失效依据，不冒充完整发布 SHA256 校验。

ECC-FE 已核对到 Studio main 对应 `5da54e61...`，源码没有 ICS55 cell/lib/
LEF 绑定，因此不改。Chip Viewer 的 fill/tap/decap 通用识别能够覆盖
FILL/FILLCAP/TAP，无需添加工艺硬编码；产品测试使用真实新 DEF 验证链路。

### ecos-installer（实际 registry owner）

在线 registry 的源码不在 Studio，也不是手改 `ecos-registry` 镜像。
实际生成源是 `/nfs/home/huangzengrong/projects/repo/ecos-installer`：

- `nix/toolchain.toml` 更新公开 v2 commit base archive、三 VT NLDM/GDS、
  IO GDS 的版本、目标目录和 health marker；默认安装不下载未使用的 CCS。
- `nix/model/model.nix`、`nix/modules/core/render.nix` 更新必需包集合，
  允许没有已验证 CNB mirror 的 PDK 包只用公开 GitHub URL；声明 mirror
  时仍必须有对应 hash，不填写猜测的镜像地址。
- `hs/ecos-bump/src/EcosBump/PackageSet.hs` 修正“显式选中组件也永久保持
  旧 manual pin”的行为。通过 owner 命令 `nix run .#bump -- --only ...
  --force` 重新生成 `nix/_sources/generated.json`，没有手改生成 lock。
- installer/registry render 测试同步；`nix flake check --no-update-lock-file`
  已通过，`nix build .#tool-registry .#ecc-installer --out-link result-v2`
  已生成新 registry 和 installer。

本次没有部署远程 registry。发布新 CLI/Sizer artifact 后才更新它们的正式
下载 pin；不能让远程用户下载只有本机存在的包。本地 Studio 用 v2 目录导入
和新 runtime 验证，系统 ECC 已显式绑定本机 v2 安装。

## 4. 构建、安装与回滚

使用当前系统架构 Linux x86_64。ECC 在 CPython 3.11 环境构建 native
依赖与 PyInstaller；Sizer 使用其 Nix dev shell。清理过一次旧 DreamPlace
editable/wheel 残留冲突：仅 `uv sync --reinstall-package` 不足以移除
未被当前 RECORD 管理的旧 wheel 文件，必须确认最终 import 路径和内容。
所有 native/虚拟环境/打包内容均由构建或包管理命令生成。

主要构建命令（仓库内运行）：

```bash
# ECC：预备构建工具为 /tmp/ecc-cli-build-tools/bin 的 CMake 3.31 / Ninja。
PATH=/tmp/ecc-cli-build-tools/bin:$PATH CMAKE_BUILD_PARALLEL_LEVEL=8 \
 CMAKE_ARGS='-UPYTHON_MODULE_EXTENSION -UPYTHON_LIBRARY -DPYBIND11_FINDPYTHON=ON' \
 uv sync --no-build-isolation-package ecc-dreamplace \
         --no-build-isolation-package ecc-tools-bin --reinstall-package ecc-tools-bin
# 最终原生包用 wheel 重装，避免旧 editable RECORD 之外的残留遮蔽源码。
PATH=/tmp/ecc-cli-build-tools/bin:$PATH CMAKE_BUILD_PARALLEL_LEVEL=8 \
 CMAKE_ARGS='-UPYTHON_MODULE_EXTENSION -UPYTHON_LIBRARY -DPYBIND11_FINDPYTHON=ON' \
 uv pip install --no-deps --no-build-isolation --reinstall \
   ./chipcompiler/thirdparty/ecc-dreamplace ./chipcompiler/thirdparty/ecc-tools
# 若旧 DreamPlace inplace parser 头与 wheel build 冲突，先由 cmake target clean 清理。
uv build
uv run --no-sync pyinstaller ecc.spec --clean --noconfirm \
  --distpath dist-v2 --workpath build-pyinstaller-v2

# Sizer：使用自己的 flake 所锁定依赖。
nix develop --command bash -c 'cmake -S . -B build-v2 $CMAKE_FLAGS \
  -DCMAKE_BUILD_TYPE=Release -DBUILD_PYTHON=OFF \
  -DCMAKE_INTERPROCEDURAL_OPTIMIZATION=OFF && \
  cmake --build build-v2 --target Sizer ecc_sizer_liberty_lut_test -j8 && \
  ctest --test-dir build-v2 -R ecc_sizer_ --output-on-failure'
# package-sizer.sh 还需 PATH 中有 lddtree，并用 SIZER_TCL_LIBRARY 指向构建时 Tcl。
BINARY_PATH=build-v2/src/Sizer DIST_DIR=dist-v2 .github/scripts/package-sizer.sh
```

系统入口为 `~/.local/bin/ecc`、`~/.local/bin/Sizer`；安装目录：

- ECC：`~/.local/share/ecc/v0.1.0-alpha.12-ics55-v2-local`
- Sizer：`~/.local/share/ecc/tools/ecc-sizer/ics55-v2-local`
- PDK：`~/.local/share/ecc/pdks/icsprout55/v2-2026.10.28`

PDK 原始目录、Studio submodule 展开目录和系统安装目录均执行了
`sha256sum --check --quiet release-files.sha256`。旧安装版本目录保留，
旧入口备份为 `ecc.before-ics55-v2-20261114`、
`Sizer.before-ics55-v2-20261114`，位于 `~/.local/bin`。
恢复备份入口即可回滚，不需要修改旧 PDK 文件。

本机安装包构建时包含未提交修改，因此 `ecc version` 中的 baseline commit 不能单独代表
这些改动；交付应同时保存 source diff、安装包 SHA256 和运行 manifest。
系统继续使用原装 OSS CAD Suite 20260827、Kepler
0.5.0-nightly.20260929。这是本机测试工具链，与正式 ECC CI lock 的工具版本
不同；不能把本地结果冒充指定 CI run 的结果。

## 5. 验证记录

已完成的检查：

| 检查 | 结果 / 日志 |
| --- | --- |
| v2 发布文件 SHA256：输入/Studio/system | 三处通过，`/tmp/ics55-v2-*-pdk-*.log` |
| ECC 聚焦 Python tests | 119 passed；`/tmp/ics55-v2-ecc-tests.log` |
| ECC 全量 `test/` 最终 | 4427 passed、3 skipped、1 deselected、4 xfailed；`/tmp/ics55-v2-ecc-tests-complete.log`；包含实际 GCD 完整 integration flow |
| ECC `agent/test` | 272 passed；`/tmp/ics55-v2-ecc-agent-tests.log` |
| ecc-tools Python API `pytest data operations -v --maxfail=1` | v2 夹具 22 passed；`/tmp/ics55-v2-native-api2.log` |
| ecc-tools Liberty export / LVS CTest | 通过，LVS 3 项通过；`/tmp/ics55-v2-lvs-native-tests.log` |
| ECC LVS/PDK/module 聚焦 tests | 117 passed；`/tmp/ics55-v2-lvs-python-tests2.log` |
| DreamPlace 聚焦测试 | 108 passed；`/tmp/ics55-v2-dreamplace-tests.log` |
| Xplace 原生 GPUGR 回归 | 3 passed；`/tmp/ics55-v2-xplace-tests2.log` |
| Sizer CTest | scalar/1D/2D LUT、special net、legalize 三项通过 |
| Studio GUI `pnpm run check` | typecheck/lint/format 及 infra 7、shared 224、renderer 1680、electron 1557 tests passed（另 1 skipped） |
| Studio Agent 聚焦 tests | 50 passed |
| Studio Agent 全量 | 1335 passed、1 skipped、7 failed；knowledge baseline 与当前 ECC/DP 参数/源码 spans 不一致，详见 `/tmp/ics55-v2-agent-tests.log` |
| Chip Viewer `cargo test --workspace` | 398 passed；`/tmp/ics55-v2-viewer-tests.log` |
| Studio GUI rtl2gds E2E | 5 passed、1 skipped（未配置独立 signoff-lit）；`/tmp/ics55-v2-product-rtl2gds.log` |
| Studio 内置终端 E2E | 1 passed；`/tmp/ics55-v2-product-cli-flow.log` |
| Studio 并发 E2E | 3 passed；双工作区均 21/21、同时启动、取消隔离通过；`/tmp/ics55-v2-product-flow-concurrency.log` |
| Packaged reproducible CLI smoke | pass；`/tmp/ics55-v2-reproducible-cli-smoke.log` |
| Desktop build + xvfb smoke | 通过；`/tmp/ics55-v2-desktop-{build,smoke}.log` |
| Studio `make build` | 已用最终 Sizer 再构建 Linux AppImage/deb，通过；`/tmp/ics55-v2-studio-build-final.log` |
| ECC `nix flake check -L` | 包含新增补充 LEF 与 LVS 源码，通过；`/tmp/ics55-v2-ecc-flake-check-complete.log` |
| ecos-installer `nix flake check --no-update-lock-file` | 全通过；`/tmp/ics55-v2-installer-check3.log` |

Studio Agent 的 7 项 knowledge 失败涉及当前 ECC/DP 原有 checkout 的参数
contract（如 `joint_alternating_outer_rounds`）及 source spans；尝试生成时
还缺失对应参数 meanings，不能为了迁移把校验关闭或造一组含义。没有保留
临时 knowledge 修改。已用各仓库 HEAD 的 `git archive` 在独立目录
`/tmp/ics55-v2-baseline-ti9hvrl5` 重建迁移前源码，使用相同依赖和对应
7 个测试逐项复测：仍为相同 7 项失败，见
`/tmp/ics55-v2-agent-baseline-seven.log`。因此这组基线问题与本次迁移
结果分别报告，未把它们关闭或当成通过。

系统 GCD 验证：

```text
RTL: /nfs/home/huangzengrong/projects/benchmark/gcd.v
项目: /nfs/home/huangzengrong/projects/benchmark/gcd-ics55-v2-20261114
workspace: v2-final
时钟: clk, 100 MHz
preset: rtl2gds（完整运行，包含 Harden）
PDK: 系统 v2-2026.10.28
EMIR: ECC 仓库 test/fixtures/emir/ics55_synthetic.tech
```

EMIR synthetic fixture 只用于走通流程，不是 foundry IR/EM signoff 数据。
源码完整工作区 `v2-native` 已通过 21/21 阶段，Harden 输出 GDS 957528
bytes、LEF 15872 bytes、Liberty 25786 bytes。KLayout 验证 GDS top 为
`gcd`，包含 17/1、18/1、21/1、22/1 注入层。metal LVS 违规为 0；
1978 个 non-routing supply terminals 作为 coverage advisory 保留。
最终系统安装包的新工作区 `v2-final` 同样 21/21 全部成功，独立从用户
原始 RTL 启动，没有复用源码工作区的 checkpoint。产物大小与上述一致，
验证 manifest 为 `ics55-v2-artifacts/gcd-installed-result.json`。GUI（5 passed，1 optional lit skipped）和内置终端（1 passed）
E2E 已独立通过，打包 CLI 导出复现 smoke 也通过。并发 E2E 的 3 项测试
全部通过：两个重叠运行的工作区均 21/21 成功，同时启动和取消隔离通过。

最终本机安装包位于 `/nfs/home/huangzengrong/projects/benchmark/ics55-v2-artifacts/`：

| 包 | SHA256 |
| --- | --- |
| `ecc-linux-x64.tar.gz` | `e6edc4818a809437d02964010536b628aaa30b204d6bfe1ebaa8386dde7f3c86` |
| `ecc-sizer-linux-x64.tar.gz` | `7814fc5c6047e0abf528f630fbbf5a4817c15f4c52a642da700ea8105abfded0` |

首次迁移的 CLI 已由此归档解压替换系统目录；包装脚本指定 v2 PDK 和新 Sizer。校验
包中 native library 与最终 wheel 一致，补充 LEF 已包含，buffer table 为
8/12/16/24，未收录 vendored checkout 的旧动态库。`ecc version` 可正常
识别 ECC 0.1.0a12、DreamPlace 0.1.0a7、ecc-tools 0.1.0a13 及所有外部工具。

PDK 原生 implant 层方案的独立回归位于
`/nfs/home/huangzengrong/projects/benchmark/gcd-pdk-native-implants-20261114/native-pdk`，
使用修改后的 ECC 源码和 PDK `7d83e6d...`，21/21 阶段成功。
GDS/LEF/Liberty 分别为 957528/15872/25786 字节；产物校验值记录在
`/nfs/home/huangzengrong/projects/benchmark/ics55-native-pdk-artifacts/gcd-result.json`。
对应原生测试夹具由此工作区重新生成，provenance 记录技术 LEF 的 SHA256。

`run-studio-v2.sh` 用新构建 AppImage 和明确的本机新 runtime 启动 Studio；
`run-product-e2e.sh` 为可复现的三条产品测试入口。正式 registry 尚未发布，
直接启动不带 runtime override 的发行包仍可能下载远程旧 CLI，因此本机
测试和启动明确使用 `ECOS_ECC_BIN_DIR`，不伪称远程发行已完成。

## 6. 正式发布的依赖顺序与边界

本机替换不需要等远程发布；正式可复现发行需要按以下顺序完成：

1. 先发布 Xplace，再发布 ecc-tools、ecc-dreamplace、ecc-sizer 的兼容 commit/artifact。
2. ECC pin 到已发布的子仓库 commit，`.github/revision.toml` 的 Sizer
   artifact 更新到新 CI run；运行 v2 的完整设计矩阵。
3. 用成功的 ECC packaged-design run 更新 Studio 的 ECC gitlink 和
   `.github/ecc-ci-toolchain.json`，保持 PDK/Sizer 同一 run 的 provenance：

   ```bash
   python3 .github/scripts/resolve-ecc-toolchain.py <run-id> <ecc-sha> \
     --refresh-from-logs --output .github/ecc-ci-toolchain.json
   ```

4. 更新 ecos-installer 的 CLI/Sizer 正式下载 pin、生成 registry/installer，
   验证后部署 registry，最后发布 Studio。不能把本地未发布子仓库 commit
   或虚构 CI run/sha 填入 parent PR。

本机代码、安装和 GCD 测试之后，已按用户追加要求上传源码分支；正式安装包
发行和远程 registry 部署仍未执行，没有伪造对应 CI provenance。
旧 workspace/旧 H7 netlist 不做文本
替换；新的内置 `ics55` 要求 v2，历史项目需保留原工具/PDK 或从 RTL 新建
workspace。若后续 PDK 更改 site、cell、pin 或 voltage 契约，需要新的显式
迁移；当前实现不会猜测任意未来文件名。

## 7. 检查命令与未覆盖范围

最终验证使用本机新 PDK/Sizer/OSS CAD/Kepler 环境，环境定义保存在
`ics55-v2-artifacts/v2-runtime-env.sh`。主要命令：

```bash
# ECC，完整用例含实际 RTL-to-GDS integration
uv run --no-sync pytest test/ -v --basetemp=/tmp/ics55-v2-ecc-pytest-complete --cov=chipcompiler --cov-report=
uv run --no-sync pytest agent/test -q
uv run --no-sync ruff check chipcompiler/ test/
uv run --no-sync ruff format --check chipcompiler/ test/
uv run --no-sync basedpyright
nix flake check -L
# ecc-tools/test，设置 ECC_TOOLS_TEST_{REPO,PDK,ARTIFACT}_ROOT 与 ECC_LOGGER_THROW_ON_ERROR=1
python -m pytest data operations -v --maxfail=1
ctest --test-dir build -R 'test_lvs_(interface|flow|data_manager)' --output-on-failure
# Studio
(cd ecos/gui && pnpm run check)
(cd ecos/chip-viewer && cargo test --workspace)
make build
# 每条 journey 使用独立 app HOME/XDG 与新安装 CLI
ics55-v2-artifacts/run-product-e2e.sh rtl2gds
ics55-v2-artifacts/run-product-e2e.sh cli-flow
ics55-v2-artifacts/run-product-e2e.sh flow-concurrency
```

- `git diff --check` 已检查各修改仓库。ecc-tools 新 LVS 代码通过编译及
  原生/API测试；clang-format 对相关整文件报告 14 处原有格式差异，逐个
  对比 HEAD 与当前文件的报告数完全相同，新增测试文件为 0。没有为格式
  清理混入不相关大 diff。
- 本机运行 Linux x86_64 CPU 路径；未运行 GPU、macOS、Windows 或全部
  ASIC benchmark matrix，未做 IO/pad-ring 和 foundry DRC/LVS/EMIR 签核。
- Studio optional `signoff-lit` 未配置独立 suite，因此明确 skipped；原有
  flow quality gates、post-route LEC、STA 和 Harden 均运行，并非绕过。
- 源码已上传迁移分支；正式 artifacts/registry 尚未发布。Studio 的 ECC
  gitlink 已引用已上传的迁移 commit，`.github/ecc-ci-toolchain.json` 仍保留
  原有成功 run 的真实记录，尚未与新 gitlink 对齐。新 Sizer artifact 与 ECC
  packaged-design CI 成功后，须按第 6 节刷新锁定，才能进入 PR 合并/正式发行。
- `ics55-v2-artifacts/logs/` 保存执行日志；`gcd-harden/` 保存最终系统安装版
  产物和检查记录；`product-e2e/*/shots/` 保存真实界面截图。
- 交付入口为 `/nfs/home/huangzengrong/projects/benchmark/ics55-v2-artifacts/README.md`；
  `source-provenance.json` 和 `source-diffs/` 保存七个仓库的起点与完整修改，
  包含首次验证时尚未提交的新源码文件。上传后的 commit/分支记录另存
  `github-branches.json`，不覆盖原始构建 provenance。完整方案也复制到该目录。

## 8. GitHub 分支上传

按用户要求上传 `yell/ics55_v2`，不创建 PR、不合并 main、不发布 release。
源码内容与第 5 节已验证的代码一致；上传阶段新增的是提交记录、子仓库
gitlink、Xplace 发布地址和本节文档。提交前检查了各仓库 diff、文件范围、
凭据模式和工作树；底层仓库先推送成功，父仓库再提交引用。

| 仓库 | GitHub 分支 | 上传 commit |
| --- | --- | --- |
| ECOS Studio | [ecos-studio](https://github.com/openecos-projects/ecos-studio/tree/yell/ics55_v2) | 本文所在分支，最终 SHA 另存 `github-branches.json` |
| ECC | [ecc](https://github.com/openecos-projects/ecc/tree/yell/ics55_v2) | `b943de5f` |
| ecc-tools | [ecc-tools](https://github.com/openecos-projects/ecc-tools/tree/yell/ics55_v2) | `ac5fb46e4` |
| ecc-dreamplace | [ecc-dreamplace](https://github.com/openecos-projects/ecc-dreamplace/tree/yell/ics55_v2) | `ccb70c0a` |
| Xplace | [zhaoxueyan1/Xplace](https://github.com/zhaoxueyan1/Xplace/tree/yell/ics55_v2) | `373805a4` |
| ecc-sizer | [ecc-sizer](https://github.com/openecos-projects/ecc-sizer/tree/yell/ics55_v2) | `d1b76317` |
| ecos-installer | [ecos-installer](https://github.com/openecos-projects/ecos-installer/tree/yell/ics55_v2) | `b726271b` |

首次上传时 GitHub 账户 `Yell-walkalone` 对 `zhaoxueyan1/Xplace` 没有写权限，
先使用该账户的公开 fork。2026-11-14（北京时间）接受原仓库的 write 邀请后，
已将同一个 `373805a4` commit 推送到 `zhaoxueyan1/Xplace` 的同名分支。
DreamPlace 的 `.gitmodules` 已恢复原仓库 URL，ECC、Studio 的父仓库引用
逐层同步并推送。原 fork 保留，但当前依赖链使用原仓库。
此次仅修改仓库地址、gitlink 和文档；提交检查及远程 SHA/引用核对通过，
没有重跑完整 flow 或重编译，已验证的算法代码与本机安装包均未改变。

ECC-FE、PDK 及其 PLL/DDR 子仓库没有源码修改，继续引用现有公开 commit，
不创建空的迁移提交。Studio/ECC 的 feature branch push 不会自动触发其
完整主 CI；本节不将上一轮本机通过结果声明为远程 CI 已通过。

## 9. 同步 Studio main 后重建开发环境

2026-11-14 按用户要求，先 fetch GitHub `main`，将 `e660d253`
（STA 时序违规可视化及大版图优化）无冲突合入 `yell/ics55_v2`，合并提交为
`e2a1168a`。ECC 继续使用已验证的 v2 分支 `b943de5f`，ECC-FE 和 PDK pin
不变；没有切换 ECC 到其它基线。main 带来的 CI manifest 是其原有真实
run 记录，v2 正式发行前仍须按第 6 节重新解析匹配的 run。

重新执行并通过：

- `make build`：Chip Viewer release、Agent、GUI、AppImage/deb 全部成功，
  打包 Sizer 明确使用系统 `ics55-v2-local`，staged Viewer 与 release SHA256 一致。
- `cargo build --locked -p chip-viewer-native`：额外构建开发模式实际使用的
  `target/debug/chip-viewer-native`，避免第一次打开版图时才编译。
- `cargo fmt --all -- --check` 和 `cargo test --workspace --locked`：435 项通过。
- `pnpm run check`：typecheck/lint/format 通过；infra 7、shared 224、
  renderer 1691、electron 1559 项通过，另 1 项 skipped。
- `pnpm run desktop:smoke`：Electron 启动检查通过。
- 在 Xvfb 中实际运行 `pnpm dev`，页面及 desktop bridge 加载成功，界面
  返回 ECC 0.1.0a12、DreamPlace 0.1.0a7、ecc-tools 0.1.0a13，并确认选中
  系统 `v0.1.0-alpha.12-ics55-v2-local/ecc`。本次未重跑整条 RTL-to-Harden。
- Viewer debug 在软件渲染模式加载 `v2-final` 的 STA geometry/feature，
  观察 20 秒无 panic 或窗口错误，随后由测试主动终止；未额外验证硬件 GPU 路径。

GUI 开发启动命令：

```bash
cd /nfs/home/huangzengrong/projects/repo/ecos_studio_2/ecos/gui
source /nfs/home/huangzengrong/projects/benchmark/ics55-v2-artifacts/dev-studio-v2-env.sh
pnpm dev
```

该环境脚本选择系统 v2 CLI、PDK、Sizer 和原验证工具链，并设置
`UV_NO_SYNC=1`，让 Viewer 的开发 ECC wrapper 复用已构建的 Python 环境。
没有把本机绝对路径写入产品源码或修改用户 shell 启动配置。

构建文件 SHA256 见 `ics55-v2-artifacts/studio-main-build.json`；dev 启动结果
及截图见 `studio-main-dev/`；对应日志为 `logs/ics55-v2-studio-main-*.log`。
