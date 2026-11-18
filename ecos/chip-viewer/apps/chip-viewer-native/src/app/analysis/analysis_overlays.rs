use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;

use chipgeom_format::Rect32;

use super::{json_i32, json_i64, json_string_vec, json_string_vec_or_single, json_usize};

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct DrcTypeState {
    pub(super) name: String,
    pub(super) total_count: usize,
    pub(super) layer_counts: BTreeMap<String, usize>,
    pub(super) visible: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct DrcViolation {
    pub(super) id: usize,
    pub(super) drc_type: String,
    pub(super) layer: String,
    pub(super) bbox: Rect32,
    pub(super) required_size: Option<i64>,
    pub(super) nets: Vec<String>,
    pub(super) insts: Vec<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(super) struct DrcTypeCounts {
    pub(super) total_count: usize,
    pub(super) layer_counts: BTreeMap<String, usize>,
}

pub(super) struct DrcViolationRTreeNode {
    bbox: rstar::AABB<[i32; 2]>,
    pub(super) index: usize,
}

impl rstar::RTreeObject for DrcViolationRTreeNode {
    type Envelope = rstar::AABB<[i32; 2]>;

    fn envelope(&self) -> Self::Envelope {
        self.bbox
    }
}

pub(super) struct DrcOverlay {
    pub(super) data_path: Option<PathBuf>,
    pub(super) statis_path: Option<PathBuf>,
    pub(super) type_states: Vec<DrcTypeState>,
    pub(super) violations: Vec<DrcViolation>,
    pub(super) rtree: rstar::RTree<DrcViolationRTreeNode>,
    pub(super) load_error: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct AntennaTypeState {
    pub(super) name: String,
    pub(super) total_count: usize,
    pub(super) layer_counts: BTreeMap<String, usize>,
    pub(super) visible: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct AntennaViolation {
    pub(super) id: usize,
    pub(super) antenna_type: String,
    pub(super) layer: String,
    pub(super) bbox: Rect32,
    pub(super) required_size: Option<i64>,
    pub(super) nets: Vec<String>,
    pub(super) insts: Vec<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(super) struct AntennaTypeCounts {
    pub(super) total_count: usize,
    pub(super) layer_counts: BTreeMap<String, usize>,
}

pub(super) struct AntennaViolationRTreeNode {
    bbox: rstar::AABB<[i32; 2]>,
    pub(super) index: usize,
}

impl rstar::RTreeObject for AntennaViolationRTreeNode {
    type Envelope = rstar::AABB<[i32; 2]>;

    fn envelope(&self) -> Self::Envelope {
        self.bbox
    }
}

pub(super) struct AntennaOverlay {
    pub(super) data_path: Option<PathBuf>,
    pub(super) statis_path: Option<PathBuf>,
    pub(super) type_states: Vec<AntennaTypeState>,
    pub(super) violations: Vec<AntennaViolation>,
    pub(super) rtree: rstar::RTree<AntennaViolationRTreeNode>,
    pub(super) load_error: Option<String>,
}

impl DrcOverlay {
    pub(super) fn load(data_path: Option<PathBuf>, statis_path: Option<PathBuf>) -> Option<Self> {
        if data_path.is_none() && statis_path.is_none() {
            return None;
        }

        let mut load_error = None;
        let mut violations = Vec::new();
        let mut counts = BTreeMap::new();

        if let Some(path) = data_path.as_deref() {
            match fs::read_to_string(path)
                .map_err(|err| err.to_string())
                .and_then(|text| parse_drc_json_text(&text))
            {
                Ok((json_violations, json_counts)) => {
                    violations = json_violations;
                    counts = json_counts;
                }
                Err(err) => {
                    load_error = Some(format!("failed to load DRC data {}: {err}", path.display()));
                }
            }
        }

        if let Some(path) = statis_path.as_deref() {
            match fs::read_to_string(path)
                .map_err(|err| err.to_string())
                .map(|text| parse_drc_statis_csv(&text))
            {
                Ok(csv_counts) => merge_drc_counts(&mut counts, csv_counts),
                Err(err) => {
                    let message =
                        format!("failed to load DRC statistics {}: {err}", path.display());
                    load_error = Some(match load_error {
                        Some(existing) => format!("{existing}; {message}"),
                        None => message,
                    });
                }
            }
        }

        merge_drc_counts(&mut counts, drc_counts_from_violations(&violations));
        let type_states = drc_type_states_from_counts(counts);

        let rtree_nodes: Vec<_> = violations
            .iter()
            .enumerate()
            .map(|(i, v)| DrcViolationRTreeNode {
                bbox: rstar::AABB::from_corners([v.bbox.lx, v.bbox.ly], [v.bbox.hx, v.bbox.hy]),
                index: i,
            })
            .collect();
        let rtree = rstar::RTree::bulk_load(rtree_nodes);

        Some(Self {
            data_path,
            statis_path,
            type_states,
            violations,
            rtree,
            load_error,
        })
    }

    pub(super) fn total_count(&self) -> usize {
        self.type_states.iter().map(|state| state.total_count).sum()
    }

    pub(super) fn selected_type_count(&self) -> usize {
        self.type_states
            .iter()
            .filter(|state| state.visible)
            .count()
    }

    pub(super) fn set_all_visible(&mut self, visible: bool) {
        for state in &mut self.type_states {
            state.visible = visible;
        }
    }
}

pub(super) fn parse_drc_json_text(
    text: &str,
) -> Result<(Vec<DrcViolation>, BTreeMap<String, DrcTypeCounts>), String> {
    let root: serde_json::Value = serde_json::from_str(text).map_err(|err| err.to_string())?;
    let distribution = root
        .get("drc")
        .and_then(|node| node.get("distribution"))
        .and_then(|node| node.as_object())
        .ok_or_else(|| "expected an object at drc.distribution".to_string())?;

    let mut violations = Vec::new();
    let mut counts = BTreeMap::new();
    for (drc_type, type_node) in distribution {
        let mut type_counts = DrcTypeCounts {
            total_count: json_usize(type_node.get("number")).unwrap_or(0),
            layer_counts: BTreeMap::new(),
        };
        if let Some(layers) = type_node.get("layers").and_then(|node| node.as_object()) {
            for (layer, layer_node) in layers {
                let layer_count = json_usize(layer_node.get("number")).unwrap_or(0);
                if layer_count > 0 {
                    type_counts.layer_counts.insert(layer.clone(), layer_count);
                }
                if let Some(list) = layer_node.get("list").and_then(|node| node.as_array()) {
                    for item in list {
                        if let Some(violation) =
                            parse_drc_violation(item, violations.len(), drc_type, layer)
                        {
                            violations.push(violation);
                        }
                    }
                }
            }
        }
        if type_counts.total_count == 0 {
            type_counts.total_count = type_counts.layer_counts.values().sum();
        }
        counts.insert(drc_type.clone(), type_counts);
    }

    Ok((violations, counts))
}

fn parse_drc_violation(
    node: &serde_json::Value,
    id: usize,
    drc_type: &str,
    layer: &str,
) -> Option<DrcViolation> {
    let llx = json_i32(node.get("llx"))?;
    let lly = json_i32(node.get("lly"))?;
    let urx = json_i32(node.get("urx"))?;
    let ury = json_i32(node.get("ury"))?;
    Some(DrcViolation {
        id,
        drc_type: drc_type.to_string(),
        layer: layer.to_ascii_lowercase(),
        bbox: Rect32 {
            lx: llx.min(urx),
            ly: lly.min(ury),
            hx: llx.max(urx),
            hy: lly.max(ury),
        },
        required_size: json_i64(node.get("required_size")),
        nets: json_string_vec(node.get("net")),
        insts: json_string_vec(node.get("inst")),
    })
}

pub(super) fn parse_drc_statis_csv(text: &str) -> BTreeMap<String, DrcTypeCounts> {
    let mut lines = text.lines().filter(|line| !line.trim().is_empty());
    let Some(header_line) = lines.next() else {
        return BTreeMap::new();
    };
    let headers = split_simple_csv_line(header_line);
    if headers.is_empty() {
        return BTreeMap::new();
    }

    let mut counts = BTreeMap::new();
    for line in lines {
        let fields = split_simple_csv_line(line);
        if fields.is_empty() {
            continue;
        }
        let drc_type = fields[0].trim();
        if drc_type.is_empty() || drc_type.eq_ignore_ascii_case("total") {
            continue;
        }
        let mut type_counts = DrcTypeCounts::default();
        for (index, header) in headers.iter().enumerate().skip(1) {
            let value = fields
                .get(index)
                .and_then(|field| field.trim().parse::<usize>().ok())
                .unwrap_or(0);
            if header.eq_ignore_ascii_case("total") {
                type_counts.total_count = value;
            } else if value > 0 {
                type_counts.layer_counts.insert(header.clone(), value);
            }
        }
        if type_counts.total_count == 0 {
            type_counts.total_count = type_counts.layer_counts.values().sum();
        }
        counts.insert(drc_type.to_string(), type_counts);
    }
    counts
}

fn split_simple_csv_line(line: &str) -> Vec<String> {
    line.split(',')
        .map(|field| field.trim().trim_matches('"').to_string())
        .collect()
}

fn merge_drc_counts(
    target: &mut BTreeMap<String, DrcTypeCounts>,
    source: BTreeMap<String, DrcTypeCounts>,
) {
    for (drc_type, source_counts) in source {
        let target_counts = target.entry(drc_type).or_default();
        if target_counts.total_count == 0 {
            target_counts.total_count = source_counts.total_count;
        }
        for (layer, count) in source_counts.layer_counts {
            target_counts.layer_counts.entry(layer).or_insert(count);
        }
    }
}

fn drc_counts_from_violations(violations: &[DrcViolation]) -> BTreeMap<String, DrcTypeCounts> {
    let mut counts = BTreeMap::<String, DrcTypeCounts>::new();
    for violation in violations {
        let type_counts = counts.entry(violation.drc_type.clone()).or_default();
        type_counts.total_count += 1;
        *type_counts
            .layer_counts
            .entry(violation.layer.clone())
            .or_insert(0) += 1;
    }
    counts
}

fn drc_type_states_from_counts(counts: BTreeMap<String, DrcTypeCounts>) -> Vec<DrcTypeState> {
    counts
        .into_iter()
        .filter(|(_, counts)| counts.total_count > 0 || !counts.layer_counts.is_empty())
        .map(|(name, counts)| DrcTypeState {
            name,
            total_count: counts.total_count,
            layer_counts: counts.layer_counts,
            visible: true,
        })
        .collect()
}

impl AntennaOverlay {
    pub(super) fn load(data_path: Option<PathBuf>, statis_path: Option<PathBuf>) -> Option<Self> {
        if data_path.is_none() && statis_path.is_none() {
            return None;
        }

        let mut load_error = None;
        let mut violations = Vec::new();
        let mut counts = BTreeMap::new();

        if let Some(path) = data_path.as_deref() {
            match fs::read_to_string(path)
                .map_err(|err| err.to_string())
                .and_then(|text| parse_antenna_json_text(&text))
            {
                Ok((json_violations, json_counts)) => {
                    violations = json_violations;
                    counts = json_counts;
                }
                Err(err) => {
                    load_error = Some(format!(
                        "failed to load Antenna data {}: {err}",
                        path.display()
                    ));
                }
            }
        }

        if let Some(path) = statis_path.as_deref() {
            match fs::read_to_string(path)
                .map_err(|err| err.to_string())
                .map(|text| parse_antenna_statis_csv(&text))
            {
                Ok(csv_counts) => merge_antenna_counts(&mut counts, csv_counts),
                Err(err) => {
                    let message = format!(
                        "failed to load Antenna statistics {}: {err}",
                        path.display()
                    );
                    load_error = Some(match load_error {
                        Some(existing) => format!("{existing}; {message}"),
                        None => message,
                    });
                }
            }
        }

        merge_antenna_counts(&mut counts, antenna_counts_from_violations(&violations));
        let type_states = antenna_type_states_from_counts(counts);

        let rtree_nodes: Vec<_> = violations
            .iter()
            .enumerate()
            .map(|(i, v)| AntennaViolationRTreeNode {
                bbox: rstar::AABB::from_corners([v.bbox.lx, v.bbox.ly], [v.bbox.hx, v.bbox.hy]),
                index: i,
            })
            .collect();
        let rtree = rstar::RTree::bulk_load(rtree_nodes);

        Some(Self {
            data_path,
            statis_path,
            type_states,
            violations,
            rtree,
            load_error,
        })
    }

    pub(super) fn total_count(&self) -> usize {
        self.type_states.iter().map(|state| state.total_count).sum()
    }

    pub(super) fn selected_type_count(&self) -> usize {
        self.type_states
            .iter()
            .filter(|state| state.visible)
            .count()
    }

    pub(super) fn set_all_visible(&mut self, visible: bool) {
        for state in &mut self.type_states {
            state.visible = visible;
        }
    }
}

pub(super) fn parse_antenna_json_text(
    text: &str,
) -> Result<(Vec<AntennaViolation>, BTreeMap<String, AntennaTypeCounts>), String> {
    let root: serde_json::Value = serde_json::from_str(text).map_err(|err| err.to_string())?;
    let mut violations = Vec::new();
    let mut counts = BTreeMap::new();

    let distribution = root
        .get("antenna")
        .and_then(|antenna| antenna.get("distribution"))
        .and_then(|node| node.as_object());
    let ecc_violations = root.get("violations").and_then(|node| node.as_array());

    if root
        .get("antenna")
        .and_then(|antenna| antenna.get("distribution"))
        .is_some()
        && distribution.is_none()
    {
        return Err("expected an object at antenna.distribution".into());
    }
    if distribution.is_none() && ecc_violations.is_none() {
        return Err("expected an object at antenna.distribution or an array at violations".into());
    }

    if let Some(distribution) = distribution {
        for (antenna_type, type_node) in distribution {
            let mut type_counts = AntennaTypeCounts {
                total_count: json_usize(type_node.get("number")).unwrap_or(0),
                layer_counts: BTreeMap::new(),
            };
            if let Some(layers) = type_node.get("layers").and_then(|node| node.as_object()) {
                for (layer, layer_node) in layers {
                    let layer_count = json_usize(layer_node.get("number")).unwrap_or(0);
                    if layer_count > 0 {
                        type_counts.layer_counts.insert(layer.clone(), layer_count);
                    }
                    if let Some(list) = layer_node.get("list").and_then(|node| node.as_array()) {
                        for item in list {
                            if let Some(violation) =
                                parse_antenna_violation(item, violations.len(), antenna_type, layer)
                            {
                                violations.push(violation);
                            }
                        }
                    }
                }
            }
            if type_counts.total_count == 0 {
                type_counts.total_count = type_counts.layer_counts.values().sum();
            }
            counts.insert(antenna_type.clone(), type_counts);
        }
    }

    if let Some(items) = ecc_violations {
        for item in items {
            let antenna_type = item
                .get("type")
                .and_then(|value| value.as_str())
                .unwrap_or("Unknown");
            let layer = item
                .get("layer")
                .and_then(|value| value.as_str())
                .unwrap_or("unknown");
            if let Some(violation) =
                parse_antenna_violation(item, violations.len(), antenna_type, layer)
            {
                violations.push(violation);
            }
        }
    }

    merge_antenna_counts(&mut counts, antenna_counts_from_violations(&violations));
    Ok((violations, counts))
}

fn parse_antenna_violation(
    node: &serde_json::Value,
    id: usize,
    antenna_type: &str,
    layer: &str,
) -> Option<AntennaViolation> {
    let location = node.get("location").unwrap_or(node);
    let llx = json_i32(location.get("lx").or_else(|| node.get("llx")))?;
    let lly = json_i32(location.get("ly").or_else(|| node.get("lly")))?;
    let urx = json_i32(location.get("hx").or_else(|| node.get("urx")))?;
    let ury = json_i32(location.get("hy").or_else(|| node.get("ury")))?;
    Some(AntennaViolation {
        id,
        antenna_type: antenna_type.to_string(),
        layer: layer.to_ascii_lowercase(),
        bbox: Rect32 {
            lx: llx.min(urx),
            ly: lly.min(ury),
            hx: llx.max(urx),
            hy: lly.max(ury),
        },
        required_size: json_i64(node.get("required_size")),
        nets: json_string_vec_or_single(node.get("net")),
        insts: json_string_vec_or_single(node.get("inst").or_else(|| node.get("instance"))),
    })
}

fn parse_antenna_statis_csv(text: &str) -> BTreeMap<String, AntennaTypeCounts> {
    let mut lines = text.lines().filter(|line| !line.trim().is_empty());
    let Some(header_line) = lines.next() else {
        return BTreeMap::new();
    };
    let headers = split_simple_csv_line(header_line);
    if headers.is_empty() {
        return BTreeMap::new();
    }

    let mut counts = BTreeMap::new();
    for line in lines {
        let fields = split_simple_csv_line(line);
        if fields.is_empty() {
            continue;
        }
        let antenna_type = fields[0].trim();
        if antenna_type.is_empty() || antenna_type.eq_ignore_ascii_case("total") {
            continue;
        }
        let mut type_counts = AntennaTypeCounts::default();
        for (index, header) in headers.iter().enumerate().skip(1) {
            let value = fields
                .get(index)
                .and_then(|field| field.trim().parse::<usize>().ok())
                .unwrap_or(0);
            if header.eq_ignore_ascii_case("total") {
                type_counts.total_count = value;
            } else if value > 0 {
                type_counts.layer_counts.insert(header.clone(), value);
            }
        }
        if type_counts.total_count == 0 {
            type_counts.total_count = type_counts.layer_counts.values().sum();
        }
        counts.insert(antenna_type.to_string(), type_counts);
    }
    counts
}

fn merge_antenna_counts(
    target: &mut BTreeMap<String, AntennaTypeCounts>,
    source: BTreeMap<String, AntennaTypeCounts>,
) {
    for (antenna_type, source_counts) in source {
        let target_counts = target.entry(antenna_type).or_default();
        if target_counts.total_count == 0 {
            target_counts.total_count = source_counts.total_count;
        }
        for (layer, count) in source_counts.layer_counts {
            target_counts.layer_counts.entry(layer).or_insert(count);
        }
    }
}

fn antenna_counts_from_violations(
    violations: &[AntennaViolation],
) -> BTreeMap<String, AntennaTypeCounts> {
    let mut counts = BTreeMap::<String, AntennaTypeCounts>::new();
    for violation in violations {
        let type_counts = counts.entry(violation.antenna_type.clone()).or_default();
        type_counts.total_count += 1;
        *type_counts
            .layer_counts
            .entry(violation.layer.clone())
            .or_insert(0) += 1;
    }
    counts
}

fn antenna_type_states_from_counts(
    counts: BTreeMap<String, AntennaTypeCounts>,
) -> Vec<AntennaTypeState> {
    counts
        .into_iter()
        .filter(|(_, counts)| counts.total_count > 0 || !counts.layer_counts.is_empty())
        .map(|(name, counts)| AntennaTypeState {
            name,
            total_count: counts.total_count,
            layer_counts: counts.layer_counts,
            visible: true,
        })
        .collect()
}
