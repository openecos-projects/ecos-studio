use super::*;
use std::collections::VecDeque;

const MAX_FRAMES: usize = 3;
const MAX_BYTES: usize = 48 * 1024 * 1024;

#[derive(Default)]
pub(super) struct Pool {
    frames: VecDeque<Arc<Vec<u8>>>,
    bytes: usize,
}

impl Pool {
    pub(super) fn take(&mut self, bytes: usize) -> Vec<u8> {
        let Some(index) = self
            .frames
            .iter()
            .position(|frame| Arc::strong_count(frame) == 1 && frame.capacity() >= bytes)
        else {
            return Vec::new();
        };
        let frame = self.frames.remove(index).unwrap();
        self.bytes -= frame.capacity();
        Arc::into_inner(frame).unwrap_or_default()
    }

    pub(super) fn keep(&mut self, pixels: Arc<Vec<u8>>) {
        let bytes = pixels.capacity();
        if bytes > MAX_BYTES || self.frames.iter().any(|frame| Arc::ptr_eq(frame, &pixels)) {
            return;
        }
        while self.frames.len() >= MAX_FRAMES || self.bytes > MAX_BYTES - bytes {
            let frame = self.frames.pop_front().unwrap();
            self.bytes -= frame.capacity();
        }
        self.bytes += bytes;
        self.frames.push_back(pixels);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn initial_pixel_pool_reuses_an_older_free_buffer_while_the_latest_is_displayed() {
        let mut pool = Pool::default();
        let first = Arc::new(vec![31; 4096]);
        let first_address = first.as_ptr();
        pool.keep(first);
        let displayed = Arc::new(vec![73; 4096]);
        let displayed_address = displayed.as_ptr();
        pool.keep(Arc::clone(&displayed));
        let mut reused = pool.take(4096);
        assert_eq!(reused.as_ptr(), first_address);
        assert_eq!(reused, vec![31; 4096]);
        reused.fill(91);
        assert_eq!(displayed.as_slice(), &[73; 4096]);
        drop(displayed);
        let released = pool.take(4096);
        assert_eq!(released.as_ptr(), displayed_address);
        assert_eq!(released, vec![73; 4096]);
    }

    #[test]
    fn initial_pixel_pool_bounds_capacity_and_never_mutates_shared_frames() {
        let mut pool = Pool::default();
        let shared = Arc::new(vec![19; 2048]);
        for _ in 0..5 {
            pool.keep(Arc::clone(&shared));
        }
        assert_eq!((pool.frames.len(), pool.bytes), (1, 2048));
        assert!(pool.take(2048).is_empty());
        for value in 0..8 {
            let mut pixels = Vec::with_capacity(4096);
            pixels.resize(1024, value);
            pool.keep(Arc::new(pixels));
            assert!(pool.frames.len() <= MAX_FRAMES && pool.bytes <= MAX_BYTES);
            assert_eq!(
                pool.bytes,
                pool.frames
                    .iter()
                    .map(|frame| frame.capacity())
                    .sum::<usize>()
            );
        }
        assert_eq!(shared.as_slice(), &[19; 2048]);
        assert!(pool.take(8192).is_empty());
        assert_eq!(pool.take(4096), vec![5; 1024]);
        let mut large = Vec::with_capacity(MAX_BYTES + 1);
        large.push(31);
        pool.keep(Arc::new(large));
        assert_eq!((pool.frames.len(), pool.bytes), (2, 8192));
    }
}
