use super::*;
use crate::app::cpu_scene::{builder, tests::Fixture};
use std::sync::atomic::AtomicUsize;
use std::sync::mpsc;

fn source(fixture: &Fixture) -> Arc<CpuScene> {
    let request = fixture.request(1.0, 1.0);
    let mut scene = builder::build_command_stream(&request, &|| true, |_| true).unwrap();
    assert!(scene.retained.is_some());
    scene.bitmap = Some(vec![0; 640 * 480 * 4].into());
    Arc::new(scene)
}

fn request(fixture: &Fixture, scene: &Arc<CpuScene>, generation: u64) -> Request {
    let mut key = scene.key().clone();
    key.pan.x += generation as f32;
    Request {
        key,
        generation,
        scene: Arc::clone(scene),
        cpu_style: true,
        repaint: fixture.request(1.0, 1.0).repaint,
    }
}

fn prepared(request: Request) -> Prepared {
    Prepared {
        key: request.key,
        source: request.scene.key().clone(),
        generation: request.generation,
        bitmap: Vec::new(),
        repairs: Vec::new(),
        textures: Arc::clone(&request.scene.pattern_textures),
        pixels: 0,
        duration: Duration::ZERO,
    }
}

fn until(mut condition: impl FnMut() -> bool) {
    let started = Instant::now();
    while !condition() {
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "retained worker timed out"
        );
        thread::sleep(Duration::from_millis(1));
    }
}

#[test]
fn coalesces_pending_cameras_and_rejects_a_late_result_without_blocking_submit() {
    let fixture = Fixture::new();
    let scene = source(&fixture);
    let (entered, started) = mpsc::channel();
    let (release, waiting) = mpsc::channel();
    let processed = Arc::new(Mutex::new(Vec::new()));
    let log = Arc::clone(&processed);
    let mut worker = RetainedWorker::spawn(move |request, is_current| {
        log.lock().unwrap().push(request.generation);
        if request.generation == 1 {
            entered.send(()).unwrap();
            waiting.recv_timeout(Duration::from_secs(5)).unwrap();
            assert!(!is_current());
            // Deliberately return an obsolete result: the mailbox must reject it.
        }
        Some(prepared(request))
    });
    assert!(worker.request(request(&fixture, &scene, 1)).is_none());
    started.recv_timeout(Duration::from_secs(5)).unwrap();
    assert!(worker.request(request(&fixture, &scene, 2)).is_none());
    assert!(worker.request(request(&fixture, &scene, 3)).is_none());
    release.send(()).unwrap();
    let mut accepted = None;
    until(|| {
        accepted = worker.request(request(&fixture, &scene, 3));
        accepted.is_some()
    });
    assert_eq!(accepted.unwrap().generation, 3);
    assert_eq!(*processed.lock().unwrap(), [1, 3]);
    for _ in 0..20 {
        assert!(worker.request(request(&fixture, &scene, 3)).is_none());
    }
    assert_eq!(*processed.lock().unwrap(), [1, 3]);
}

#[test]
fn failed_attempts_are_cached_but_a_new_generation_or_source_is_retried() {
    let fixture = Fixture::new();
    let scene = source(&fixture);
    let calls = Arc::new(AtomicUsize::new(0));
    let count = Arc::clone(&calls);
    let mut worker = RetainedWorker::spawn(move |_, _| {
        count.fetch_add(1, Ordering::Relaxed);
        None
    });
    worker.request(request(&fixture, &scene, 1));
    until(|| worker.finished());
    assert!(worker.failed());
    for _ in 0..20 {
        assert!(worker.request(request(&fixture, &scene, 1)).is_none());
    }
    assert_eq!(calls.load(Ordering::Relaxed), 1);
    let mut next = request(&fixture, &scene, 1);
    next.generation = 2;
    worker.request(next);
    until(|| worker.finished());
    assert_eq!(calls.load(Ordering::Relaxed), 2);
    let replacement = source(&fixture);
    let mut next = request(&fixture, &replacement, 1);
    next.generation = 2;
    worker.request(next);
    until(|| worker.finished());
    assert_eq!(calls.load(Ordering::Relaxed), 3);
}

