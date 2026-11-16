//! Resolve a timing net arc against the same native geometry used by the STA viewer.
//! No flylines: every XY stroke stays inside a selected wire/via rectangle.
use chip_view_db::ChipViewDb;
use chipgeom_format::{OwnerType, Rect32};
use std::collections::{BTreeMap, VecDeque};
use std::sync::Arc;

const MAX_NET_SHAPES: usize = 4096;
const NET_TYPES: [OwnerType; 2] = [OwnerType::NetWireSegment, OwnerType::Via];

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Point {
    pub x: i64,
    pub y: i64,
    pub layer: u16,
}
#[derive(Clone, Copy, Debug)]
pub struct Stroke {
    pub a: Point,
    pub b: Point,
}
impl Stroke {
    pub fn length(&self) -> f64 {
        ((self.a.x - self.b.x).abs() + (self.a.y - self.b.y).abs()).max(1) as f64
    }
}
#[derive(Clone, Debug, Default)]
pub struct Route {
    pub strokes: Vec<Stroke>,
    pub length: f64,
}
#[derive(Clone, Debug)]
struct Shape {
    bbox: Rect32,
    layer: u16,
    // All layers/cuts of one real via share this native owner path.
    via: Option<(u64, u32, u32, u32)>,
}
impl Shape {
    fn connects(&self, other: &Self) -> bool {
        intersects(self.bbox, other.bbox)
            && (self.layer == other.layer || self.via.is_some() && self.via == other.via)
    }
}
#[derive(Clone, Default)]
pub struct Pin {
    pub center: Option<[i64; 2]>,
    pub bbox: Option<[i64; 4]>,
    net: Option<String>,
    shapes: Vec<Shape>,
}

pub struct Resolver {
    db: ChipViewDb,
    pins: BTreeMap<String, Pin>,
    nets: BTreeMap<String, Graph>,
    routes: BTreeMap<(String, String), Option<Arc<Route>>>,
}
impl Resolver {
    pub fn new(db: ChipViewDb) -> Self {
        Self {
            db,
            pins: BTreeMap::new(),
            nets: BTreeMap::new(),
            routes: BTreeMap::new(),
        }
    }
    pub fn pin(&mut self, full: &str, instance: &str) -> Pin {
        if let Some(pin) = self.pins.get(full) {
            return pin.clone();
        }
        let local = if instance.is_empty() {
            full
        } else {
            full.strip_prefix(instance)
                .and_then(|s| s.strip_prefix(':').or_else(|| s.strip_prefix('/')))
                .unwrap_or(full)
        };
        let endpoints = if instance.is_empty() {
            self.db.connectivity_for_pin(local)
        } else {
            self.db.connectivity_for_instance(instance)
        };
        let net = endpoints
            .iter()
            .find(|e| e.pin_name == local && e.instance_name == instance)
            .map(|e| e.net_name.clone())
            .filter(|s| !s.is_empty());
        let shapes: Vec<_> = self
            .db
            .query_endpoint_pin_name(instance, local)
            .iter()
            .filter_map(|id| self.db.find_shape(*id))
            .map(|s| Shape {
                bbox: s.bbox,
                layer: s.layer_id,
                via: None,
            })
            .collect();
        let bbox = shapes.iter().map(|s| s.bbox).reduce(|a, b| Rect32 {
            lx: a.lx.min(b.lx),
            ly: a.ly.min(b.ly),
            hx: a.hx.max(b.hx),
            hy: a.hy.max(b.hy),
        });
        let pin = Pin {
            center: bbox.map(|b| center(b)),
            bbox: bbox.map(|b| [b.lx.into(), b.ly.into(), b.hx.into(), b.hy.into()]),
            net,
            shapes,
        };
        self.pins.insert(full.to_owned(), pin.clone());
        pin
    }
    pub fn route(&mut self, source: (&str, &str), sink: (&str, &str)) -> Option<Arc<Route>> {
        let key = (source.0.to_owned(), sink.0.to_owned());
        if let Some(route) = self.routes.get(&key) {
            return route.clone();
        }
        let a = self.pin(source.0, source.1);
        let b = self.pin(sink.0, sink.1);
        let result = self.connect(&a, &b).map(Arc::new);
        self.routes.insert(key, result.clone());
        result
    }
    fn connect(&mut self, a: &Pin, b: &Pin) -> Option<Route> {
        let net = a.net.as_ref().filter(|net| Some(*net) == b.net.as_ref())?;
        if !self.nets.contains_key(net) {
            let ids = self.db.query_owner_name_for_owner_types(net, &NET_TYPES);
            // An incomplete candidate set must never masquerade as a real route.
            if ids.len() > MAX_NET_SHAPES {
                return None;
            }
            let shapes = ids
                .iter()
                .filter_map(|id| {
                    let shape = self.db.find_shape(*id)?;
                    let owner = self.db.owner_for_shape(shape)?;
                    let via = (OwnerType::from_raw(owner.owner_type) == Some(OwnerType::Via))
                        .then_some((owner.owner_id, owner.path0, owner.path1, owner.path2));
                    Some(Shape {
                        bbox: shape.bbox,
                        layer: shape.layer_id,
                        via,
                    })
                })
                .collect();
            self.nets.insert(net.clone(), Graph::new(shapes));
        }
        self.nets.get(net)?.route(&a.shapes, &b.shapes)
    }
}

