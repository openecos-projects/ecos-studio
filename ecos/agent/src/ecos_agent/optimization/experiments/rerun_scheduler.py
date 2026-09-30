"""Rolling scheduler for an explicitly frozen, isolated shared-rerun manifest.

The scheduler never retries a cell. A stale running marker is quarantined rather
than treated as permission to rerun. CPU policy is monitoring-only: high host
pressure stops dispatch, not already running native tools.
"""
from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import math
import os
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def write_json(path: Path, value: object) -> None:
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, indent=2, sort_keys=True) + '\n')
    temporary.replace(path)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def cpu_ticks() -> tuple[int, int, int]:
    ticks = list(map(int, Path('/proc/stat').read_text().splitlines()[0].split()[1:9]))
    return sum(ticks), ticks[3], ticks[4]


def resources(root: Path, previous: tuple[int, int, int]) -> tuple[dict[str, Any], tuple[int, int, int]]:
    ticks = cpu_ticks()
    elapsed = ticks[0] - previous[0]
    memory = {line.split(':')[0]: int(line.split()[1]) / 2**20
              for line in Path('/proc/meminfo').read_text().splitlines()
              if line.startswith(('MemAvailable:', 'MemTotal:'))}
    disk = os.statvfs(root)
    host_cpus = os.cpu_count()
    if not host_cpus or elapsed <= 0:
        raise ValueError('CPU sample unavailable; no dispatch')
    return {
        'time': now(), 'sample_monotonic': time.monotonic(),
        'host_cpus': host_cpus, 'affinity_cpus': len(os.sched_getaffinity(0)),
        'cpu_utilization': 1 - ((ticks[1] - previous[1]) + (ticks[2] - previous[2])) / elapsed,
        'iowait': (ticks[2] - previous[2]) / elapsed,
        'normalized_host_load': os.getloadavg()[0] / host_cpus,
        'memory_available_gib': memory['MemAvailable'],
        'nfs_free_gib': disk.f_bavail * disk.f_frsize / 2**30,
        'cpu_policy': 'monitoring_only_no_hard_quota',
    }, ticks


def dispatch_cap(sample: dict[str, Any], *, stable_low_samples: int,
                 minimum_free_gib: float, clock: float) -> int:
    """Admission gating only; never a claim to limit active CPU peaks.

    User amendment 02 (2026-09-30) raises the dispatch line to full machine
    capacity: expand while pressure stays under 95%, hold between 95% and
    100%, and stop new dispatch only at saturation (>=100%). Memory, NFS and
    iowait guards are unchanged.
    """
    values = [sample[k] for k in ('sample_monotonic', 'cpu_utilization',
              'normalized_host_load', 'memory_available_gib', 'nfs_free_gib', 'iowait')]
    if not all(math.isfinite(v) and v >= 0 for v in values):
        return 0
    if clock - sample['sample_monotonic'] > 15 or clock < sample['sample_monotonic']:
        return 0
    pressure = max(sample['cpu_utilization'], sample['normalized_host_load'])
    if pressure >= 1.0 or sample['memory_available_gib'] < 256 or sample['nfs_free_gib'] < minimum_free_gib:
        return 0
    if sample['memory_available_gib'] <= 512 or sample['iowait'] >= .1:
        return 2
    return 6 if pressure < .95 and stable_low_samples >= 3 else 4


def eligible_cell(rows: list[dict[str, Any]], states: dict[str, Any], active_designs: set[str],
                  priority: list[str]) -> dict[str, Any] | None:
    rank = {design: i for i, design in enumerate(priority)}
    for row in sorted(rows, key=lambda r: (rank[r['design']], r['design_queue_position'])):
        if row['design'] not in active_designs and states[row['logical_episode_id']]['status'] == 'registered':
            return row
    return None


def process_identity(pid: int) -> str | None:
    try:
        # The command name can contain spaces: fields after the final ')' start at 3.
        fields = Path(f'/proc/{pid}/stat').read_text().rsplit(')', 1)[1].split()
        return fields[19]
    except (OSError, IndexError):
        return None