#[test]
fn cancelling_an_active_attempt_discards_its_result_and_can_accept_a_later_camera() {
    let fixture = Fixture::new();
    let scene = source(&fixture);
    let (entered, started) = mpsc::channel();
    let (release, waiting) = mpsc::channel();
    let mut worker = RetainedWorker::spawn(move |request, is_current| {
        if request.generation == 1 {
            entered.send(()).unwrap();
            waiting.recv_timeout(Duration::from_secs(5)).unwrap();
            assert!(!is_current());
        }
        Some(prepared(request))
    });
    worker.request(request(&fixture, &scene, 1));
    started.recv_timeout(Duration::from_secs(5)).unwrap();
    worker.cancel();
    worker.request(request(&fixture, &scene, 2));
    release.send(()).unwrap();
    let mut accepted = None;
    until(|| {
        accepted = worker.request(request(&fixture, &scene, 2));
        accepted.is_some()
    });
    assert_eq!(accepted.unwrap().generation, 2);
}

#[test]
fn real_cpu_preparation_matches_the_synchronous_model_without_a_gl_context() {
    let fixture = Fixture::new();
    let scene = source(&fixture);
    let input = request(&fixture, &scene, 4);
    let key = input.key.clone();
    let model = scene.retained.as_ref().unwrap();
    let regions = model.validate(&key, 1).unwrap();
    let expected = model
        .compose(&key, &regions, scene.bitmap.as_ref().unwrap())
        .unwrap();
    let pixels = regions.pixel_count();
    let mut worker = RetainedWorker::default();
    worker.request(input);
    let mut accepted = None;
    until(|| {
        accepted = worker.request(request(&fixture, &scene, 4));
        accepted.is_some()
    });
    let accepted = accepted.unwrap();
    assert_eq!(accepted.key, key);
    assert_eq!(accepted.bitmap, expected);
    assert_eq!(accepted.pixels, pixels);
    assert!(Arc::ptr_eq(&accepted.textures, &scene.pattern_textures));
}

#[test]
fn a_ready_background_result_requests_a_ui_repaint() {
    let fixture = Fixture::new();
    let scene = source(&fixture);
    let context = egui::Context::default();
    for _ in 0..3 {
        let _frame = context.run(Default::default(), |_| {});
    }
    let (notify, notified) = mpsc::channel();
    context.set_request_repaint_callback(move |_| {
        let _ = notify.send(());
    });
    let mut input = request(&fixture, &scene, 1);
    input.repaint = context;
    let mut worker = RetainedWorker::spawn(|request, _| Some(prepared(request)));
    worker.request(input);
    notified
        .recv_timeout(Duration::from_secs(5))
        .expect("completed retained work must wake presentation");
    assert!(worker.finished());
}

#[test]
fn dropping_the_worker_does_not_join_an_active_preparation() {
    let fixture = Fixture::new();
    let scene = source(&fixture);
    let (entered, started) = mpsc::channel();
    let (release, waiting) = mpsc::channel();
    let (exited, ended) = mpsc::channel();
    let mut worker = RetainedWorker::spawn(move |request, is_current| {
        entered.send(()).unwrap();
        waiting.recv_timeout(Duration::from_secs(5)).unwrap();
        assert!(!is_current());
        exited.send(()).unwrap();
        Some(prepared(request))
    });
    worker.request(request(&fixture, &scene, 1));
    started.recv_timeout(Duration::from_secs(5)).unwrap();
    drop(worker);
    // A synchronous join would prevent this release and fail the worker above.
    release.send(()).unwrap();
    ended.recv_timeout(Duration::from_secs(5)).unwrap();
}
