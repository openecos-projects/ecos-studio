# Update Workspace 参数保留方案

## 结论

当前“Update Workspace”向导走的是结构化的 `workspace.update`。该操作会按新的
Workspace Spec 在临时目录中重新创建 Workspace，然后原子替换旧目录；它不是在旧
Workspace 的配置文件上做增量修改。因此，新的 Spec 没有携带的参数会在 ECC 的
`resolve_parameters()` 阶段回到 schema/template 默认值。

这会导致以下行为：向导界面能编辑的少数参数会被保留，Workspace 中其它由
`workspace config` 管理的参数（例如 `cts.skew_bound`、其它 CTS/Floorplan/
DreamPlace/Route/RCX/STA 参数）可能被重置为默认值。

可以支持“除界面本次修改外，其余 Workspace 配置参数保持原值”。推荐把合并规则放在
ECC 的结构化更新边界，由 ECC 从当前已提交 Workspace 读取 canonical 参数，再用请求
中的参数覆盖同名字段。这样 GUI、Agent、CLI 等所有调用方都得到一致语义，且不会把
参数保留责任放在 Vue 向导上。

## 当前执行策略

### 1. 向导读取当前 Workspace

点击更新 Workspace 后，renderer 通过运行时 snapshot 读取当前 Workspace 的
`workspaceSpec` 和 `workspaceBindings`：

- `ecos/gui/apps/renderer/src/App.vue:694-710`
- `ecos/gui/apps/renderer/src/utils/workspaceReconfigure.ts:26-123`

`workspaceReconfigureInitialConfig()` 会把 canonical `workspaceSpec.parameters`
完整展开到 `WorkspaceConfig.parameters`，同时把频率、利用率、die 尺寸、最大扇出、
放置密度等字段转换成向导使用的别名。

### 2. 当前 Workspace 更新入口

当目标目录就是当前打开的后端 Workspace，且用户没有要求保留替换备份时，renderer
调用：

- `ecos/gui/apps/renderer/src/composables/useWorkspace.ts:1092-1145`
- `ecos/gui/apps/renderer/src/api/workspace.ts:351-366`

请求是 `workspace.update`，携带当前 `workspaceHandle` 和
`expectedWorkspaceRevision`。Revision 不匹配时更新失败，避免用过期向导覆盖并发修改。

### 3. renderer 实际发送的参数集合

`backendWorkspaceOptions()` 会重新构造一个新的 Workspace Spec：

- `ecos/gui/apps/renderer/src/api/workspace.ts:79-224`

目前只明确写入以下参数：

| 向导字段 | Workspace Spec 参数 |
| --- | --- |
| `frequency_max` | `design.frequency_mhz` |
| `utilitization` / `core_utilization` | `floorplan.core_util` |
| die 模式 | `floorplan.die_builder.mode` |
| die 宽高 | `floorplan.die_builder.die_size.width_micron` / `height_micron` |
| `margin` | `floorplan.core_margin` |
| `max_fanout` | `cts.max_fanout` |
| `target_density` | `place.target_density` |
| `target_overflow` | `place.target_overflow` |

其它从 snapshot 回填到 `config.parameters` 的 canonical 参数并没有被复制到新的
`workspaceSpec.parameters`。因此，向导虽然读到了旧参数，随后又在 adapter 层丢弃了
它们。`backendWorkspaceOptions()` 中的 `100`、`0.5/0.6`、`20`、`0.2`、`0.1`
等 fallback 还会在输入缺失时显式制造新的默认值。

### 4. Electron 与 ECC 的更新行为

Electron Product Command 先准备 PDK/项目绑定，然后把新的 `workspaceSpec` 和绑定
交给 ECC：

- `ecos/gui/apps/desktop-electron/electron/services/productCommandService.ts:131-142`
- `ecos/gui/apps/desktop-electron/electron/services/eccRpc/workspaceRuntimeCommands.ts:176-204`

ECC 的 `update_workspace_from_spec()` 流程如下：

