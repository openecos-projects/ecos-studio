from ecos_agent.optimization.experiments.rerun_scheduler import (
    adopt_lane_cap,
    dispatch_cap,
    eligible_cell,
)


def sample(**updates):
    return dict(sample_monotonic=100, cpu_utilization=.2, normalized_host_load=.2,
                memory_available_gib=900, nfs_free_gib=10000, iowait=0, **updates)


def test_monitoring_policy_stops_dispatch_at_full_saturation():
    """Amendment 02: expand under 95%, hold to 100%, stop only at saturation."""
    normal = sample()
    assert dispatch_cap(normal, stable_low_samples=0, minimum_free_gib=100, clock=110) == 4
    assert dispatch_cap(normal, stable_low_samples=3, minimum_free_gib=100, clock=110) == 6
    for key in ('cpu_utilization', 'normalized_host_load'):
        for pressure in (.75, .9, .99):
            assert dispatch_cap({**normal, key: pressure}, stable_low_samples=3, minimum_free_gib=100, clock=110) > 0
        assert dispatch_cap({**normal, key: 1.0}, stable_low_samples=3, minimum_free_gib=100, clock=110) == 0
        assert dispatch_cap({**normal, key: 1.2}, stable_low_samples=3, minimum_free_gib=100, clock=110) == 0
    assert dispatch_cap(normal, stable_low_samples=3, minimum_free_gib=100, clock=116) == 0
    assert dispatch_cap({**normal, 'memory_available_gib': 300}, stable_low_samples=3, minimum_free_gib=100, clock=110) == 2
    assert dispatch_cap(normal, stable_low_samples=3, minimum_free_gib=11000, clock=110) == 0


def test_formal_expansion_tier_widens_to_twelve_lanes():
    """Amendment 05: formal expands to 12; hold tier and guards stay conservative."""
    normal = sample()
    assert dispatch_cap(normal, stable_low_samples=3, minimum_free_gib=100,
                        clock=110, top=12) == 12
    assert dispatch_cap(normal, stable_low_samples=0, minimum_free_gib=100,
                        clock=110, top=12) == 4
    assert dispatch_cap({**normal, 'memory_available_gib': 300}, stable_low_samples=3,
                        minimum_free_gib=100, clock=110, top=12) == 2
    assert dispatch_cap({**normal, 'cpu_utilization': 1.0}, stable_low_samples=3,
                        minimum_free_gib=100, clock=110, top=12) == 0


def rows_for(queue):
    rows = []
    for design, count in queue:
        for index in range(1, count + 1):
            rows.append(dict(logical_episode_id=f'{design}{index}', design=design,
                             design_queue_position=index))
    return rows


def test_rolling_queue_skips_capped_design_without_reordering_its_own_cells():
    rows = rows_for([('a', 2), ('b', 1)])
    state = {r['logical_episode_id']: {'status': 'registered'} for r in rows}
    # 'a' sits at its pair cap, so the lane goes to 'b'.
    assert eligible_cell(rows, state, {'a': 2}, ['a', 'b'], 2, 6)['logical_episode_id'] == 'b1'
    state['a1']['status'] = 'terminated'
    state['b1']['status'] = 'running'
    # A freed 'a' lane admits the next 'a' cell in frozen queue order.
    assert eligible_cell(rows, state, {'a': 1}, ['a', 'b'], 2, 6)['logical_episode_id'] == 'a2'
    state['a2']['status'] = 'quarantined'
    assert eligible_cell(rows, state, {'b': 1}, ['a', 'b'], 2, 6) is None


def test_same_design_pair_is_allowed_but_third_waits_for_other_designs():
    """Amendment 05: two concurrent cells of one design; a third must wait
    while another design still holds registered cells."""
    rows = rows_for([('a', 3), ('b', 1)])
    state = {r['logical_episode_id']: {'status': 'registered'} for r in rows}
    # The priority head fills first; a second same-design cell forms the pair.
    assert eligible_cell(rows, state, {}, ['a', 'b'], 2, 6)['logical_episode_id'] == 'a1'
    state['a1']['status'] = 'running'
    assert eligible_cell(rows, state, {'a': 1}, ['a', 'b'], 2, 6)['logical_episode_id'] == 'a2'
    state['a2']['status'] = 'running'
    assert eligible_cell(rows, state, {'a': 2}, ['a', 'b'], 2, 6)['logical_episode_id'] == 'b1'
    # Tail exception: once 'b' has no work left anywhere (its last cell may
    # still be running), design 'a' may rise toward the effective lane count.
    state['b1']['status'] = 'running'
    assert eligible_cell(rows, state, {'a': 2}, ['a', 'b'], 2, 6)['logical_episode_id'] == 'a3'
    assert eligible_cell(rows, state, {'a': 6}, ['a', 'b'], 2, 6) is None


def test_tail_exception_requires_other_designs_to_be_idle_not_just_unregistered():
    """Regression (2026-10-01 i2c breach): active episodes elsewhere count as
    remaining work — the pair cap must hold while another design still runs."""
    rows = rows_for([('a', 3), ('b', 1)])
    state = {r['logical_episode_id']: {'status': 'registered'} for r in rows}
    state['a1']['status'] = state['a2']['status'] = 'running'
    state['b1']['status'] = 'running'
    # 'b' has no registered cells but its episode is active: no tail yet.
    assert eligible_cell(rows, state, {'a': 2, 'b': 1}, ['a', 'b'], 2, 6) is None
    state['b1']['status'] = 'terminated'
    assert eligible_cell(rows, state, {'a': 2}, ['a', 'b'], 2, 6)['logical_episode_id'] == 'a3'


def test_lane_cap_is_adopted_from_the_state_file_with_safe_defaults(tmp_path):
    state_path = tmp_path / 'formal-state.json'
    assert adopt_lane_cap(state_path, {}, 'formal') == 6
    assert adopt_lane_cap(state_path, dict(lane_cap=9), 'smoke') == 9
    state_path.write_text('{"lane_cap": 12}')
    assert adopt_lane_cap(state_path, {}, 'formal') == 12
    state_path.write_text('{"lane_cap": 0}')
    assert adopt_lane_cap(state_path, {}, 'formal') == 6
    state_path.write_text('not json')
    assert adopt_lane_cap(state_path, {}, 'formal') == 6


def test_missing_or_nonfinite_resource_sample_cannot_admit():
    for key in ('cpu_utilization', 'normalized_host_load', 'sample_monotonic'):
        assert dispatch_cap({**sample(), key: float('nan')}, stable_low_samples=3,
                            minimum_free_gib=100, clock=110) == 0
