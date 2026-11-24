use super::*;

// Million-record views need compact operations, not an arbitrary command-count
// fallback to millions of GL triangles. Grow in bounded pages rather than
// doubling the retained buffer at four million operations.
pub(super) const MAX_BYTES: usize = 96 * 1024 * 1024;
const PAGE: usize = 4096;

#[derive(Default)]
pub(super) struct Operations {
    pages: Vec<Vec<Operation>>,
    length: usize,
}

impl Operations {
    pub(super) fn len(&self) -> usize {
        self.length
    }

    pub(super) fn push(&mut self, operation: Operation) {
        if self.length % PAGE == 0 {
            self.pages.push(Vec::with_capacity(PAGE));
        }
        self.pages.last_mut().unwrap().push(operation);
        self.length += 1;
    }

    pub(super) fn iter(&self) -> impl Iterator<Item = &Operation> {
        self.since(0)
    }

    pub(super) fn get(&self, index: usize) -> &Operation {
        &self.pages[index / PAGE][index % PAGE]
    }

    pub(super) fn since(&self, start: usize) -> impl Iterator<Item = &Operation> {
        assert!(start <= self.length);
        self.pages[start / PAGE..]
            .iter()
            .enumerate()
            .flat_map(move |(index, page)| page[if index == 0 { start % PAGE } else { 0 }..].iter())
    }

    pub(super) fn into_operations(self) -> impl Iterator<Item = Operation> {
        self.pages.into_iter().flatten()
    }

    fn byte_len(&self) -> usize {
        self.pages.capacity() * size_of::<Vec<Operation>>()
            + self
                .pages
                .iter()
                .map(|page| page.capacity() * size_of::<Operation>())
                .sum::<usize>()
    }
}

impl Extend<Operation> for Operations {
    fn extend<T: IntoIterator<Item = Operation>>(&mut self, iter: T) {
        for operation in iter {
            self.push(operation);
        }
    }
}

impl SparseRects {
    pub(super) fn push_operation(&mut self, operation: Operation) {
        self.operations.push(operation);
    }

    pub(in crate::app::cpu_scene) fn retained_bytes(&self) -> usize {
        self.operations.byte_len()
            + self.auxiliary_bytes
            + self.residuals.capacity() * size_of::<Vec<ResidualPrimitive>>()
            + self.holes.capacity() * size_of::<u64>()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compact_rectangle_operations_have_a_fixed_memory_bound() {
        assert!(size_of::<Operation>() <= 16);
        let fixture = crate::app::cpu_scene::tests::Fixture::new();
        let request = fixture.request(1.0, 1.0);
        let mut kernel = SparseRects::new(&request).unwrap();
        for _ in 0..1_000_100 {
            kernel.push_operation(Operation::Rect([10, 10, 12, 12], egui::Color32::WHITE));
        }
        assert!(!kernel.prefers_meshes());
        assert!(kernel.retained_bytes() < 17 * 1024 * 1024);
    }
}