struct Graph {
    shapes: Vec<Shape>,
    edges: Vec<Vec<usize>>,
}
impl Graph {
    fn new(shapes: Vec<Shape>) -> Self {
        let mut edges = vec![Vec::new(); shapes.len()];
        // Sweep X to avoid comparing distant rectangles. Built once per visited net.
        let mut order: Vec<_> = (0..shapes.len()).collect();
        order.sort_by_key(|&i| shapes[i].bbox.lx);
        for (offset, &a) in order.iter().enumerate() {
            for &b in &order[offset + 1..] {
                if shapes[b].bbox.lx > shapes[a].bbox.hx {
                    break;
                }
                if shapes[a].connects(&shapes[b]) {
                    edges[a].push(b);
                    edges[b].push(a);
                }
            }
        }
        Self { shapes, edges }
    }
    fn route(&self, sources: &[Shape], sinks: &[Shape]) -> Option<Route> {
        let anchors = |pins: &[Shape]| -> BTreeMap<usize, [i64; 2]> {
            self.shapes
                .iter()
                .enumerate()
                .filter_map(|(i, s)| {
                    pins.iter()
                        .find(|p| p.layer == s.layer && intersects(p.bbox, s.bbox))
                        .map(|p| (i, center(overlap(p.bbox, s.bbox))))
                })
                .collect()
        };
        let starts = anchors(sources);
        let ends = anchors(sinks);
        let chain = connected_chain(
            self.edges.len(),
            starts.keys().copied(),
            |i| ends.contains_key(&i),
            |i| self.edges[i].iter().copied(),
        )?;
        let mut route = Route::default();
        let mut point = *starts.get(chain.first()?)?;
        for (i, &index) in chain.iter().enumerate() {
            let shape = &self.shapes[index];
            let next = chain.get(i + 1).map(|&j| &self.shapes[j]);
            let exit = next.map_or_else(|| ends[&index], |s| center(overlap(shape.bbox, s.bbox)));
            // Reconstruct the rectilinear spine within this exact metal shape.
            let c = center(shape.bbox);
            let bends = if i64::from(shape.bbox.hx) - i64::from(shape.bbox.lx)
                >= i64::from(shape.bbox.hy) - i64::from(shape.bbox.ly)
            {
                [[point[0], c[1]], [exit[0], c[1]]]
            } else {
                [[c[0], point[1]], [c[0], exit[1]]]
            };
            let mut from = Point {
                x: point[0],
                y: point[1],
                layer: shape.layer,
            };
            for xy in bends.into_iter().chain([exit]) {
                let to = Point {
                    x: xy[0],
                    y: xy[1],
                    layer: shape.layer,
                };
                debug_assert!(from.x == to.x || from.y == to.y);
                debug_assert!([from, to].iter().all(|p| p.x >= i64::from(shape.bbox.lx)
                    && p.x <= i64::from(shape.bbox.hx)
                    && p.y >= i64::from(shape.bbox.ly)
                    && p.y <= i64::from(shape.bbox.hy)));
                push(&mut route, from, to);
                from = to;
            }
            if let Some(next) = next {
                push(
                    &mut route,
                    from,
                    Point {
                        layer: next.layer,
                        ..from
                    },
                );
            }
            point = exit;
        }
        (!route.strokes.is_empty()).then_some(route)
    }
}

