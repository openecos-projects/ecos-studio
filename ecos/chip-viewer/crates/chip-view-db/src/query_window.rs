//! Bounded exact query coverage for interactive camera movement. The immutable
//! snapshot owns this cache, so edits/reloads cannot reuse another database's IDs.
use super::*;
use std::collections::VecDeque;
use std::sync::Mutex;

const MAX_BYTES: usize = 64 * 1024 * 1024;
const MAX_LAYERS: usize = 256;

struct Window {
    layer: u16,
    bounds: Rect32,
    hits: Vec<Hit>,
}

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
struct Hit {
    id: ShapeId,
    index: usize,
}

#[derive(Default)]
pub(super) struct WindowQueries(Mutex<VecDeque<Window>>);

impl WindowQueries {
    fn query(
        &self,
        shapes: &[ShapeRecord],
        layer: u16,
        bounds: Rect32,
        query: impl Fn(Rect32) -> Vec<usize>,
    ) -> Vec<ShapeId> {
        // Queries run outside the directory lock: display layers can progress
        // independently, and a large layer never blocks another layer's query.
        let previous = {
            let mut windows = self.0.lock().unwrap();
            windows
                .iter()
                .position(|window| window.layer == layer)
                .and_then(|index| windows.remove(index))
        };
        let hits = |rect| {
            let mut hits: Vec<_> = query(rect)
                .into_iter()
                .map(|index| Hit {
                    id: shapes[index].id,
                    index,
                })
                .collect();
            if !hits.is_sorted() {
                hits.sort_unstable();
            }
            hits
        };
        let mut window = match previous {
            Some(window) if contains(window.bounds, bounds) && worth_filtering(&window, bounds) => {
                window
            }
            Some(window) if contains(window.bounds, bounds) => Window {
                layer,
                bounds,
                hits: hits(bounds),
            },
            Some(mut window) if window.bounds.intersects(bounds) && valid(bounds) => {
                window
                    .hits
                    .retain(|hit| shapes[hit.index].bbox.intersects(bounds));
                for damage in exposed(bounds, window.bounds) {
                    window.hits = merge(window.hits, hits(damage));
                }
                // A shape can cross several damage strips. Deduplicate record
                // indices, preserving distinct records with identical ShapeIds.
                window.bounds = bounds;
                window
            }
            _ => Window {
                layer,
                bounds,
                hits: hits(bounds),
            },
        };
        let ids: Vec<_> = window
            .hits
            .iter()
            .filter(|hit| window.bounds == bounds || shapes[hit.index].bbox.intersects(bounds))
            .map(|hit| hit.id)
            .collect();
        // Drop spare capacity before retaining a camera window. Active query
        // results remain ordinary caller-owned vectors, outside this cache.
        window.hits.shrink_to_fit();
        let bytes = window.hits.capacity() * size_of::<Hit>();
        if bytes <= MAX_BYTES && valid(window.bounds) {
            let mut windows = self.0.lock().unwrap();
            if let Some(index) = windows.iter().position(|other| other.layer == layer) {
                windows.remove(index);
            }
            let mut retained = windows
                .iter()
                .map(|other| other.hits.capacity() * size_of::<Hit>())
                .sum::<usize>();
            while windows.len() >= MAX_LAYERS || retained > MAX_BYTES - bytes {
                let old = windows.pop_front().unwrap();
                retained -= old.hits.capacity() * size_of::<Hit>();
            }
            windows.push_back(window);
        }
        ids
    }
}

fn merge(left: Vec<Hit>, right: Vec<Hit>) -> Vec<Hit> {
    let mut result = Vec::with_capacity(left.len() + right.len());
    let (mut left, mut right) = (left.into_iter().peekable(), right.into_iter().peekable());
    while let (Some(a), Some(b)) = (left.peek(), right.peek()) {
        match a.cmp(b) {
            std::cmp::Ordering::Less => result.push(left.next().unwrap()),
            std::cmp::Ordering::Greater => result.push(right.next().unwrap()),
            std::cmp::Ordering::Equal => {
                result.push(left.next().unwrap());
                right.next();
            }
        }
    }
    result.extend(left);
    result.extend(right);
    result
}

