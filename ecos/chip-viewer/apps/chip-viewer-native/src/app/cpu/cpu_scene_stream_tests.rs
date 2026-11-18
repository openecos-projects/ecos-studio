use super::*;

#[test]
fn sparse_zoom_queries_keep_the_geometry_workers_busy() {
    for workers in [1, 2, 8, 32] {
        for count in [0, 1, 7, 8, 33, 100, 1000, 8192, 341_651] {
            let size = queries::tail_chunk_size(count, workers);
            assert!((1..=4096).contains(&size));
            assert!(count.div_ceil(size) >= count.min(workers));
        }
    }
}

#[test]
fn out_of_order_workers_deliver_a_bounded_ordered_stream() {
    let in_flight = AtomicUsize::new(0);
    let maximum = AtomicUsize::new(0);
    let mut results = Vec::new();
    assert!(ordered_chunks(
        80,
        4,
        &|| true,
        |index| {
            if index % 4 == 0 {
                thread::sleep(Duration::from_millis(2));
            }
            let outstanding = in_flight.fetch_add(1, Ordering::SeqCst) + 1;
            maximum.fetch_max(outstanding, Ordering::SeqCst);
            Some(index)
        },
        |value| {
            results.push(value);
            in_flight.fetch_sub(1, Ordering::SeqCst);
            true
        }
    ));
    assert_eq!(results, (0..80).collect::<Vec<_>>());
    assert!(maximum.load(Ordering::SeqCst) <= 4);
}

#[test]
fn cancelled_or_failed_stream_releases_every_blocked_producer() {
    for failure in [0, 3, 17] {
        assert!(!ordered_chunks(
            20,
            4,
            &|| true,
            |index| (index != failure).then_some(index),
            |_| true,
        ));
        assert!(!ordered_chunks(20, 4, &|| true, Some, |index| index != failure,));
    }
    assert!(ordered_chunks(0, 0, &|| true, Some, |_| true));
    assert!(!ordered_chunks(20, 4, &|| false, Some, |_| true));
}
