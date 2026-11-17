//! Attempt-bound frozen logs; all file I/O stays off the render thread.
use crate::replay::data::{read, within, Recording};
use anyhow::{ensure, Result};
use egui::Color32;
use serde::Deserialize;
use std::{path::Path, sync::mpsc};

const MAX_BYTES: u64 = 64 * 1024 * 1024;
#[derive(Deserialize)]
struct Index {
    schema: String,
    path: String,
    time_basis: String,
    #[serde(default)]
    truncated: bool,
    observations: Vec<Observation>,
}
#[derive(Deserialize)]
struct Observation {
    elapsed_ns: u64,
    end_byte: u64,
}
struct Line {
    time: u64,
    text: String,
    key: bool,
    color: Color32,
}
struct Log {
    lines: Vec<Line>,
    key_indices: Vec<usize>,
    synced: bool,
    note: String,
}

pub struct ReplayLog {
    receiver: Option<mpsc::Receiver<Result<Log, String>>>,
    data: Option<Log>,
    error: String,
    all: bool,
    follow: bool,
    scroll: crate::replay::log_scroll::LogScroll,
}
impl Default for ReplayLog {
    fn default() -> Self {
        Self {
            receiver: None,
            data: None,
            error: String::new(),
            all: false,
            follow: true,
            scroll: Default::default(),
        }
    }
}
impl ReplayLog {
    pub fn open(workspace: &Path, manifest: &Path) -> Self {
        let (sender, receiver) = mpsc::channel();
        let workspace = workspace.to_owned();
        let manifest = manifest.to_owned();
        std::thread::spawn(move || {
            let result = (|| {
                let record = Recording::open(&workspace, &manifest)?;
                let data = load(&workspace, &record)?;
                record.check_current()?;
                Ok(data)
            })()
            .map_err(|e: anyhow::Error| e.to_string());
            let _ = sender.send(result);
        });
        Self {
            receiver: Some(receiver),
            ..Self::default()
        }
    }
    pub fn show(
        &mut self,
        ui: &mut egui::Ui,
        step: &str,
        time: u64,
        complete: bool,
        analysis_open: &mut bool,
    ) {
        if let Some(receiver) = &self.receiver {
            if let Ok(result) = receiver.try_recv() {
                match result {
                    Ok(log) => self.data = Some(log),
                    Err(e) => self.error = e,
                }
                self.receiver = None;
            } else {
                ui.ctx()
                    .request_repaint_after(std::time::Duration::from_millis(100));
            }
        }
        let mut filter_changed = false;
        let mut latest = false;
        ui.horizontal(|ui| {
            ui.label(
                egui::RichText::new(format!("{step} · LOG"))
                    .strong()
                    .color(Color32::from_rgb(116, 221, 211)),
            );
            if let Some(data) = &self.data {
                ui.weak(if data.synced {
                    "Follows captured progress"
                } else {
                    "Log browsing · not synchronized"
                })
                .on_hover_text(&data.note);
            }
            filter_changed = ui.toggle_value(&mut self.all, "All lines").changed();
            ui.toggle_value(
                &mut self.follow,
                if self.data.as_ref().is_some_and(|d| d.synced) {
                    "Follow playback"
                } else {
                    "Auto-scroll"
                },
            );
            latest = ui.small_button("Latest").clicked();
            if ui.small_button("Analysis / metrics").clicked() {
                *analysis_open = !*analysis_open;
            }
        });
        let Some(data) = &self.data else {
            ui.weak(if self.receiver.is_some() {
                "Loading step log…"
            } else if self.error.is_empty() {
                "No step log recorded"
            } else {
                &self.error
            });
            return;
        };
        // Binary search before filtering: a seek never reveals future output.
        let end = if complete || !data.synced {
            data.lines.len()
        } else {
            data.lines.partition_point(|l| l.time <= time)
        };
        let count = if self.all {
            end
        } else {
            data.key_indices.partition_point(|index| *index < end)
        };
        if filter_changed {
            self.scroll.reset();
        }
        let row = 14.0 + ui.spacing().item_spacing.y;
        let height = 44.0;
        let maximum = (count as f32 * row - height).max(0.0);
        if latest {
            self.scroll.offset = maximum;
        }
        // Disable following before applying wheel/drag input, including scrollbar drags.
        let bounds =
            egui::Rect::from_min_size(ui.cursor().min, egui::vec2(ui.available_width(), height));
        let manual = ui.input(|i| {
            i.pointer.hover_pos().is_some_and(|p| bounds.contains(p))
                && (i.raw_scroll_delta.y != 0.0 || i.pointer.primary_down())
        });
        if manual {
            self.follow = false;
        }
        let before = self.scroll.offset;
        let offset = self.scroll.advance(
            count,
            row,
            height,
            ui.input(|i| i.stable_dt),
            data.synced,
            self.follow,
        );
        let scroll = egui::ScrollArea::vertical()
            .id_salt("replay_log_lines")
            .min_scrolled_height(0.0)
            .max_height(height)
            .auto_shrink([false, false]);
        let scroll = if self.follow || filter_changed || latest {
            scroll.vertical_scroll_offset(offset)
        } else {
            scroll
        };
        let area = scroll.show_rows(ui, 14.0, count, |ui, range| {
            for i in range {
                let line = &data.lines[if self.all { i } else { data.key_indices[i] }];
                ui.add(
                    egui::Label::new(
                        egui::RichText::new(&line.text)
                            .monospace()
                            .size(11.0)
                            .color(line.color),
                    )
                    .truncate(),
                );
            }
        });
        self.scroll.offset = area.state.offset.y;
        if self.follow && (self.scroll.offset < maximum || (before - offset).abs() > 0.1) {
            ui.ctx().request_repaint();
        }
        if count == 0 {
            ui.weak("No log lines at this captured position");
        }
    }
}
fn load(workspace: &Path, record: &Recording) -> Result<Log> {
    if let Some(index) = &record.manifest.log_index {
        let index: Index = read(&record.asset(index)?)?;
        ensure!(
            index.schema == "ecos.replay.log.v1" && index.time_basis == "observed_monotonic",
            "Unsupported Replay log index"
        );
        let path = record.asset(&index.path)?;
        let bytes = bounded_read(&path)?;
        validate(&index.observations, bytes.len() as u64)?;
        let mut log = parse(&bytes, &index.observations, true);
        log.note =
            "Times indicate observation of flushed tool output; tool buffering can delay lines."
                .into();
        if index.truncated {
            log.note
                .push_str(" Capture capped at 64 MiB; later output is omitted.");
        }
        return Ok(log);
    }
    // Legacy data is explicitly browsable, never assigned invented timestamps.
    let step = record
        .current_pointer()
        .ancestors()
        .nth(4)
        .ok_or_else(|| anyhow::anyhow!("No legacy log directory"))?;
    let directory = within(workspace, &step.join("log"))?;
    let mut candidates = Vec::new();
    for entry in directory.read_dir()? {
        let path = entry?.path();
        if path.extension().is_some_and(|x| x == "log") {
            candidates.push(within(workspace, &path)?);
        }
    }
    let primary = candidates.iter().find(|path| {
        path.file_stem().is_some_and(|name| {
            name.to_string_lossy()
                .eq_ignore_ascii_case(&record.manifest.step)
        })
    });
    let source = primary
        .or_else(|| (candidates.len() == 1).then(|| &candidates[0]))
        .ok_or_else(|| {
            anyhow::anyhow!("No primary step log available for this legacy recording")
        })?;
    let bytes = bounded_read(source)?;
    let mut log = parse(&bytes, &[], false);
    log.note =
        "Existing step log has no Replay timing index. Browse only; not synchronized to geometry."
            .into();
    Ok(log)
}
fn bounded_read(path: &Path) -> Result<Vec<u8>> {
    use std::io::Read;
    let mut bytes = Vec::new();
    std::fs::File::open(path)?
        .take(MAX_BYTES + 1)
        .read_to_end(&mut bytes)?;
    ensure!(
        bytes.len() as u64 <= MAX_BYTES,
        "Log exceeds 64 MiB; open the original log externally"
    );
    Ok(bytes)
}
fn validate(observations: &[Observation], size: u64) -> Result<()> {
    let mut previous = (0, 0);
    for o in observations {
        ensure!(
            o.elapsed_ns >= previous.0 && o.end_byte > previous.1 && o.end_byte <= size,
            "Invalid Replay log offsets or timestamps"
        );
        previous = (o.elapsed_ns, o.end_byte);
    }
    ensure!(
        previous.1 == size,
        "Replay log index does not cover frozen output"
    );
    Ok(())
}
fn parse(bytes: &[u8], observations: &[Observation], synced: bool) -> Log {
    let mut offset = 0;
    let mut lines = Vec::new();
    for raw in bytes.split_inclusive(|b| *b == b'\n') {
        offset += raw.len() as u64;
        let index = observations.partition_point(|o| o.end_byte < offset);
        let time = observations.get(index).map_or(0, |o| o.elapsed_ns);
        let text = clean(&String::from_utf8_lossy(raw));
        if text.trim().is_empty() {
            continue;
        }
        let lower = text.to_ascii_lowercase();
        let warn = lower.contains("warn");
        let error = lower.contains("error") || lower.contains("fatal");
        let key = warn
            || error
            || [
                "iteration",
                "overflow",
                "wns",
                "tns",
                "hpwl",
                "slack",
                "complete",
                "success",
                "summary",
                "start",
                "finish",
                "elapsed",
                "power",
                "violation",
                "wirelength",
                "converg",
            ]
            .iter()
            .any(|k| lower.contains(k));
        let color = if error {
            Color32::from_rgb(245, 120, 120)
        } else if warn {
            Color32::from_rgb(238, 196, 118)
        } else {
            Color32::from_rgb(179, 198, 211)
        };
        lines.push(Line {
            time,
            text,
            key,
            color,
        });
    }
    let key_indices = lines
        .iter()
        .enumerate()
        .filter_map(|(i, l)| l.key.then_some(i))
        .collect();
    Log {
        key_indices,
        lines,
        synced,
        note: String::new(),
    }
}
fn clean(text: &str) -> String {
    let mut out = String::new();
    let mut escape = false;
    for c in text.chars().take(4096) {
        if c == '\x1b' {
            escape = true;
            continue;
        }
        if escape {
            if c.is_ascii_alphabetic() {
                escape = false;
            }
            continue;
        }
        if c == '\t' {
            out.push(' ');
        } else if !c.is_control() {
            out.push(c);
        }
    }
    out
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn lines_wait_for_complete_bytes_and_seek_does_not_leak_future_lines() {
        let data = b"first\niteration 30\nfinal\n";
        let observations = vec![
            Observation {
                elapsed_ns: 10,
                end_byte: 9,
            },
            Observation {
                elapsed_ns: 20,
                end_byte: data.len() as u64,
            },
        ];
        validate(&observations, data.len() as u64).unwrap();
        let log = parse(data, &observations, true);
        assert_eq!(
            log.lines.iter().map(|l| l.time).collect::<Vec<_>>(),
            [10, 20, 20]
        );
        assert_eq!(log.lines.partition_point(|l| l.time <= 15), 1);
        assert_eq!(log.lines.partition_point(|l| l.time <= 5), 0);
        assert!(log.lines[1].key);
        assert!(validate(&observations, 3).is_err());
    }
    #[test]
    fn reads_attempt_bound_log_and_rejects_escaping_assets() {
        let fixture = crate::replay::data::tests::Fixture::new();
        let manifest_path = fixture.0.join("attempts/a/manifest.json");
        let mut manifest: serde_json::Value = read(&manifest_path).unwrap();
        manifest["log_index"] = serde_json::json!("logs/index.json");
        fixture.write("attempts/a/manifest.json", manifest);
        std::fs::create_dir_all(fixture.0.join("attempts/a/logs")).unwrap();
        std::fs::write(
            fixture.0.join("attempts/a/logs/step.log"),
            b"iteration 30\n",
        )
        .unwrap();
        fixture.write("attempts/a/logs/index.json",serde_json::json!({"schema":"ecos.replay.log.v1","path":"logs/step.log","time_basis":"observed_monotonic","observations":[{"elapsed_ns":12,"end_byte":13}]}));
        let record = fixture.open();
        let log = load(&fixture.0, &record).unwrap();
        assert!(log.synced);
        assert_eq!(log.lines[0].text, "iteration 30");
        assert_eq!(log.lines[0].time, 12);
        fixture.write("attempts/a/logs/index.json",serde_json::json!({"schema":"ecos.replay.log.v1","path":"../../../outside.log","time_basis":"observed_monotonic","observations":[]}));
        assert!(load(&fixture.0, &record).is_err());
    }

    #[test]
    fn ansi_and_control_sequences_do_not_leak_into_layout() {
        assert_eq!(clean("\x1b[31mWARN\x1b[0m\r\n"), "WARN");
    }
}