def check_sources(manifest: dict[str, Any]) -> None:
    for name, expected in manifest['source_sha256'].items():
        if sha256(Path(name)) != expected.removeprefix('sha256:'):
            raise ValueError('Frozen source changed; dispatch disabled')


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--phase', choices=['smoke', 'formal'], required=True)
    parser.add_argument('--execute', action='store_true', help='otherwise validate and print a safe dry run')
    args = parser.parse_args(argv)
    manifest = json.loads(args.manifest.read_text())
    root = Path(manifest['runroot']).resolve()
    phase = args.phase
    rows = [row for row in manifest['cells'] if row['phase'] == phase]
    if not rows or len({r['logical_episode_id'] for r in rows}) != len(rows):
        raise ValueError('Non-unique or empty cell registration')
    if manifest['max_in_flight_candidates'] != 1 or manifest['per_design_active_episode_cap'] != 1:
        raise ValueError('Only q=1 and per-design exclusivity are authorized')
    if manifest['new_default_flow_replays'] != 0:
        raise ValueError('Default replay is forbidden')
    check_sources(manifest)
    for row in rows:
        Path(row['attempt_root']).resolve().relative_to(root)
        if not isinstance(row['command'], list) or not all(isinstance(s, str) for s in row['command']):
            raise ValueError('Frozen argv required')
        if row['command'][:2] != manifest['launcher_prefix']:
            raise ValueError('Cell argv does not use the frozen launcher')
    if not args.execute:
        print(json.dumps({'dry_run': True, 'provider_requests': 0, 'native_starts': 0,
                          'phase': phase, 'registered_cells': len(rows),
                          'commands': [r['command'] for r in rows]}, indent=2))
        return 0
    gates = json.loads((root / 'reports/gates.json').read_text())
    if gates['G1']['status'] != 'PASSED' or (phase == 'formal' and gates['G2']['status'] != 'PASSED'):
        raise ValueError('Prerequisite gate not passed; no execution')
    scheduler = root / 'scheduler'
    scheduler.mkdir(exist_ok=True)
    logs = scheduler / 'logs'
    logs.mkdir(exist_ok=True)
    # A single batch scheduler prevents concurrent smoke/formal queues too.
    lock = (scheduler / 'scheduler.lock').open('a')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    state_path = scheduler / f'{phase}-state.json'
    manifest_hash = sha256(args.manifest)
    if state_path.exists():
        state = json.loads(state_path.read_text())
        if state['manifest_sha256'] != manifest_hash:
            raise ValueError('Cannot resume under a different manifest')
    else:
        state = {'manifest_sha256': manifest_hash, 'phase': phase,
                 'cells': {r['logical_episode_id']: {'status': 'registered'} for r in rows}}
    state.update(scheduler_pid=os.getpid(), scheduler_start_ticks=process_identity(os.getpid()),
                 scheduler_started_at=now())
    owned: dict[str, subprocess.Popen[Any]] = {}
    previous = cpu_ticks()
    stable = 0
    last_persist = 0.0
    try:
        while True:
            time.sleep(10)
            sample, previous = resources(root, previous)
            stable = stable + 1 if max(sample['cpu_utilization'], sample['normalized_host_load']) < .95 else 0
            active_designs = set()
            for row in rows:
                eid = row['logical_episode_id']
                cell = state['cells'][eid]
                if cell['status'] == 'launching':
                    cell.update(status='quarantined', reason='ambiguous launch; inspect process/artifacts without rerun')
                if cell['status'] != 'running':
                    continue
                exit_file = Path(row['attempt_root']) / 'cell-exit.json'
                process = owned.get(eid)
                exited = process is not None and process.poll() is not None
                identity = process_identity(cell['pid'])
                alive = identity is not None and identity == cell['process_start_ticks']
                if not exited and alive:
                    active_designs.add(row['design'])
                    continue
                if process is not None:
                    process.wait()
                if exit_file.is_file():
                    terminal = json.loads(exit_file.read_text())
                    if terminal.get('episode_id') != row['native_episode_id']:
                        raise ValueError('Terminal identity mismatch; stop dispatch')
                    cell.update(status='terminated', terminal=terminal, finished_at=now())
                else:
                    cell.update(status='quarantined', reason='process exited without bound terminal record', finished_at=now())
            cap = dispatch_cap(sample, stable_low_samples=stable,
                               minimum_free_gib=manifest['minimum_free_gib'], clock=time.monotonic())
            if phase == 'smoke':
                cap = min(cap, 1)
            sample.update(active_designs=sorted(active_designs), active_episodes=len(active_designs), dispatch_cap=cap)
            state.update(heartbeat=now(), resource_sample=sample)
            write_json(state_path, state)
            if time.monotonic() - last_persist >= 60:
                with (scheduler / 'resources.jsonl').open('a') as stream:
                    stream.write(json.dumps(sample, sort_keys=True) + '\n')
                last_persist = time.monotonic()
            if all(c['status'] in {'terminated', 'quarantined'} for c in state['cells'].values()):
                return 0
            # Integrity failures stop new work; initial failures are retained, never replaced.
            if any(c['status'] == 'quarantined' or c.get('terminal', {}).get('evidence_integrity_failure') for c in state['cells'].values()):
                continue
            if len(active_designs) >= cap:
                continue
            row = eligible_cell(rows, state['cells'], active_designs, manifest['design_priority'])
            if row is None:
                continue
            check_sources(manifest)
            eid = row['logical_episode_id']
            safe_id = row['native_episode_id']
            state['cells'][eid].update(status='launching', dispatch_claimed_at=now())
            write_json(state_path, state)
            with (logs / f'{safe_id}.log').open('ab') as log:
                child = subprocess.Popen(row['command'], stdout=log, stderr=subprocess.STDOUT,
                                         start_new_session=True, cwd=manifest['launcher_cwd'])
            owned[eid] = child
            state['cells'][eid].update(status='running', pid=child.pid, pgid=child.pid,
                process_start_ticks=process_identity(child.pid), started_at=now())
            write_json(state_path, state)
            # One dispatch per fresh 10-second sample; no burst filling all six slots.
    finally:
        state['scheduler_exited_at'] = now()
        write_json(state_path, state)
        lock.close()


if __name__ == '__main__':
    raise SystemExit(main())
