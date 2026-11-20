use super::*;

pub(super) fn macro_feedback_is_warning(message: &str) -> bool {
    let message = message.to_ascii_lowercase();
    [
        "rejected",
        "failed",
        "error",
        "unplaced",
        "cancelled",
        "stale",
        "changed",
        "unknown",
        "not configured",
        "missing",
        "unsupported",
        "forbids",
        "requires",
        "overlap",
        "wait for",
        "unavailable",
        "outside",
    ]
    .iter()
    .any(|needle| message.contains(needle))
}

pub(super) enum SessionActionProgressPoll {
    Waiting,
    Updated(SessionActionProgress),
    TimedOut,
}

pub(super) fn read_session_action_progress(
    action: SessionActionKind,
    command_id: u64,
    progress_path: &Path,
    elapsed: Duration,
) -> SessionActionProgressPoll {
    let progress = fs::read_to_string(progress_path)
        .ok()
        .and_then(|content| serde_json::from_str::<SessionActionProgress>(&content).ok());
    if let Some(progress) = progress {
        if progress.action == action && progress.command_id == command_id && progress.percent <= 100
        {
            return SessionActionProgressPoll::Updated(progress);
        }
    }
    if session_action_queue_timed_out(elapsed) {
        SessionActionProgressPoll::TimedOut
    } else {
        SessionActionProgressPoll::Waiting
    }
}

pub(super) fn session_action_queue_timed_out(elapsed: Duration) -> bool {
    elapsed >= SESSION_ACTION_QUEUE_TIMEOUT
}

pub(super) fn session_action_progress_title(
    action: SessionActionKind,
    phase: SessionActionProgressPhase,
) -> &'static str {
    match (action, phase) {
        (SessionActionKind::Save, SessionActionProgressPhase::Completed) => "Layout saved",
        (SessionActionKind::Discard, SessionActionProgressPhase::Completed) => "Edits discarded",
        (SessionActionKind::Save, SessionActionProgressPhase::Failed) => "Save failed",
        (SessionActionKind::Discard, SessionActionProgressPhase::Failed) => "Discard failed",
        (SessionActionKind::Save, _) => "Saving layout",
        (SessionActionKind::Discard, _) => "Discarding layout edits",
    }
}