1. 读取当前 Workspace 和 Engineering Snapshot，校验 revision。
2. 在兄弟临时目录调用 `create_workspace_from_spec()`。
3. 用新的 Spec 调用 `resolve_parameters()`；没有出现在 Spec 中的参数使用 schema 默认值。
4. 重新生成 Workspace 配置文件和 flow/home 数据。
5. 复制 command ledger、递增 revision，最后原子交换目录。

对应实现：

- `ecc/chipcompiler/engine/workspace_lifecycle.py:236-310`
- `ecc/chipcompiler/engine/workspace_lifecycle.py:111-145`

`create_workspace_from_spec()` 当前使用 `build_backend_overrides(...,
include_defaults=True)`，并只对当前请求中显式出现的 config 参数生成
`config_overrides`：

- `ecc/chipcompiler/engine/workspace_lifecycle.py:128-145`
- `ecc/chipcompiler/data/parameter_schema.py:344-424`

所以当前结构化更新的实际语义是“按新 Spec 重建”，不是“读取旧 Workspace 后 patch”。

## 为什么普通参数更新不会出现同样的问题

Workspace 设置页使用的是另一个接口 `workspace.configuration.update`。它只发送发生
变化的参数，ECC 在原 Workspace 上调用 `update_workspace_param_value()`，刷新配置并
保留其它值：

- `ecos/gui/apps/renderer/src/composables/workspaceConfigurationUpdate.ts:1-48`
- `ecc/chipcompiler/engine/workspace_configuration.py:61-148`

这个接口适合参数编辑，但不能单独替代结构化更新，因为设计名、顶层模块、输入文件、
PDK、flow 范围等变化需要重新构造 Workspace。

## 推荐方案：ECC 侧的 Preserve-and-Override

### 目标语义

对 `workspace.update` 定义以下合并规则：

```text
effective_parameters = current_workspace_parameters
effective_parameters.update(request.workspaceSpec.parameters)
```

- 当前 Workspace 是基线。
- 请求 Spec 中出现的参数是本次更新意图，优先级最高。
- 当前 Workspace 中未出现在请求里的已知参数保留原值。
- 新建 Workspace 仍按原逻辑使用默认值，因为新建没有 current Workspace。
- PDK 绑定、输入路径、输出路径、临时目录、flow 运行状态等生成字段不按普通参数
  保留，而由新 Spec/当前运行时重新生成。

### 推荐实现边界

#### A. 在 ECC 结构化更新入口读取 canonical 当前参数

在 `update_workspace_from_spec()` 中，完成 revision 校验后，从当前已提交 Workspace
生成 canonical 参数投影，复用已有的
`read_workspace_configuration(current)["workspaceSpec"]["parameters"]`。

不要从 renderer 的 `WorkspaceConfig` 或某个具体 JSON 文件推断参数，原因是：

- `read_workspace_configuration()` 已经按参数 registry 读取直接映射值和 config-target
  值。
- `config_coverage` 测试要求模板字段必须被 registry 或 protected/generated 列表覆盖。
- 这样 Agent、CLI、GUI 的结构化更新都使用同一套保留逻辑。

#### B. 合并后再做类型、范围和 flow 校验

建议增加一个仅供结构化 update 使用的合并函数，保持 create 路径不变：

1. 校验请求 `workspaceSpec.parameters` 是 object。
2. 读取当前 canonical 参数。
3. 对参数 key 做字符串规范化和深拷贝。
4. 以当前参数为 base，以请求参数覆盖同名 key。
5. 对最终结果执行现有 schema 类型、范围、unknown-key 校验。
6. 继续执行 PDK、输入、flow、MPC 等现有 Spec 校验。

请求中的参数必须始终优先，因此用户本次在向导修改的值不会被旧 Workspace 覆盖。

#### C. 明确 flow 变化时的“休眠参数”策略

当前 `validate_workspace_spec()` 会拒绝不适用于新 flow 的显式参数，而当前
Workspace 的 canonical projection 包含所有已知参数。为避免改变 flow 时因保留旧
参数而误报 `inapplicable_parameter`，建议：

