use super::*;
use crate::app::cpu_raster::{target::RasterTarget, targets::PresentationTargets};
use eframe::glow::{self, HasContext};

#[test]
#[cfg_attr(not(feature = "render-pixel-tests"), ignore)]
fn offscreen_target_survives_cancelled_work_and_clears_before_reuse() {
    let fixture = Fixture::new();
    let Ok(mut renderer) = offscreen::OffscreenRenderer::new("") else {
        eprintln!("EGL cancelled-target check unavailable");
        return;
    };
    let mut request = fixture.request(1.0, 1.0);
    let current = AtomicBool::new(true);
    assert!(renderer
        .build_streaming_updates(
            &request,
            || current.load(Ordering::Relaxed),
            |_, _| current.store(false, Ordering::Relaxed),
            Some([Duration::ZERO; 2]),
        )
        .unwrap()
        .is_none());
    let framebuffer = renderer
        .with_context(|gl| unsafe { gl.get_parameter_framebuffer(glow::FRAMEBUFFER_BINDING) })
        .expect("cancelled stream must retain its target, not delete it");
    request.key.pan = egui::vec2(37.0, -19.0);
    request.key.background = egui::Color32::from_rgba_premultiplied(13, 29, 41, 83);
    let complete = renderer
        .build_streaming_updates(
            &request,
            || true,
            |_, _| panic!("final-only stream published"),
            None,
        )
        .unwrap()
        .unwrap();
    assert_eq!(
        renderer
            .with_context(|gl| unsafe { gl.get_parameter_framebuffer(glow::FRAMEBUFFER_BINDING) }),
        Some(framebuffer)
    );
    let reference = builder::build_with_workers(&request, &|| true, 4).unwrap();
    let expected = renderer
        .rasterize_updates(&reference, &request, || true, |_, _| {}, None)
        .unwrap()
        .unwrap()
        .0;
    assert_eq!(complete.bitmap.as_deref(), Some(expected.as_slice()));
    request.key.screen_size = [721, 503];
    let resized = renderer
        .build_streaming_updates(&request, || true, |_, _| {}, None)
        .unwrap()
        .unwrap();
    let reference = builder::build_with_workers(&request, &|| true, 4).unwrap();
    let expected = renderer
        .rasterize_updates(&reference, &request, || true, |_, _| {}, None)
        .unwrap()
        .unwrap()
        .0;
    assert_eq!(resized.bitmap.as_deref(), Some(expected.as_slice()));
    assert_eq!(expected.len(), 721 * 503 * 4);
}

fn pixels(gl: &glow::Context, size: [u32; 2]) -> Vec<u8> {
    let mut pixels = vec![0; size[0] as usize * size[1] as usize * 4];
    unsafe {
        gl.read_pixels(
            0,
            0,
            size[0] as i32,
            size[1] as i32,
            glow::RGBA,
            glow::UNSIGNED_BYTE,
            glow::PixelPackData::Slice(Some(&mut pixels)),
        );
    }
    pixels
}

#[test]
#[cfg_attr(not(feature = "render-pixel-tests"), ignore)]
fn presentation_target_pool_reuses_one_target_and_fully_replaces_its_contents() {
    let fixture = Fixture::new();
    let mut key = fixture.request(1.0, 1.0).key;
    let Ok(renderer) = offscreen::OffscreenRenderer::new("") else {
        eprintln!("EGL presentation target pool check unavailable");
        return;
    };
    renderer.with_context(|gl| {
        let mut targets = PresentationTargets::default();
        targets.observe(&key);
        assert!(!targets.warm_when_idle(gl, [48, 64]).unwrap());
        thread::sleep(Duration::from_millis(170));
        assert!(targets.warm_when_idle(gl, [48, 64]).unwrap());
        assert!(!targets.warm_when_idle(gl, [48, 64]).unwrap());
        let first = targets.acquire(gl, [48, 64]).unwrap();
        let framebuffer = first.framebuffer;
        first.clear(gl, egui::Color32::BLACK);
        let original: Vec<_> = [13, 29, 41, 83]
            .into_iter()
            .cycle()
            .take(48 * 64 * 4)
            .collect();
        first.upload(gl, &original);
        assert_eq!(pixels(gl, [48, 64]), original);
        targets.retire(gl, first);
        let second = targets.acquire(gl, [48, 64]).unwrap();
        assert_eq!(second.framebuffer, framebuffer);
        key.zoom = 2.0;
        targets.observe(&key);
        assert!(!targets.warm_when_idle(gl, [48, 64]).unwrap());
        unsafe {
            gl.bind_framebuffer(glow::FRAMEBUFFER, Some(second.framebuffer));
        }
        let replacement: Vec<_> = [173, 71, 29, 0]
            .into_iter()
            .cycle()
            .take(48 * 64 * 4)
            .collect();
        second.upload(gl, &replacement);
        assert_eq!(pixels(gl, [48, 64]), replacement);
        targets.retire(gl, second);
        let surplus = RasterTarget::new(gl, [48, 64]).unwrap();
        let surplus_framebuffer = surplus.framebuffer;
        targets.retire(gl, surplus);
        assert!(!unsafe { gl.is_framebuffer(surplus_framebuffer) });
        let resized = targets.acquire(gl, [81, 37]).unwrap();
        assert_eq!(resized.size, [81, 37]);
        resized.clear(gl, egui::Color32::from_rgb(7, 11, 17));
        assert_eq!(pixels(gl, [81, 37]), [7, 11, 17, 255].repeat(81 * 37));
        let resized_framebuffer = resized.framebuffer;
        targets.retire(gl, resized);
        targets.destroy(gl);
        assert!(!unsafe { gl.is_framebuffer(resized_framebuffer) });
        assert_eq!(unsafe { gl.get_error() }, glow::NO_ERROR);
    });
}
