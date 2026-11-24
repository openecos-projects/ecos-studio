use super::*;

pub(super) struct PresentTrace(Option<Trace>);

struct Trace {
    output: PathBuf,
    started: Instant,
    previous: Instant,
    phases: Vec<(&'static str, f64)>,
}

impl PresentTrace {
    pub(super) fn enabled() -> Self {
        Self(
            std::env::var_os("ECOS_RENDER_PRESENT_TRACE")
                .filter(|path| !path.is_empty())
                .map(|output| Trace::new(output.into())),
        )
    }

    pub(super) fn mark(&mut self, phase: &'static str) {
        if let Some(trace) = &mut self.0 {
            trace.mark(phase);
        }
    }

    pub(super) fn record(self, result: &Result<bool, String>) {
        if let Some(trace) = self.0 {
            if let Err(error) = trace.record(result) {
                eprintln!("Presentation diagnostic unavailable: {error}");
            }
        }
    }
}

impl Trace {
    fn new(output: PathBuf) -> Self {
        let started = Instant::now();
        Self {
            output,
            started,
            previous: started,
            phases: Vec::new(),
        }
    }

    fn mark(&mut self, phase: &'static str) {
        let now = Instant::now();
        self.phases
            .push((phase, (now - self.previous).as_secs_f64() * 1000.0));
        self.previous = now;
    }

    fn record(self, result: &Result<bool, String>) -> Result<(), Box<dyn std::error::Error>> {
        let record = serde_json::json!({
            "wall_ms": self.started.elapsed().as_secs_f64() * 1000.0,
            "phases_ms": self.phases,
            "new_scene_completed": matches!(result, Ok(true)),
            "failed": result.is_err(),
        });
        let mut output = OpenOptions::new()
            .create(true)
            .append(true)
            .open(self.output)?;
        serde_json::to_writer(&mut output, &record)?;
        writeln!(output)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn presentation_trace_keeps_phase_order_and_explicit_completion() {
        let directory = crate::app::tests::temp_snapshot_dir("present-trace");
        let path = directory.join("present.jsonl");
        let mut trace = PresentTrace(Some(Trace::new(path.clone())));
        trace.mark("allocation");
        trace.mark("upload");
        trace.record(&Ok(true));
        let record: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap();
        assert_eq!(record["new_scene_completed"], true);
        assert_eq!(record["failed"], false);
        assert_eq!(
            record["phases_ms"]
                .as_array()
                .unwrap()
                .iter()
                .map(|phase| phase[0].as_str().unwrap())
                .collect::<Vec<_>>(),
            vec!["allocation", "upload"]
        );
        assert!(record["wall_ms"].as_f64().unwrap() >= 0.0);
        fs::remove_dir_all(directory).unwrap();
    }
}
