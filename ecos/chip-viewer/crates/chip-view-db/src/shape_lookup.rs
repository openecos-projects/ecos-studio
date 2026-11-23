//! Snapshot-local shape lookup. A verified contiguous ID sequence can address
//! mapped records directly; all other snapshots keep the original first-ID map.
use super::*;

impl ShapeIdIndex {
    pub fn from_shapes(shapes: &[ShapeRecord]) -> Self {
        let dense_base = shapes.first().map(|shape| shape.id).filter(|base| {
            shapes
                .iter()
                .enumerate()
                .all(|(index, shape)| base.checked_add(index as u64) == Some(shape.id))
        });
        if dense_base.is_some() {
            return Self {
                by_id: HashMap::new(),
                dense_base,
            };
        }
        let mut by_id = HashMap::<ShapeId, usize>::with_capacity(shapes.len());
        for (index, shape) in shapes.iter().enumerate() {
            by_id.entry(shape.id).or_insert(index);
        }
        Self {
            by_id,
            dense_base: None,
        }
    }

    pub fn estimated_heap_bytes(&self) -> usize {
        size_of::<Self>() + self.by_id.capacity() * (size_of::<(ShapeId, usize)>() + 1)
    }

    pub fn find<'a>(
        &self,
        shapes: &'a [ShapeRecord],
        shape_id: ShapeId,
    ) -> Option<&'a ShapeRecord> {
        let index = match self.dense_base {
            Some(base) => usize::try_from(shape_id.checked_sub(base)?).ok()?,
            None => *self.by_id.get(&shape_id)?,
        };
        shapes.get(index)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn direct_and_sparse_shape_lookup_preserve_complete_records_first_duplicates_and_limits() {
        for ids in [
            vec![],
            vec![0, 1, 2, 3],
            vec![40, 41, 42],
            vec![40, 42, 43],
            vec![43, 40, 41],
            vec![40, 40, 41],
            vec![u64::MAX - 1, u64::MAX],
            vec![u64::MAX, 0],
        ] {
            let shapes: Vec<_> = ids
                .iter()
                .enumerate()
                .map(|(i, id)| ShapeRecord {
                    id: *id,
                    layer_id: i as u16,
                    owner_index: i as u32,
                    state: if i % 2 == 0 {
                        ShapeState::Alive
                    } else {
                        ShapeState::Deleted
                    } as u8,
                    ..Default::default()
                })
                .collect();
            let index = ShapeIdIndex::from_shapes(&shapes);
            for id in ids
                .into_iter()
                .chain([0, 1, 39, 40, 41, 42, 43, 44, u64::MAX])
            {
                assert_eq!(
                    index.find(&shapes, id).map(bytemuck::bytes_of),
                    shapes
                        .iter()
                        .find(|shape| shape.id == id)
                        .map(bytemuck::bytes_of)
                );
            }
        }
    }

    #[test]
    fn contiguous_shape_lookup_retains_no_per_record_heap_allocation() {
        let shapes: Vec<_> = (0..10000)
            .map(|index| ShapeRecord {
                id: index + 1000,
                ..Default::default()
            })
            .collect();
        let index = ShapeIdIndex::from_shapes(&shapes);
        assert_eq!(index.estimated_heap_bytes(), size_of::<ShapeIdIndex>());
        assert_eq!(
            index.find(&shapes, 10999).map(bytemuck::bytes_of),
            shapes.last().map(bytemuck::bytes_of)
        );
    }

    #[test]
    #[ignore = "requires ECOS_COVERAGE_MANIFEST; real snapshot shape lookup attribution"]
    fn real_design_shape_lookup_cost() {
        let manifest =
            std::env::var_os("ECOS_COVERAGE_MANIFEST").expect("set ECOS_COVERAGE_MANIFEST");
        let (db, timings) = ChipViewDb::open_with_timings(manifest).unwrap();
        let started = Instant::now();
        for shape in db.snapshot.shapes() {
            assert_eq!(
                db.find_shape(shape.id).map(bytemuck::bytes_of),
                Some(bytemuck::bytes_of(shape))
            );
        }
        eprintln!(
            "shapes={} direct={} retained_bytes={} index_build_ms={:.3} all_lookups_ms={:.3}",
            db.snapshot.shapes().len(),
            db.shape_index.dense_base.is_some(),
            db.shape_index.estimated_heap_bytes(),
            timings.shape_index as f64 / 1000.0,
            started.elapsed().as_secs_f64() * 1000.0
        );
    }
}
