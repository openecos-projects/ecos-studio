use super::*;

pub(super) fn dots(sink: &mut impl PaintSink, rect: Rect, rgba: [u8; 4], spacing: f32) -> usize {
    let mut count = 0;
    let mut vertical = rect.top() + 2.0;
    while vertical < rect.bottom() && count < MAX_PATTERN_OPS_PER_SHAPE {
        let mut horizontal = rect.left() + 2.0;
        while horizontal < rect.right() && count < MAX_PATTERN_OPS_PER_SHAPE {
            sink.paint(PaintCommand::Disc {
                center: pos2(horizontal, vertical),
                radius: 0.8,
                rgba,
            });
            count += 1;
            horizontal += spacing;
        }
        vertical += spacing;
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
) -> usize {
    let width = rect.width().floor() as i32;
    let height = rect.height().floor() as i32;
    let mut count = 0;
    let mut offset = -height;
    while offset <= width && count < MAX_PATTERN_OPS_PER_SHAPE {
        let begin = (-offset).max(0).min(height);
        let end = (width - offset).min(height);
        if end - begin >= 3 {
            let horizontal_begin = rect.left() + (offset + begin) as f32;
            let horizontal_end = rect.left() + (offset + end) as f32;
            let (vertical_begin, vertical_end) = match direction {
                DiagonalDirection::Reverse => {
                    (rect.bottom() - begin as f32, rect.bottom() - end as f32)
                }
                DiagonalDirection::Forward => (rect.top() + begin as f32, rect.top() + end as f32),
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
        offset += 8;
    }
    count
}

pub(super) enum Axis {
    Horizontal,
    Vertical,
}

pub(super) fn axis(sink: &mut impl PaintSink, rect: Rect, rgba: [u8; 4], axis: Axis) -> usize {
    let mut count = 0;
    let mut offset = 4.0;
    while offset <= rect.width().max(rect.height()) && count < MAX_PATTERN_OPS_PER_SHAPE {
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
        offset += 10.0;
    }
    count
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
