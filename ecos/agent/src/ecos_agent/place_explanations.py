"""Source-grounded explanations for ECOS Placement bundle entities."""

from __future__ import annotations


_ZH_EXPLANATIONS = {
    "parameter.dreamplace.target_density": (
        "`target_density` 是 DREAMPlace 全局布局中的目标放置密度，当前 ECOS 默认值为 "
        "`0.8`。全局布局在最小化平滑线长和密度惩罚的连续优化中，用它限定每个 density bin "
        "可容纳的目标单元面积比例；它不是 floorplan utilization。后者先定义芯片/核心的几何面积，"
        "前者是在既定布局区域内约束布局器的密度目标。ECOS 通过 `Target density -> target_density` "
        "映射将该参数传给 DREAMPlace。依据：`ecc/chipcompiler/tools/ecc_dreamplace/"
        "configs/dreamplace.json`、`parameter_overrides.py`、`dreamplace/PlaceObj.py`。"
    ),
    "algorithm.dreamplace.global_placement": (
        "ECOS 的 `place` 调用 `DreamplaceModule.run_placement()`，由 `_run()` 读取 `dreamplace.json`、"
        "构造 `PlacementEngine`、导入 ECOS 数据库后执行 `engine.run()`。当前配置开启全局布局和合法化，"
        "关闭 detailed placement。全局布局由 `NonLinearPlace` 对平滑线长加密度惩罚进行迭代优化；"
        "当前配置使用 weighted-average wirelength 和 Nesterov optimizer。全局布局得到连续位置后，"
        "同一次 `place` 运行会执行合法化；CTS 后 ECOS 还会单独运行 legalization，此时强制关闭"
        "全局布局。依据：`ecc/chipcompiler/tools/ecc_dreamplace/module.py`、"
        "`configs/dreamplace.json`、`dreamplace/Placer.py`、`dreamplace/NonLinearPlace.py`。"
    ),
    "metric.place_rudy_utilization_max": (
        "RUDY 在 DREAMPlace 中先对每条 net 求所有 pin 的 bounding box，再枚举与该框相交的 routing "
        "grid bin。每个 bin 的重叠面积乘以该 net 的 wiring-distribution weight（并乘可选 net weight），"
        "分别除以该 net bounding box 的高度和宽度，累加为 horizontal 与 vertical routing demand。"
        "随后分别以 `bin_area * unit_horizontal_capacity` 和 `bin_area * unit_vertical_capacity` 归一化为"
        " utilization，并取两方向较大者作为该 bin 的 RUDY utilization。ECOS 的 "
        "`place_rudy_utilization_max` 读取 placement map 中 `rudy/max/union` 的峰值；这是布局期拥塞估计，"
        "不是实际布线后的溢出。依据：`dreamplace/ops/rudy/src/rudy.cpp`、"
        "`dreamplace/ops/rudy/rudy.py`、`ecc/chipcompiler/tools/ecc/metrics.py`。"
    ),
}

_EN_EXPLANATIONS = {
    "parameter.dreamplace.target_density": (
        "`target_density` is DREAMPlace's target placement density; the current ECOS default is `0.8`. "
        "During global placement it constrains the target movable-cell area per density bin in the continuous "
        "wirelength-plus-density optimization. It is not floorplan utilization: utilization defines chip/core geometry, "
        "while target density constrains the placer inside that geometry. ECOS maps `Target density` to `target_density`. "
        "Evidence: `configs/dreamplace.json`, `parameter_overrides.py`, and `dreamplace/PlaceObj.py`."
    ),
    "algorithm.dreamplace.global_placement": (
        "ECOS `place` calls `DreamplaceModule.run_placement()`. `_run()` reads `dreamplace.json`, builds a "
        "`PlacementEngine`, imports the ECOS database, and calls `engine.run()`. The current configuration enables "
        "global placement and legalization, and disables detailed placement. `NonLinearPlace` iterates a smooth "
        "wirelength-plus-density objective using weighted-average wirelength and the configured Nesterov optimizer. "
        "The same place run legalizes afterwards; ECOS also has a post-CTS legalization step with global placement forced off. "
        "Evidence: `ecc_dreamplace/module.py`, `configs/dreamplace.json`, `dreamplace/Placer.py`, and `dreamplace/NonLinearPlace.py`."
    ),
    "metric.place_rudy_utilization_max": (
        "DREAMPlace RUDY first computes every net's pin bounding box, then visits each overlapping routing-grid bin. "
        "For each bin, the overlap area times the net wiring-distribution weight (and optional net weight) is divided "
        "by the bounding-box height and width to accumulate horizontal and vertical demand. Those demands are normalized "
        "by `bin_area * unit_horizontal_capacity` and `bin_area * unit_vertical_capacity`; the larger direction is the "
        "bin RUDY utilization. ECOS reads `rudy/max/union` from the placement map as `place_rudy_utilization_max`. "
        "It is a placement-stage congestion estimate, not post-route overflow. Evidence: `dreamplace/ops/rudy/src/rudy.cpp`, "
        "`dreamplace/ops/rudy/rudy.py`, and `ecc/chipcompiler/tools/ecc/metrics.py`."
    ),
}


def explanation_for(entity_id: str, language: str) -> str | None:
    """Return a concise explanation that is traceable to the entity's source evidence."""
    explanations = _ZH_EXPLANATIONS if language == "zh" else _EN_EXPLANATIONS
    return explanations.get(entity_id)