/// Shared source-to-sink branch selection. No unrelated fanout is returned.
pub fn connected_chain<N: IntoIterator<Item = usize>>(
    count: usize,
    starts: impl IntoIterator<Item = usize>,
    is_sink: impl Fn(usize) -> bool,
    neighbors: impl Fn(usize) -> N,
) -> Option<Vec<usize>> {
    let mut visited = vec![false; count];
    let mut previous = vec![None; count];
    let mut queue = VecDeque::new();
    for i in starts {
        if !visited[i] {
            visited[i] = true;
            queue.push_back(i);
        }
    }
    while let Some(i) = queue.pop_front() {
        if is_sink(i) {
            let mut path = vec![i];
            let mut at = i;
            while let Some(p) = previous[at] {
                path.push(p);
                at = p;
            }
            path.reverse();
            return Some(path);
        }
        for next in neighbors(i) {
            if !visited[next] {
                visited[next] = true;
                previous[next] = Some(i);
                queue.push_back(next);
            }
        }
    }
    None
}
fn push(route: &mut Route, a: Point, b: Point) {
    if a != b {
        let stroke = Stroke { a, b };
        route.length += stroke.length();
        route.strokes.push(stroke);
    }
}
fn intersects(a: Rect32, b: Rect32) -> bool {
    a.lx <= b.hx && a.hx >= b.lx && a.ly <= b.hy && a.hy >= b.ly
}
fn overlap(a: Rect32, b: Rect32) -> Rect32 {
    Rect32 {
        lx: a.lx.max(b.lx),
        ly: a.ly.max(b.ly),
        hx: a.hx.min(b.hx),
        hy: a.hy.min(b.hy),
    }
}
fn center(b: Rect32) -> [i64; 2] {
    [
        (i64::from(b.lx) + i64::from(b.hx)) / 2,
        (i64::from(b.ly) + i64::from(b.hy)) / 2,
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    fn shape(b: [i32; 4], layer: u16) -> Shape {
        Shape {
            bbox: Rect32 {
                lx: b[0],
                ly: b[1],
                hx: b[2],
                hy: b[3],
            },
            layer,
            via: None,
        }
    }
    #[test]
    fn follows_real_dogleg_and_excludes_dead_end_without_diagonals() {
        let graph = Graph::new(vec![
            shape([0, 0, 50, 4], 1),
            shape([46, 0, 50, 60], 1),
            shape([46, 56, 100, 60], 1),
            shape([20, -40, 24, 0], 1),
        ]);
        let route = graph
            .route(&[shape([0, 0, 4, 4], 1)], &[shape([96, 56, 100, 60], 1)])
            .unwrap();
        assert!(route.strokes.iter().any(|s| s.a.y == 58 && s.b.y == 58));
        for stroke in route.strokes {
            assert!(stroke.a.x == stroke.b.x || stroke.a.y == stroke.b.y);
            assert!(stroke.a.y >= 0 && stroke.b.y >= 0);
        }
    }
    #[test]
    fn only_a_real_via_crosses_layers_and_missing_route_stays_missing() {
        let source = shape([0, 0, 10, 4], 1);
        let sink = shape([10, 0, 20, 4], 3);
        assert!(Graph::new(vec![source.clone(), sink.clone()])
            .route(&[source.clone()], &[sink.clone()])
            .is_none());
        let mut lower = shape([8, 0, 12, 4], 1);
        lower.via = Some((7, 0, 0, 0));
        let mut upper = shape([8, 0, 12, 4], 3);
        upper.via = lower.via;
        let graph = Graph::new(vec![
            source.clone(),
            lower.clone(),
            upper.clone(),
            sink.clone(),
        ]);
        let route = graph.route(&[source.clone()], &[sink.clone()]).unwrap();
        assert!(route
            .strokes
            .iter()
            .any(|s| s.a.layer != s.b.layer && s.a.x == s.b.x && s.a.y == s.b.y));
        upper.via = Some((8, 0, 0, 0));
        assert!(Graph::new(vec![source.clone(), lower, upper, sink.clone()])
            .route(&[source], &[sink])
            .is_none());
    }
}
