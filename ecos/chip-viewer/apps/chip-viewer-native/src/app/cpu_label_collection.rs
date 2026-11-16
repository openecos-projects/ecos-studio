//! Deduplicate borrowed label identities before allocating candidate strings.
//! Repeated wire/port records share one winning anchor per chunk; geometry
//! drawing remains unchanged and every contributor still renders in order.
use super::*;
use std::collections::HashMap;

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
enum Identity<'a> {
    Named(ShapeLabelKind, &'a str),
    Owner(u8, u64),
}

struct Winner<'a> {
    identity: Identity<'a>,
    anchor_rect: egui::Rect,
    text: &'a str,
    kind: ShapeLabelKind,
    rank_area: f32,
}

#[derive(Default)]
pub(super) struct Collector<'a> {
    lookup: HashMap<Identity<'a>, usize>,
    winners: Vec<Winner<'a>>,
    compact_owners: bool,
}

impl<'a> Collector<'a> {
    pub(super) fn for_compact() -> Self {
        Self {
            compact_owners: true,
            ..Default::default()
        }
    }
    pub(super) fn compact(
        mut self,
        canvas: egui::Rect,
        current: &impl Fn() -> bool,
    ) -> Option<ShapeLabelCollector> {
        if self.compact_owners {
            self.winners.sort_by(|a, b| {
                a.identity
                    .cmp(&b.identity)
                    .then_with(|| b.rank_area.total_cmp(&a.rank_area))
            });
            self.winners
                .dedup_by(|later, first| later.identity == first.identity);
        }
        let mut labels = ShapeLabelCollector::default();
        let mut directory = Vec::with_capacity(self.winners.len());
        for (index, winner) in self.winners.into_iter().enumerate() {
            if index % 1024 == 0 && !current() {
                return None;
            }
            let key = match winner.identity {
                Identity::Named(kind, text) => ShapeLabelKey::Named {
                    kind,
                    text: text.to_owned(),
                },
                Identity::Owner(owner_type, owner_id) => ShapeLabelKey::Owner {
                    owner_type,
                    owner_id,
                },
            };
            directory.push((key.clone(), winner.rank_area));
            if winner
                .kind
                .eligible_in(false, winner.anchor_rect.intersect(canvas))
            {
                labels.insert(ShapeLabelCandidate {
                    key,
                    anchor_rect: winner.anchor_rect,
                    text: winner.text.to_owned(),
                    kind: winner.kind,
                    rank_area: winner.rank_area,
                    selected: false,
                    highlighted: false,
                });
            }
        }
        current().then(|| ShapeLabelCollector::from_compact_parts(labels, directory))
    }
    pub(super) fn observe(
        &mut self,
        geometry: chip_view_db::ShapeGeometry,
        owner: Option<&'a OwnerRef>,
        name: Option<&'a str>,
        key: &SceneKey,
    ) {
        let chip_view_db::ShapeGeometry::Rect(rect) = geometry else {
            return;
        };
        let Some(owner) = owner else {
            return;
        };
        let Some(owner_type) = OwnerType::from_raw(owner.owner_type) else {
            return;
        };
        let Some(kind) = shape_label_kind(owner_type, owner) else {
            return;
        };
        let Some(name) = name.map(str::trim) else {
            return;
        };
        let text = if kind == ShapeLabelKind::Pin
            && matches!(
                owner_type,
                OwnerType::PinPortShape | OwnerType::InstancePinPortShape
            )
            && owner.path0 != 0
        {
            local_shape_label_name(name)
        } else {
            name
        }
        .trim();
        if text.is_empty() {
            return;
        }
        let anchor_rect = shape_screen_rect(rect, key.world, key.canvas, key.zoom, key.pan);
        let visible = anchor_rect.intersect(key.canvas);
        if !anchor_rect.is_positive() || !visible.is_positive() {
            return;
        }
        let identity = match kind {
            ShapeLabelKind::IoPin | ShapeLabelKind::Net | ShapeLabelKind::Pdn => {
                Identity::Named(kind, name)
            }
            ShapeLabelKind::Pin | ShapeLabelKind::Instance => {
                Identity::Owner(owner.owner_type, owner.owner_id)
            }
        };
        let candidate = Winner {
            identity,
            anchor_rect,
            text,
            kind,
            rank_area: visible.area(),
        };
        if self.compact_owners && matches!(identity, Identity::Owner(..)) {
            self.winners.push(candidate);
            return;
        }
        if let Some(index) = self.lookup.get(&identity) {
            if candidate.rank_area > self.winners[*index].rank_area {
                self.winners[*index] = candidate;
            }
        } else {
            self.lookup.insert(identity, self.winners.len());
            self.winners.push(candidate);
        }
    }