- 把“请求中显式出现的参数”和“仅从 current 继承的参数”分开标记。
- 请求显式参数继续严格执行现有 applicability 校验。
- 仅继承且暂时不适用于新 flow 的参数作为 dormant 参数保留在新的
  `params.toml/config_overrides` 中，但不参与当前 flow 的运行。
- 新 flow 后续重新包含该 step 时，这些 dormant 参数仍可恢复为有效值。
- create/validate 公共路径默认仍为严格模式；只在 update 内部开启
  `allow_preserved_inapplicable_parameters`，避免放宽新建 Workspace 的校验。

如果产品暂时不需要支持跨 flow 范围保留 dormant 参数，第一阶段也可以先只合并适用于
新 flow 的参数，并在 flow 变化时给出明确提示；但这不满足“所有未修改 config 参数都
保留”的完整语义，推荐直接采用 dormant 策略。

#### D. 保留 config-target 参数和未知扩展字段

已知 config-target 参数应通过 registry 值重新生成 `config_overrides`，例如：

- `cts.*`
- `floorplan.*`
- `place.*` / DreamPlace 参数
- `route.*`
- `filler.*`
- `rcx.*`
- `sta.*`

这些字段由 `build_config_overrides()` 写回新配置，不能只保留 legacy
`workspace.parameters.data` 中的 backend 映射。

对于当前配置文件中不在 registry 的未知扩展字段，staging 阶段应从旧配置深拷贝到新
配置；但必须排除受生成器管理的字段，例如 PDK 路径、输入/输出路径、临时目录和由
flow 重新计算的字段。这样既符合“保留未知扩展字段”的持久化约定，也不会把旧目录
路径带入新 Workspace。

#### E. 继续复用现有原子事务和幂等协议

合并必须发生在现有 staging 目录创建之前或 staging 内部，不能先改写当前 Workspace。
应保持：

- `_workspace_lock()` 的串行化。
- expected revision 校验。
- command fingerprint/idempotency ledger。
- staging 失败时旧 Workspace 完整可用。
- 新 Workspace 加载失败时目录交换回滚。

方案不需要迁移已有 Workspace，也不改变 `workspaceRevision` 的含义。

## 备选方案及取舍

### 方案 A：只修改 renderer adapter

修改 `backendWorkspaceOptions()`，把 `config.parameters` 中所有 canonical 参数复制到
`workspaceSpec.parameters`，再覆盖 UI 字段。

优点：改动小，能够修复当前 GUI 向导的主要问题。缺点：

- 参数保留逻辑停留在 renderer，Agent/CLI 仍可能丢参数。
- renderer 需要知道 ECC registry 和 flow applicability 细节。
- 旧 snapshot 与当前 Workspace 之间可能出现竞态或版本差异。
- 未知 config 扩展字段仍无法可靠保留。

可作为短期止血，但不建议作为最终架构。

### 方案 B：结构化 update 前转成多个 configuration patch

先调用 `workspace.configuration.update` 保留参数，再执行结构化更新。

不推荐。两个 revisioned mutation 之间存在中间状态；第二步仍会重建 config，且失败时
需要跨两个 command ledger 做补偿，复杂度和恢复风险都高于在一个 ECC 原子更新中完成
合并。

### 方案 C：ECC 侧 Preserve-and-Override（推荐）

在唯一的结构化 update 权威边界合并 current canonical 参数、请求参数和必要的未知
扩展字段，再沿用现有 staging/交换流程。它的改动集中在 ECC lifecycle/spec helper，
调用方无需依赖具体 config 文件布局。

## 失败处理与兼容性

- 当前 Workspace 无法读取或 canonical 参数读取失败：整个 update 失败，保留旧目录，
  不静默回退默认值。
- 参数类型、范围、unknown key 或新 flow applicability 校验失败：返回现有结构化错误，
  不提交部分结果。
- PDK/输入绑定失败：继续由现有 Electron/ECC binding 校验处理，不使用旧绑定偷偷替代
  新请求。
