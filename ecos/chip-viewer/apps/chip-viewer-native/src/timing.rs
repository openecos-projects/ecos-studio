use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

use serde::Deserialize;

const MAX_TIMING_FILES: usize = 128;
const MAX_TIMING_PATHS_PER_FILE: usize = 1024;
const MAX_TIMING_STAGES: usize = 4096;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TimingAnalysisType {
    Setup,
    Hold,
}

impl TimingAnalysisType {
    pub fn label(self) -> &'static str {
        match self {
            Self::Setup => "setup",
            Self::Hold => "hold",
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct TimingStage {
    pub kind: String,
    pub pin: String,
    pub instance: String,
    pub cell: String,
    pub delay_ns: Option<f64>,
    pub arrival_ns: Option<f64>,
    pub transition: String,
}

impl TimingStage {
    pub fn local_pin_name(&self) -> &str {
        self.pin
            .rsplit_once(':')
            .map_or(self.pin.as_str(), |(_, pin_name)| pin_name)
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct TimingPath {
    pub path_id: String,
    pub corner: String,
    pub analysis_type: TimingAnalysisType,
    pub path_group: String,
    pub start_point: String,
    pub end_point: String,
    pub launch_clock: String,
    pub capture_clock: String,
    pub check_type: String,
    pub slack_ns: f64,
    pub arrival_ns: Option<f64>,
    pub required_ns: Option<f64>,
    pub cppr_ns: Option<f64>,
    pub launch_clock_network_delay_ns: Option<f64>,
    pub capture_clock_network_delay_ns: Option<f64>,
    pub launch_clock_virtual: bool,
    pub launch_clock_source_pin: Option<String>,
    pub launch_clock_endpoint_pin: Option<String>,
    pub launch_clock_path: Option<Vec<TimingStage>>,
    pub capture_clock_virtual: bool,
    pub capture_clock_source_pin: Option<String>,
    pub capture_clock_endpoint_pin: Option<String>,
    pub capture_clock_path: Option<Vec<TimingStage>>,
    pub stages: Vec<TimingStage>,
    pub source_file: PathBuf,
}

impl TimingPath {
    pub fn display_id(&self) -> String {
        format!("{}:{}", self.corner, self.path_id)
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct TimingCorner {
    pub name: String,
    pub violation_count: usize,
    pub setup_count: usize,
    pub hold_count: usize,
    pub worst_slack_ns: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct TimingAnalysis {
    pub feature_dir: PathBuf,
    pub corners: Vec<TimingCorner>,
    pub paths: Vec<TimingPath>,
    pub load_errors: Vec<String>,
    pub load_error: Option<String>,
}

impl TimingAnalysis {
    pub fn load(feature_dir: &Path) -> Self {
        let mut analysis = Self {
            feature_dir: feature_dir.to_path_buf(),
            corners: Vec::new(),
            paths: Vec::new(),
            load_errors: Vec::new(),
            load_error: None,
        };
        let files = discover_timing_files(feature_dir);
        if files.is_empty() {
            analysis.load_error = Some(format!(
                "No STA timing_paths.json files found under {}",
                feature_dir.display()
            ));
            return analysis;
        }

        let mut seen_path_ids = BTreeSet::new();
        for path in files {
            match read_timing_file(&path) {
                Ok(mut paths) => {
                    for timing_path in &mut paths {
                        let key = timing_path.display_id();
                        if !seen_path_ids.insert(key) {
                            analysis.load_errors.push(format!(
                                "Skipped duplicate timing path id in {}",
                                path.display()
                            ));
                            continue;
                        }
                        analysis.paths.push(timing_path.clone());
                    }
                }
                Err(error) => analysis
                    .load_errors
                    .push(format!("{}: {error}", path.display())),
            }
        }

        analysis.paths.sort_by(|left, right| {
            left.slack_ns
                .total_cmp(&right.slack_ns)
                .then_with(|| left.corner.cmp(&right.corner))
                .then_with(|| left.analysis_type.label().cmp(right.analysis_type.label()))
                .then_with(|| left.path_id.cmp(&right.path_id))
        });
        analysis.corners = summarize_corners(&analysis.paths);
        if analysis.paths.is_empty() && analysis.load_error.is_none() {
            analysis.load_error = Some(if analysis.load_errors.is_empty() {
                "No timing violations in STA feature data".to_string()
            } else {
                format!(
                    "No usable STA timing data: {}",
                    analysis.load_errors.first().cloned().unwrap_or_default()
                )
            });
        }
        analysis
    }

    pub fn paths_for(&self, corner: &str, analysis_type: Option<TimingAnalysisType>) -> Vec<usize> {
        self.paths
            .iter()
            .enumerate()
            .filter(|(_, path)| {
                path.corner == corner && analysis_type.is_none_or(|kind| path.analysis_type == kind)
            })
            .map(|(index, _)| index)
            .collect()
    }
}

fn summarize_corners(paths: &[TimingPath]) -> Vec<TimingCorner> {
    let mut corners = BTreeMap::<String, TimingCorner>::new();
    for path in paths {
        let corner = corners
            .entry(path.corner.clone())
            .or_insert_with(|| TimingCorner {
                name: path.corner.clone(),
                violation_count: 0,
                setup_count: 0,
                hold_count: 0,
                worst_slack_ns: path.slack_ns,
            });
        corner.violation_count += 1;
        corner.worst_slack_ns = corner.worst_slack_ns.min(path.slack_ns);
        match path.analysis_type {
            TimingAnalysisType::Setup => corner.setup_count += 1,
            TimingAnalysisType::Hold => corner.hold_count += 1,
        }
    }
    corners.into_values().collect()
}

fn discover_timing_files(feature_dir: &Path) -> Vec<PathBuf> {
    let mut files = BTreeSet::new();
    if !feature_dir.is_dir() {
        return Vec::new();
    }
    let push_if_file = |directory: &Path, files: &mut BTreeSet<PathBuf>| {
        let candidate = directory.join("timing_paths.json");
        if candidate.is_file() {
            files.insert(candidate);
        }
    };
    push_if_file(feature_dir, &mut files);
    let Ok(entries) = fs::read_dir(feature_dir) else {
        return Vec::new();
    };
    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if !file_type.is_dir() {
            continue;
        }
        let directory = entry.path();
        push_if_file(&directory, &mut files);
        let Ok(children) = fs::read_dir(&directory) else {
            continue;
        };
        for child in children.flatten() {
            if child.file_type().is_ok_and(|file_type| file_type.is_dir()) {
                push_if_file(&child.path(), &mut files);
            }
        }
    }
    files.into_iter().take(MAX_TIMING_FILES).collect()
}

fn read_timing_file(path: &Path) -> Result<Vec<TimingPath>, String> {
    let text = fs::read_to_string(path).map_err(|error| error.to_string())?;
    parse_timing_file_text(path, &text)
}

fn parse_timing_file_text(path: &Path, text: &str) -> Result<Vec<TimingPath>, String> {
    let file: RawTimingFile =
        serde_json::from_str(text).map_err(|error| format!("invalid JSON: {error}"))?;
    if file.schema_version != 1 {
        return Err(format!(
            "unsupported timing schema_version {}",
            file.schema_version
        ));
    }
    if file.corner.trim().is_empty() {
        return Err("timing corner is empty".to_string());
    }
    if file.paths.len() > MAX_TIMING_PATHS_PER_FILE {
        return Err(format!(
            "timing file contains {} paths (limit {MAX_TIMING_PATHS_PER_FILE})",
            file.paths.len()
        ));
    }

    let mut paths = Vec::new();
    let mut path_ids = BTreeSet::new();
    for raw_path in file.paths {
        let path = raw_path.into_timing_path(path, &file.corner)?;
        if !path_ids.insert(path.path_id.clone()) {
            return Err(format!("duplicate path_id {}", path.path_id));
        }
        if path.slack_ns < 0.0 {
            paths.push(path);
        }
    }
    Ok(paths)
}

#[derive(Debug, Deserialize)]
struct RawTimingFile {
    schema_version: u32,
    corner: String,
    paths: Vec<RawTimingPath>,
}

#[derive(Debug, Deserialize)]
struct RawTimingPath {
    path_id: String,
    analysis_type: String,
    path_group: String,
    start_point: String,
    end_point: String,
    #[serde(default)]
    launch_clock: String,
    #[serde(default)]
    capture_clock: String,
    #[serde(default)]
    check_type: String,
    slack_ns: f64,
    #[serde(default)]
    arrival_ns: Option<f64>,
    #[serde(default)]
    required_ns: Option<f64>,
    #[serde(default)]
    cppr_ns: Option<f64>,
    #[serde(default)]
    launch_clock_network_delay_ns: Option<f64>,
    #[serde(default)]
    capture_clock_network_delay_ns: Option<f64>,
    #[serde(default)]
    launch_clock_virtual: bool,
    #[serde(default)]
    launch_clock_source_pin: Option<String>,
    #[serde(default)]
    launch_clock_endpoint_pin: Option<String>,
    #[serde(default)]
    launch_clock_path: Option<Vec<RawTimingStage>>,
    #[serde(default)]
    capture_clock_virtual: bool,
    #[serde(default)]
    capture_clock_source_pin: Option<String>,
    #[serde(default)]
    capture_clock_endpoint_pin: Option<String>,
    #[serde(default)]
    capture_clock_path: Option<Vec<RawTimingStage>>,
    stages: Vec<RawTimingStage>,
}

impl RawTimingPath {
    fn into_timing_path(self, source_file: &Path, corner: &str) -> Result<TimingPath, String> {
        let analysis_type = match self.analysis_type.as_str() {
            "setup" => TimingAnalysisType::Setup,
            "hold" => TimingAnalysisType::Hold,
            other => return Err(format!("unsupported analysis_type {other:?}")),
        };
        if self.path_id.trim().is_empty()
            || self.path_group.trim().is_empty()
            || self.start_point.trim().is_empty()
            || self.end_point.trim().is_empty()
            || self.launch_clock.trim().is_empty()
            || self.capture_clock.trim().is_empty()
            || self.check_type.trim().is_empty()
        {
            return Err(format!("path {} has an empty required field", self.path_id));
        }
        for (label, value) in [
            ("slack_ns", Some(self.slack_ns)),
            ("arrival_ns", self.arrival_ns),
            ("required_ns", self.required_ns),
            ("cppr_ns", self.cppr_ns),
            (
                "launch_clock_network_delay_ns",
                self.launch_clock_network_delay_ns,
            ),
            (
                "capture_clock_network_delay_ns",
                self.capture_clock_network_delay_ns,
            ),
        ] {
            if value.is_some_and(|value| !value.is_finite()) {
                return Err(format!("path {} has non-finite {label}", self.path_id));
            }
        }
        if self.stages.len() > MAX_TIMING_STAGES
            || self
                .launch_clock_path
                .as_ref()
                .is_some_and(|path| path.len() > MAX_TIMING_STAGES)
            || self
                .capture_clock_path
                .as_ref()
                .is_some_and(|path| path.len() > MAX_TIMING_STAGES)
        {
            return Err(format!(
                "path {} contains too many stages (limit {MAX_TIMING_STAGES})",
                self.path_id
            ));
        }
        let mut stages = Vec::with_capacity(self.stages.len());
        for raw_stage in self.stages {
            stages.push(raw_stage.into_timing_stage(&self.path_id)?);
        }
        let path_id = self.path_id.clone();
        let launch_clock_path = self
            .launch_clock_path
            .map(|clock_path| {
                clock_path
                    .into_iter()
                    .map(|stage| stage.into_timing_stage(&path_id))
                    .collect::<Result<Vec<_>, _>>()
            })
            .transpose()?;
        let capture_clock_path = self
            .capture_clock_path
            .map(|clock_path| {
                clock_path
                    .into_iter()
                    .map(|stage| stage.into_timing_stage(&path_id))
                    .collect::<Result<Vec<_>, _>>()
            })
            .transpose()?;
        Ok(TimingPath {
            path_id: self.path_id,
            corner: corner.to_string(),
            analysis_type,
            path_group: self.path_group,
            start_point: self.start_point,
            end_point: self.end_point,
            launch_clock: self.launch_clock,
            capture_clock: self.capture_clock,
            check_type: self.check_type,
            slack_ns: self.slack_ns,
            arrival_ns: self.arrival_ns,
            required_ns: self.required_ns,
            cppr_ns: self.cppr_ns,
            launch_clock_network_delay_ns: self.launch_clock_network_delay_ns,
            capture_clock_network_delay_ns: self.capture_clock_network_delay_ns,
            launch_clock_virtual: self.launch_clock_virtual,
            launch_clock_source_pin: self
                .launch_clock_source_pin
                .filter(|pin| !pin.trim().is_empty()),
            launch_clock_endpoint_pin: self
                .launch_clock_endpoint_pin
                .filter(|pin| !pin.trim().is_empty()),
            launch_clock_path,
            capture_clock_virtual: self.capture_clock_virtual,
            capture_clock_source_pin: self
                .capture_clock_source_pin
                .filter(|pin| !pin.trim().is_empty()),
            capture_clock_endpoint_pin: self
                .capture_clock_endpoint_pin
                .filter(|pin| !pin.trim().is_empty()),
            capture_clock_path,
            stages,
            source_file: source_file.to_path_buf(),
        })
    }
}

#[derive(Debug, Deserialize)]
struct RawTimingStage {
    #[serde(default)]
    kind: String,
    pin: String,
    #[serde(default)]
    instance: String,
    cell: String,
    #[serde(default)]
    incremental_delay_ns: Option<f64>,
    #[serde(default)]
    arrival_ns: Option<f64>,
    #[serde(default)]
    transition: String,
}

impl RawTimingStage {
    fn into_timing_stage(self, path_id: &str) -> Result<TimingStage, String> {
        let is_port_point =
            self.kind.eq_ignore_ascii_case("point") && self.instance.trim().is_empty();
        if self.pin.trim().is_empty() || (!is_port_point && self.cell.trim().is_empty()) {
            return Err(format!(
                "path {path_id} has a stage with an empty pin or cell"
            ));
        }
        for (label, value) in [
            ("incremental_delay_ns", self.incremental_delay_ns),
            ("arrival_ns", self.arrival_ns),
        ] {
            if value.is_some_and(|value| !value.is_finite()) {
                return Err(format!("path {path_id} has non-finite stage {label}"));
            }
        }
        Ok(TimingStage {
            kind: self.kind,
            pin: self.pin,
            instance: self.instance,
            cell: self.cell,
            delay_ns: self.incremental_delay_ns,
            arrival_ns: self.arrival_ns,
            transition: self.transition,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn timing_json(paths: &str) -> String {
        format!(
            r#"{{"schema_version":1,"corner":"MIN_m40/Cworst","path_limit":20,"paths":[{paths}]}}"#
        )
    }

    fn path_json(path_id: &str, analysis_type: &str, slack: f64) -> String {
        format!(
            r#"{{"path_id":"{path_id}","analysis_type":"{analysis_type}","path_group":"clk","start_point":"u0/Q","end_point":"u1/A","launch_clock":"clk","capture_clock":"clk","check_type":"{analysis_type}","slack_ns":{slack},"arrival_ns":2.0,"required_ns":1.0,"cppr_ns":0.0,"launch_clock_network_delay_ns":0.1,"capture_clock_network_delay_ns":0.2,"stages":[{{"kind":"cell_arc","pin":"u0:Q","instance":"u0","cell":"DFF","incremental_delay_ns":0.5,"arrival_ns":0.5,"transition":"rise"}}]}}"#
        )
    }

    #[test]
    fn parser_keeps_only_negative_slack_paths() {
        let json = timing_json(&format!(
            "{},{}",
            path_json("path-a", "setup", -0.2),
            path_json("path-b", "hold", 0.1)
        ));
        let paths = parse_timing_file_text(Path::new("timing_paths.json"), &json).unwrap();
        assert_eq!(paths.len(), 1);
        assert_eq!(paths[0].path_id, "path-a");
        assert_eq!(paths[0].analysis_type, TimingAnalysisType::Setup);
        assert_eq!(paths[0].stages[0].local_pin_name(), "Q");
    }

    #[test]
    fn parser_reads_optional_clock_paths() {
        let json = timing_json(
            r#"{"path_id":"clock-path","analysis_type":"setup","path_group":"clk","start_point":"rom_data_1","end_point":"ff:D","launch_clock":"VCLK_clk","capture_clock":"CLK_clk","check_type":"setup","slack_ns":-0.25,"launch_clock_virtual":true,"launch_clock_path":[],"capture_clock_source_pin":"clk","capture_clock_endpoint_pin":"ff:CK","capture_clock_path":[{"kind":"point","pin":"clk","instance":"","cell":"","transition":"rise"},{"kind":"clock_arc","pin":"ff:CK","instance":"ff","cell":"DFF","transition":"rise"}],"stages":[{"kind":"net_arc","pin":"ff:D","instance":"ff","cell":"DFF","incremental_delay_ns":0.2,"arrival_ns":1.0,"transition":"rise"}]}"#,
        );
        let paths = parse_timing_file_text(Path::new("timing_paths.json"), &json).unwrap();
        assert!(paths[0].launch_clock_virtual);
        assert_eq!(paths[0].launch_clock_path.as_deref(), Some(&[][..]));
        assert_eq!(paths[0].capture_clock_source_pin.as_deref(), Some("clk"));
        assert_eq!(
            paths[0].capture_clock_endpoint_pin.as_deref(),
            Some("ff:CK")
        );
        assert_eq!(paths[0].capture_clock_path.as_ref().unwrap().len(), 2);
    }

    #[test]
    fn parser_keeps_legacy_clock_fields_optional() {
        let paths = parse_timing_file_text(
            Path::new("timing_paths.json"),
            &timing_json(&path_json("legacy", "setup", -0.2)),
        )
        .unwrap();
        assert_eq!(paths[0].launch_clock_path, None);
        assert_eq!(paths[0].capture_clock_path, None);
    }

    #[test]
    fn parser_rejects_non_finite_stage_delay() {
        let json = timing_json(
            r#"{"path_id":"bad","analysis_type":"setup","path_group":"clk","start_point":"u0/Q","end_point":"u1/A","launch_clock":"clk","capture_clock":"clk","check_type":"setup","slack_ns":-0.2,"stages":[{"kind":"cell_arc","pin":"u0:Q","instance":"u0","cell":"DFF","incremental_delay_ns":1e999,"arrival_ns":0.5,"transition":"rise"}]}"#,
        );
        assert!(parse_timing_file_text(Path::new("timing_paths.json"), &json).is_err());
    }

    #[test]
    fn parser_accepts_port_point_without_cell() {
        let json = timing_json(
            r#"{"path_id":"port-path","analysis_type":"setup","path_group":"clk","start_point":"rom_data_1","end_point":"u1/A","launch_clock":"clk","capture_clock":"clk","check_type":"setup","slack_ns":-0.2,"stages":[{"kind":"point","pin":"rom_data_1","instance":"","cell":"","incremental_delay_ns":0.0,"arrival_ns":6.0,"transition":"rise"}]}"#,
        );
        let paths = parse_timing_file_text(Path::new("timing_paths.json"), &json).unwrap();
        assert_eq!(paths.len(), 1);
        assert_eq!(paths[0].stages[0].pin, "rom_data_1");
        assert!(paths[0].stages[0].cell.is_empty());
    }

    #[test]
    fn corners_are_summarized_from_kept_paths() {
        let paths = vec![
            parse_timing_file_text(
                Path::new("a.json"),
                &timing_json(&format!(
                    "{},{}",
                    path_json("setup-a", "setup", -0.4),
                    path_json("hold-a", "hold", -0.1)
                )),
            )
            .unwrap(),
            parse_timing_file_text(
                Path::new("b.json"),
                &timing_json(&path_json("setup-b", "setup", -0.8)),
            )
            .unwrap(),
        ]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>();
        let corners = summarize_corners(&paths);
        assert_eq!(corners.len(), 1);
        assert_eq!(corners[0].violation_count, 3);
        assert_eq!(corners[0].setup_count, 2);
        assert_eq!(corners[0].hold_count, 1);
        assert_eq!(corners[0].worst_slack_ns, -0.8);
    }

    #[test]
    fn discovery_reads_two_feature_levels() {
        let root = std::env::temp_dir().join(format!(
            "chip-viewer-timing-discovery-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        let nested = root.join("MIN_m40").join("Cworst");
        fs::create_dir_all(&nested).unwrap();
        fs::write(nested.join("timing_paths.json"), "{}").unwrap();
        let files = discover_timing_files(&root);
        assert_eq!(files, vec![nested.join("timing_paths.json")]);
        fs::remove_dir_all(root).unwrap();
    }
}