    pub(super) fn observe_visible(
        &mut self,
        geometry: chip_view_db::ShapeGeometry,
        owner: Option<&'a OwnerRef>,
        db: &'a ChipViewDb,
        key: &SceneKey,
    ) {
        let chip_view_db::ShapeGeometry::Rect(rect) = geometry else {
            return;
        };
        let Some(owner) = owner else {
            return;
        };
        let Some(owner_type) = OwnerType::from_raw(owner.owner_type) else {
            return;
        };
        let Some(kind) = shape_label_kind(owner_type, owner) else {
            return;
        };
        let visible =
            shape_screen_rect(rect, key.world, key.canvas, key.zoom, key.pan).intersect(key.canvas);
        if !kind.eligible_in(false, visible) {
            return;
        }
        self.observe(geometry, Some(owner), db.owner_name(owner), key);
    }

    pub(super) fn publish(
        self,
        canvas: egui::Rect,
        is_current: &impl Fn() -> bool,
        labels: &mut labels::Candidates,
    ) -> Option<()> {
        for (index, winner) in self.winners.into_iter().enumerate() {
            if index % 1024 == 0 && !is_current() {
                return None;
            }
            let key = match winner.identity {
                Identity::Named(kind, text) => ShapeLabelKey::Named {
                    kind,
                    text: text.to_owned(),
                },
                Identity::Owner(owner_type, owner_id) => ShapeLabelKey::Owner {
                    owner_type,
                    owner_id,
                },
            };
            labels.insert(ShapeLabelCandidate {
                key,
                anchor_rect: winner.anchor_rect,
                text: if winner
                    .kind
                    .eligible_in(false, winner.anchor_rect.intersect(canvas))
                {
                    winner.text.to_owned()
                } else {
                    String::new()
                },
                kind: winner.kind,
                rank_area: winner.rank_area,
                selected: false,
                highlighted: false,
            });
        }
        is_current().then_some(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn borrowed_collection_matches_original_candidates_for_repeated_owners_names_and_clipped_ties()
    {
        let fixture = crate::app::cpu_scene::tests::Fixture::new();
        for zoom in [0.75, 1.0, 2.612572] {
            let request = fixture.request(zoom, 1.0);
            let mut original = ShapeLabelCollector::default();
            let mut reuse = Collector::default();
            let mut compact = Collector::for_compact();
            let owners: Vec<_> = [
                OwnerType::NetWireSegment,
                OwnerType::InstancePinPortShape,
                OwnerType::IoPinPortShape,
                OwnerType::InstanceBBox,
            ]
            .into_iter()
            .map(|kind| OwnerRef {
                owner_type: kind as u8,
                owner_id: 7,
                path0: 1,
                ..Default::default()
            })
            .collect();
            for index in 0..300 {
                let owner = &owners[index % owners.len()];
                let name = [" shared/net ", "chip/port", " chip/pin ", "cell/"][index % 4];
                let geometry = chip_view_db::ShapeGeometry::Rect(Rect32 {
                    lx: index as i32 % 31 * 11,
                    ly: index as i32 % 17 * 13,
                    hx: 400 + index as i32 % 19 * 7,
                    hy: 300 + index as i32 % 11 * 13,
                });
                if let Some(candidate) = shape_label_candidate(
                    geometry,
                    Some(owner),
                    Some(name),
                    false,
                    false,
                    request.key.world,
                    request.key.canvas,
                    zoom,
                    request.key.pan,
                ) {
                    original.insert(candidate);
                }
                reuse.observe(geometry, Some(owner), Some(name), &request.key);
                compact.observe(geometry, Some(owner), Some(name), &request.key);
            }
            assert!(reuse.winners.len() <= 4);
            let mut published = labels::Candidates::default();
            reuse
                .publish(request.key.canvas, &|| true, &mut published)
                .unwrap();
            let mut resolver = labels::LabelResolver::default();
            assert_eq!(
                resolver.resolve(&request, &published.snapshot(), || true),
                resolver.resolve(&request, &original, || true)
            );
            let compact = compact.compact(request.key.canvas, &|| true).unwrap();
            assert_eq!(
                resolver.resolve(&request, &compact, || true),
                resolver.resolve(&request, &original, || true)
            );
        }
    }

    #[test]
    fn visible_collection_skips_dormant_labels_before_owner_name_lookup() {
        let fixture = crate::app::cpu_scene::tests::Fixture::new();
        let request = fixture.request(1.0, 1.0);
        let owner = OwnerRef {
            owner_type: OwnerType::InstancePinPortShape as u8,
            owner_id: u64::MAX,
            ..OwnerRef::default()
        };
        let mut collector = Collector::default();

        collector.observe_visible(
            chip_view_db::ShapeGeometry::Rect(Rect32 {
                lx: 100,
                ly: 100,
                hx: 102,
                hy: 102,
            }),
            Some(&owner),
            &request.db,
            &request.key,
        );

        assert!(collector.winners.is_empty());
    }
}
