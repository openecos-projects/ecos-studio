from ecos_agent.optimization.experiments.rerun_scheduler import dispatch_cap, eligible_cell


def sample(**updates):
    return dict(sample_monotonic=100, cpu_utilization=.2, normalized_host_load=.2,
                memory_available_gib=900, nfs_free_gib=10000, iowait=0, **updates)


def test_monitoring_policy_stops_dispatch_before_eighty_percent():
    normal = sample()
    assert dispatch_cap(normal, stable_low_samples=0, minimum_free_gib=100, clock=110) == 4
    assert dispatch_cap(normal, stable_low_samples=3, minimum_free_gib=100, clock=110) == 6
    for key in ('cpu_utilization', 'normalized_host_load'):
        for pressure in (.75, .8, .99):
            assert dispatch_cap({**normal, key: pressure}, stable_low_samples=3, minimum_free_gib=100, clock=110) == 0
    assert dispatch_cap(normal, stable_low_samples=3, minimum_free_gib=100, clock=116) == 0
    assert dispatch_cap({**normal, 'memory_available_gib': 300}, stable_low_samples=3, minimum_free_gib=100, clock=110) == 2
    assert dispatch_cap(normal, stable_low_samples=3, minimum_free_gib=11000, clock=110) == 0


def test_rolling_queue_skips_busy_design_without_reordering_its_own_cells():
    rows = [dict(logical_episode_id='a1', design='a', design_queue_position=1),
            dict(logical_episode_id='a2', design='a', design_queue_position=2),
            dict(logical_episode_id='b1', design='b', design_queue_position=1)]
    state = {r['logical_episode_id']: {'status': 'registered'} for r in rows}
    assert eligible_cell(rows, state, {'a'}, ['a', 'b'])['logical_episode_id'] == 'b1'
    state['a1']['status'] = 'terminated'
    assert eligible_cell(rows, state, set(), ['a', 'b'])['logical_episode_id'] == 'a2'
    state['a2']['status'] = 'quarantined'
    assert eligible_cell(rows, state, {'b'}, ['a', 'b']) is None


def test_missing_or_nonfinite_resource_sample_cannot_admit():
    for key in ('cpu_utilization', 'normalized_host_load', 'sample_monotonic'):
        assert dispatch_cap({**sample(), key: float('nan')}, stable_low_samples=3,
                            minimum_free_gib=100, clock=110) == 0