impl eframe::App for ChipViewerApp {
    fn on_exit(&mut self, gl: Option<&eframe::glow::Context>) {
        if let ViewerState::Loaded(loaded) = &self.state {
            if let Some(gl) = gl {
                loaded.heatmap_composition.destroy(gl);
            }
            loaded.cpu_scene_cache.destroy_glow();
        }
    }

    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        let update_started = Instant::now();
        if !self.theme_initialized {
            apply_ecos_theme(ctx);
            self.theme_initialized = true;
        }
        if !self.startup_focus_requested {
            ctx.send_viewport_cmd(egui::ViewportCommand::Focus);
            self.startup_focus_requested = true;
        }
        self.poll_loading();
        let close_requested = ctx.input(|input| input.viewport().close_requested());
        let mut close_after_session_action = false;
        if let ViewerState::Loaded(loaded) = &mut self.state {
            loaded.glow_rendering = _frame.gl().is_some();
            if loaded.glow_renderer.is_none() {
                loaded.glow_renderer = _frame.gl().map(|gl| unsafe {
                    use eframe::glow::HasContext;
                    gl.get_parameter_string(eframe::glow::RENDERER)
                });
            }
            loaded.previous_native_cpu_ms = _frame.info().cpu_usage.unwrap_or_default() * 1000.0;
            loaded.poll_analysis(ctx);
            loaded.poll_edit_result();
            loaded.poll_session_action_progress();
            close_after_session_action = loaded.poll_session_action_result();
            if loaded.poll_reload() {
                close_after_session_action = true;
            }
            loaded.poll_search(ctx);
            loaded.poll_external_snapshot_refresh();
            if close_requested && loaded.should_intercept_unsaved_close() {
                loaded.close_confirmation_visible = true;
                ctx.send_viewport_cmd(egui::ViewportCommand::CancelClose);
            }
            if env_flag_requested(std::env::var(PERF_BENCHMARK_ENV).ok().as_deref()) {
                ctx.request_repaint_after(Duration::from_millis(16));
            } else if let Some(interval) = edit_poll_repaint_interval(
                loaded.pending_edit.is_some()
                    || loaded.pending_session_action.is_some()
                    || loaded.pending_reload.is_some(),
            ) {
                ctx.request_repaint_after(interval);
            } else {
                ctx.request_repaint_after(SNAPSHOT_REFRESH_CHECK_INTERVAL);
            }
        } else if matches!(self.state, ViewerState::Loading(_)) {
            ctx.request_repaint_after(Duration::from_millis(50));
        }
        if let Some(duration_ms) = std::env::var(PERF_BENCHMARK_MS_ENV)
            .ok()
            .and_then(|value| value.parse::<u64>().ok())
            .map(Duration::from_millis)
        {
            if self.benchmark_started_at.elapsed() >= duration_ms {
                ctx.send_viewport_cmd(egui::ViewportCommand::Close);
            }
        }
        if let ViewerState::Loaded(loaded) = &mut self.state {
            if loaded.macro_staging.is_some() {
                egui::SidePanel::left("chip_viewer_macro_tools")
                    .resizable(true)
                    .min_width(268.0)
                    .max_width(520.0)
                    .default_width(292.0)
                    .frame(egui::Frame::side_top_panel(&ctx.style()).fill(ecos_panel()))
                    .show(ctx, |ui| loaded.macro_toolbar(ui));
            }
            if loaded.macro_staging.is_none() && loaded.has_analysis_panel() {
                egui::SidePanel::left("chip_viewer_analysis")
                    .resizable(true)
                    .min_width(240.0)
                    .max_width(380.0)
                    .default_width(292.0)
                    .show(ctx, |ui| loaded.analysis_sidebar(ui));
            }
        }
        egui::SidePanel::right("chip_viewer_operations")
            .resizable(true)
            .min_width(280.0)
            .max_width(460.0)
            .default_width(320.0)
            .show(ctx, |ui| self.sidebar(ui));
        if let ViewerState::Loaded(loaded) = &mut self.state {
            if loaded.analysis_tab == AnalysisTab::Timing && loaded.has_selected_timing_path() {
                egui::TopBottomPanel::bottom("chip_viewer_timing_timeline")
                    .resizable(true)
                    .min_height(170.0)
                    .max_height(420.0)
                    .default_height(260.0)
                    .frame(egui::Frame::side_top_panel(&ctx.style()).fill(ecos_panel()))
                    .show(ctx, |ui| loaded.timing_timeline(ui));
            }
            loaded.show_clock_tree_graph(ctx);
        }
        let central_panel = match &self.state {
            ViewerState::Loaded(loaded) if loaded.glow_rendering => {
                egui::CentralPanel::default().frame(loaded.cpu_scene_cache.central_frame(ctx))
            }
            _ => egui::CentralPanel::default(),
        };
        central_panel.show(ctx, |ui| {
            self.canvas(ui);
        });
        if let ViewerState::Loaded(loaded) = &mut self.state {
            loaded.show_close_confirmation(ctx);
            loaded.show_session_action_progress(ctx);
            loaded.show_shortcuts_overlay(ctx);
        }
        if close_after_session_action {
            ctx.send_viewport_cmd(egui::ViewportCommand::Close);
        } else if let ViewerState::Loaded(loaded) = &self.state {
            if loaded.close_without_session_action {
                ctx.send_viewport_cmd(egui::ViewportCommand::Close);
            }
        }
        if let ViewerState::Loaded(loaded) = &mut self.state {
            loaded.previous_ui_update_ms = update_started.elapsed().as_secs_f32() * 1000.0;
        }
    }
}