impl ChipViewDb {
    /// Exact layer/ShapeId order, reusing previous spatial query coverage and
    /// traversing the spatial index only for newly exposed world rectangles.
    /// This caches record indices, never pixels, styles or approximate geometry.
    pub fn query_cached_layer_intersect(&self, layer: u16, bounds: Rect32) -> Vec<ShapeId> {
        let shapes = self.snapshot.shapes();
        self.window_queries.query(shapes, layer, bounds, |damage| {
            // Keep the whole-layer fast path used by query_layers_intersect.
            let whole_layer = self.layer_index.layer_bboxes.iter().any(|entry| {
                entry.layer_id == layer
                    && damage.lx <= entry.envelope.lower()[0]
                    && damage.ly <= entry.envelope.lower()[1]
                    && damage.hx >= entry.envelope.upper()[0]
                    && damage.hy >= entry.envelope.upper()[1]
            });
            if whole_layer {
                self.layer_index
                    .by_layer
                    .get(&layer)
                    .cloned()
                    .unwrap_or_default()
            } else {
                self.layer_index
                    .query_layer_intersect_indices(shapes, layer, damage)
            }
        })
    }
}

fn valid(rect: Rect32) -> bool {
    rect.lx <= rect.hx && rect.ly <= rect.hy
}

fn contains(outer: Rect32, inner: Rect32) -> bool {
    valid(outer)
        && valid(inner)
        && outer.lx <= inner.lx
        && outer.ly <= inner.ly
        && outer.hx >= inner.hx
        && outer.hy >= inner.hy
}

fn worth_filtering(window: &Window, target: Rect32) -> bool {
    let area = |rect: Rect32| {
        (i64::from(rect.hx) - i64::from(rect.lx)).max(0) as f64
            * (i64::from(rect.hy) - i64::from(rect.ly)).max(0) as f64
    };
    // A deep zoom should return to the spatial tree rather than inspect every
    // cached full-chip record. Small windows are already cheap to filter.
    window.hits.len() <= 4096 || area(target) * 4.0 >= area(window.bounds)
}