- revision 冲突：保持现有行为，要求用户重新打开向导获取最新参数。
- 重试同一 `commandId`：必须继续命中同一 fingerprint；不同输入复用 commandId 仍报
  `idempotency_conflict`。
- PDK-target 参数不通过普通 Workspace 参数合并；PDK 变化由 `pdk` Spec、项目需求和
  binding 决定。
- 无需修改已有 Workspace 文件格式；仅增加 update 时的读取、合并和保留逻辑。

## 测试设计

### ECC 单元/集成测试

建议在 `ecc/test/engine/test_workspace_spec.py` 和相关 configuration 测试中增加：

1. 当前 Workspace 设置非默认 `cts.skew_bound`，结构化 update 只修改频率；更新后
   `CTS` config 和 canonical parameter 仍为旧值。
2. 当前 Workspace 设置多个 config-target 参数，结构化 update 修改 die/utilization；
   CTS、Floorplan、DreamPlace、Route、RCX、STA 的未修改参数全部保持。
3. 请求中显式修改同名参数时，请求值覆盖 current 值。
4. 更新请求省略 config 参数时，不回落到 template 默认值。
5. flow 改变导致旧参数不适用时，参数作为 dormant 值保留，当前 flow 仍可创建和运行。
6. PDK/输入路径等 generated/protected 字段仍由新绑定和新 flow 生成，不复用旧绝对路径。
7. 配置文件中加入未知扩展字段，结构化 update 后字段仍存在；生成路径字段不被旧值覆盖。
8. 参数读取失败、刷新失败、staging 加载失败时，旧目录 bytes、snapshot、revision 和
   command ledger 保持不变。
9. 重复 commandId 返回同一结果，错误复用 commandId 被拒绝。

### GUI/跨层测试

在 `ecos/gui` 增加或更新：

- `backendWorkspaceOptions()` 的回归测试，确认新建请求仍使用默认值语义。
- reconfigure snapshot 到 update 请求的契约测试，确认 renderer 不会覆盖 ECC 的
  preserve 规则。
- Product Command/ECC runtime 集成测试，确认 update 仍传递 revision、bindings 和
  commandId。

### 验收矩阵

| 场景 | 预期 |
| --- | --- |
| 只改向导频率 | 频率变更；其它 config 参数不变 |
| 只改 die/utilization | 对应 Floorplan 参数变更；CTS/Route/STA 等不变 |
| 只改输入文件/PDK | 绑定和生成路径更新；非界面 config 参数不变 |
| 改 flow 范围 | 当前 flow 可用；被移除 step 的旧参数以 dormant 形式保留 |
| 新建 Workspace | 与当前行为一致，未提供参数使用默认值 |
| 并发修改后提交旧向导 | revision conflict，不覆盖新参数 |
| 更新过程中失败 | 旧 Workspace 可继续打开，不能留下半更新目录 |

## 实施顺序

1. 在 ECC 增加 current canonical parameter 读取、merge helper 和 dormant 参数内部语义。
2. 在结构化 update 中接入 merge，保持 create 和普通 configuration update 的既有语义。
3. 增加 ECC 回归、事务回滚、未知字段和 flow 变化测试。
4. 增加 GUI/Product Command 契约测试，确认现有向导请求仍兼容。
5. 在真实 Workspace 上验证：先通过 CLI/参数页写入非默认高级 config 参数，再执行向导
   Update Workspace，比较更新前后的 canonical parameters 和受管理 config 文件。
6. 观察一轮发布后的 revision conflict、workspace update failure 和 config validation
   错误；确认没有默认值回退告警后再移除任何临时兼容代码。

## 验收标准

实现完成后，用户在当前 Workspace 中修改任意一项向导可见参数并执行 Update Workspace：

- 本次修改的参数采用向导新值。
- 其它 registry 管理的 Workspace config 参数保持更新前的有效值，不因结构化重建而回到
  默认值。
- PDK/输入/输出/临时路径等生成字段仍按新 Workspace 正确重建。
- 失败、并发和重试行为继续遵守现有 revision、原子交换和幂等协议。
- 新建 Workspace 的默认值行为不改变。
