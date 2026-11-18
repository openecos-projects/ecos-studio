use super::*;

#[test]
fn semantic_policy_separates_power_and_signal_on_the_same_layer() {
    let place = for_phase("place", "optimization", None);
    assert_eq!(
        [
            place.coverage(1, 600.0),
            place.coverage(2, 600.0),
            place.coverage(3, 600.0)
        ],
        [1.0, 0.0, 0.0]
    );
    let route = for_phase("route", "detail_route", Some([400.0, 800.0]));
    assert_eq!(
        [
            route.coverage(2, 600.0),
            route.coverage(3, 600.0),
            route.coverage(2, 1000.0)
        ],
        [1.0, 0.0, 0.0]
    );
    for step in ["sta", "rcx", "power", "antenna", "custom_checker"] {
        assert_eq!(for_phase(step, "analysis", None), Style::default());
    }
}

#[test]
fn power_creation_focuses_the_current_band_without_moving_geometry() {
    let power = for_phase("floorplan", "stripes", Some([1000.0, 1100.0]));
    assert_eq!(
        [
            power.coverage(3, 500.0),
            power.coverage(3, 1050.0),
            power.coverage(3, 1600.0)
        ],
        [0.25, 1.0, 0.0]
    );
    let mut instance = GpuShapeInstance3d::zeroed();
    instance.z0 = 1000.0;
    instance.z1 = 1100.0;
    instance._pad[1] = 3;
    for t in [0.0, 0.2, 0.8, 1.0, 0.2] {
        let transition =
            Transition::between(for_phase("place", "placement", None), Style::default(), t);
        assert_eq!(transition.coverage(&instance), smooth(t));
        assert_eq!([instance.z0, instance.z1], [1000.0, 1100.0]);
    }
}

use bytemuck::Zeroable;