fn exposed(target: Rect32, old: Rect32) -> Vec<Rect32> {
    let mut result = Vec::with_capacity(4);
    let lx = target.lx.max(old.lx);
    let hx = target.hx.min(old.hx);
    if target.lx < old.lx {
        result.push(Rect32 {
            hx: old.lx,
            ..target
        });
    }
    if target.hx > old.hx {
        result.push(Rect32 {
            lx: old.hx,
            ..target
        });
    }
    if target.ly < old.ly {
        result.push(Rect32 {
            lx,
            hx,
            hy: old.ly,
            ..target
        });
    }
    if target.hy > old.hy {
        result.push(Rect32 {
            lx,
            hx,
            ly: old.hy,
            ..target
        });
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn camera_sequence_matches_full_query_with_duplicate_ids_and_boundary_crossings() {
        let shapes: Vec<_> = (0..5000)
            .map(|i| ShapeRecord {
                id: ((i * 997) % 1301) as u64,
                layer_id: 1,
                state: ShapeState::Alive as u8,
                bbox: Rect32 {
                    lx: i % 97 - 50,
                    ly: i % 89 - 45,
                    hx: i % 97 - 40,
                    hy: i % 89 - 35,
                },
                ..Default::default()
            })
            .collect();
        let index = LayerShapeIndex::from_shapes(&shapes);
        let cache = WindowQueries::default();
        for i in 0..80 {
            let bounds = Rect32 {
                lx: i - 50,
                ly: -20,
                hx: i - 5,
                hy: 25,
            };
            let mut queried = Vec::new();
            let actual = cache.query(&shapes, 1, bounds, |damage| {
                // Interior mutability is only a probe, not part of the cache.
                index.query_layer_intersect_indices(&shapes, 1, damage)
            });
            queried.extend(actual);
            assert_eq!(queried, index.query_layers_intersect(&shapes, &[1], bounds));
        }
        let outer = Rect32 {
            lx: -100,
            ly: -100,
            hx: 100,
            hy: 100,
        };
        cache.query(&shapes, 1, outer, |rect| {
            index.query_layer_intersect_indices(&shapes, 1, rect)
        });
        assert_eq!(
            cache.query(&shapes, 1, outer, |_| panic!("covered range queried again")),
            index.query_layers_intersect(&shapes, &[1], outer)
        );
        let inner = Rect32 {
            lx: -60,
            ly: -60,
            hx: 60,
            hy: 60,
        };
        assert_eq!(
            cache.query(&shapes, 1, inner, |_| panic!(
                "contained zoom queried again"
            )),
            index.query_layers_intersect(&shapes, &[1], inner)
        );
        let deep = Rect32 {
            lx: 0,
            ly: 0,
            hx: 1,
            hy: 1,
        };
        let queried = std::cell::Cell::new(false);
        let actual = cache.query(&shapes, 1, deep, |rect| {
            queried.set(true);
            index.query_layer_intersect_indices(&shapes, 1, rect)
        });
        assert!(queried.get(), "deep zoom must use its spatial query");
        assert_eq!(actual, index.query_layers_intersect(&shapes, &[1], deep));
    }

    #[test]
    fn small_pan_queries_only_exposed_strips() {
        let cache = WindowQueries::default();
        cache.query(
            &[],
            1,
            Rect32 {
                lx: 0,
                ly: 0,
                hx: 100,
                hy: 100,
            },
            |_| vec![],
        );
        let areas = Mutex::new(Vec::new());
        cache.query(
            &[],
            1,
            Rect32 {
                lx: 10,
                ly: 5,
                hx: 110,
                hy: 105,
            },
            |rect| {
                areas.lock().unwrap().push(rect);
                vec![]
            },
        );
        assert_eq!(
            *areas.lock().unwrap(),
            [
                Rect32 {
                    lx: 100,
                    ly: 5,
                    hx: 110,
                    hy: 105
                },
                Rect32 {
                    lx: 10,
                    ly: 100,
                    hx: 100,
                    hy: 105
                }
            ]
        );
    }

    #[test]
    #[ignore = "requires ECOS_COVERAGE_MANIFEST; real-data query attribution"]
    fn real_design_pan_query_cost() {
        let manifest =
            std::env::var_os("ECOS_COVERAGE_MANIFEST").expect("set ECOS_COVERAGE_MANIFEST");
        let db = ChipViewDb::open(manifest).unwrap();
        let world = db.stats().bbox.unwrap();
        let layers: Vec<_> = db
            .layer_catalog()
            .iter()
            .map(|layer| layer.layer_id)
            .collect();
        let width = (i64::from(world.hx) - i64::from(world.lx)) / 10;
        let height = (i64::from(world.hy) - i64::from(world.ly)) / 10;
        let mut reports = Vec::new();
        for step in 0..6 {
            let bounds = Rect32 {
                lx: (i64::from(world.lx) + width * step / 4) as i32,
                ly: (i64::from(world.ly) + height) as i32,
                hx: (i64::from(world.hx) - width + width * step / 4) as i32,
                hy: (i64::from(world.hy) - height) as i32,
            };
            let started = Instant::now();
            let expected = db.query_layers_intersect(&layers, bounds);
            let full_ms = started.elapsed().as_secs_f64() * 1000.0;
            let started = Instant::now();
            let actual: Vec<_> = layers
                .iter()
                .flat_map(|layer| db.query_cached_layer_intersect(*layer, bounds))
                .collect();
            let cached_ms = started.elapsed().as_secs_f64() * 1000.0;
            assert_eq!(actual, expected);
            reports.push(format!("{step},{},{full_ms},{cached_ms}", actual.len()));
        }
        let report = format!(
            "step,records,full_query_ms,cached_query_ms\n{}\n",
            reports.join("\n")
        );
        eprintln!("query attribution only:\n{report}");
        if let Some(path) = std::env::var_os("ECOS_QUERY_COST_OUTPUT") {
            std::fs::write(path, report).unwrap();
        }
    }
}
