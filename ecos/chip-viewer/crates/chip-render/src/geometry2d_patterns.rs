use super::*;

pub(super) fn dots(sink: &mut impl PaintSink, rect: Rect, rgba: [u8; 4], spacing: f32) -> usize {
    let horizontal_start = rect.left() + 2.0;
    let horizontal_end = rect.right() - 2.0;
    let vertical_start = rect.top() + 2.0;
    let vertical_end = rect.bottom() - 2.0;
    let horizontal_count = sample_count(horizontal_start, horizontal_end, spacing);
    let vertical_count = sample_count(vertical_start, vertical_end, spacing);
    let (horizontal_samples, vertical_samples) =
        capped_grid(horizontal_count, vertical_count, MAX_PATTERN_OPS_PER_SHAPE);
    let mut count = 0;
    for vertical_index in 0..vertical_samples {
        let vertical = sample_position(
            vertical_start,
            vertical_end,
            spacing,
            vertical_count,
            vertical_samples,
            vertical_index,
        );
        for horizontal_index in 0..horizontal_samples {
            let horizontal = sample_position(
                horizontal_start,
                horizontal_end,
                spacing,
                horizontal_count,
                horizontal_samples,
                horizontal_index,
            );
            sink.paint(PaintCommand::Disc {
                center: pos2(horizontal, vertical),
                radius: 0.8,
                rgba,
            });
            count += 1;
        }
    }
    count
}

pub(super) enum DiagonalDirection {
    Forward,
    Reverse,
}

pub(super) fn diagonal(
    sink: &mut impl PaintSink,
    rect: Rect,
    rgba: [u8; 4],
    direction: DiagonalDirection,
    max_ops: usize,
) -> usize {
    let width = rect.width().floor();
    let height = rect.height().floor();
    let offset_start = -height;
    let offset_end = (width - 3.0).max(offset_start);
    let source_count = sample_count(offset_start, offset_end, 8.0);
    let sample_count = source_count.min(max_ops);
    let mut count = 0;
    for index in 0..sample_count {
        let offset = sample_position(
            offset_start,
            offset_end,
            8.0,
            source_count,
            sample_count,
            index,
        );
        let begin = (-offset).max(0.0).min(height);
        let end = (width - offset).min(height);
        if end - begin >= 3.0 {
            let horizontal_begin = rect.left() + offset + begin;
            let horizontal_end = rect.left() + offset + end;
            let (vertical_begin, vertical_end) = match direction {
                DiagonalDirection::Reverse => (rect.bottom() - begin, rect.bottom() - end),
                DiagonalDirection::Forward => (rect.top() + begin, rect.top() + end),
            };
            sink.paint(PaintCommand::Line {
                points: [
                    pos2(horizontal_begin, vertical_begin),
                    pos2(horizontal_end, vertical_end),
                ],
                width: 1.0,
                rgba,
            });
            count += 1;
        }
    }
    count
}

pub(super) enum Axis {
    Horizontal,
    Vertical,
}

pub(super) fn axis(
    sink: &mut impl PaintSink,
    rect: Rect,
    rgba: [u8; 4],
    axis: Axis,
    max_ops: usize,
) -> usize {
    let extent = match axis {
        Axis::Horizontal => rect.height(),
        Axis::Vertical => rect.width(),
    };
    let source_count = sample_count(4.0, extent, 10.0);
    let sample_count = source_count.min(max_ops);
    let mut count = 0;
    for index in 0..sample_count {
        let offset = sample_position(4.0, extent, 10.0, source_count, sample_count, index);
        let points = match axis {
            Axis::Horizontal => {
                let vertical = rect.top() + offset;
                (vertical <= rect.bottom())
                    .then(|| [pos2(rect.left(), vertical), pos2(rect.right(), vertical)])
            }
            Axis::Vertical => {
                let horizontal = rect.left() + offset;
                (horizontal <= rect.right()).then(|| {
                    [
                        pos2(horizontal, rect.top()),
                        pos2(horizontal, rect.bottom()),
                    ]
                })
            }
        };
        if let Some(points) = points {
            sink.paint(PaintCommand::Line {
                points,
                width: 1.0,
                rgba,
            });
            count += 1;
        }
    }
    count
}

fn sample_count(start: f32, end: f32, spacing: f32) -> usize {
    if !start.is_finite() || !end.is_finite() || !spacing.is_finite() || spacing <= 0.0 {
        return 0;
    }
    if end < start {
        return 0;
    }
    ((end - start) / spacing).floor() as usize + 1
}

fn sample_position(
    start: f32,
    end: f32,
    spacing: f32,
    source_count: usize,
    samples: usize,
    index: usize,
) -> f32 {
    if source_count <= samples || samples <= 1 {
        return start + index as f32 * spacing;
    }
    start + (end - start) * index as f32 / (samples - 1) as f32
}

fn capped_grid(horizontal: usize, vertical: usize, max_ops: usize) -> (usize, usize) {
    if horizontal == 0 || vertical == 0 || max_ops == 0 {
        return (0, 0);
    }
    if horizontal.saturating_mul(vertical) <= max_ops {
        return (horizontal, vertical);
    }

    let aspect = horizontal as f32 / vertical as f32;
    let mut horizontal_samples = ((max_ops as f32 * aspect).sqrt() as usize)
        .max(1)
        .min(horizontal);
    let mut vertical_samples = (max_ops / horizontal_samples).max(1).min(vertical);
    while horizontal_samples.saturating_mul(vertical_samples) > max_ops {
        if horizontal_samples >= vertical_samples {
            horizontal_samples = horizontal_samples.saturating_sub(1).max(1);
        } else {
            vertical_samples = vertical_samples.saturating_sub(1).max(1);
        }
    }
    (horizontal_samples, vertical_samples)
}

pub(super) fn x_mark(sink: &mut impl PaintSink, rect: Rect, rgba: [u8; 4], width: f32) -> usize {
    let inset = 1.5_f32.min(rect.width() * 0.2).min(rect.height() * 0.2);
    let rect = rect.shrink(inset);
    if !rect.is_positive() {
        return 0;
    }
    sink.paint(PaintCommand::Line {
        points: [rect.left_top(), rect.right_bottom()],
        width,
        rgba,
    });
    sink.paint(PaintCommand::Line {
        points: [rect.left_bottom(), rect.right_top()],
        width,
        rgba,
    });
    2
}
