struct View { size: vec2<f32>, opacity: f32, progress: f32, animated: f32, pad0: f32, pad1: f32, pad2: f32 }
@group(0) @binding(0) var<uniform> view: View;
struct Motion { offset: vec2<f32>, start: f32, duration: f32 }
@group(0) @binding(1) var<storage, read> motion: array<Motion>;
struct VertexOut { @builtin(position) position: vec4<f32>, @location(0) color: vec4<f32> }
@vertex
fn vertex(@builtin(vertex_index) index: u32, @location(0) position: vec2<f32>, @location(2) color: vec4<f32>) -> VertexOut {
    var out: VertexOut;
    var p = position;
    out.color = color;
    if view.animated > 0.5 {
        let m = motion[index];
        if m.duration != 0.0 {
            let duration = select(m.duration, 1.0, m.duration < 0.0);
            let t = clamp((view.progress - m.start) / duration, 0.0, 1.0);
            let fraction = t * t * (3.0 - 2.0 * t);
            p += m.offset * (1.0 - fraction);
            if m.duration > 0.0 { out.color *= fraction; }
        }
    }
    out.position = vec4<f32>(2.0 * p.x / view.size.x - 1.0, 1.0 - 2.0 * p.y / view.size.y, 0.0, 1.0);
    return out;
}
@fragment
fn fragment_gamma(in: VertexOut) -> @location(0) vec4<f32> { return in.color * view.opacity; }
@fragment
fn fragment_linear(in: VertexOut) -> @location(0) vec4<f32> {
    let color = in.color * view.opacity;
    let linear = select(pow((color.rgb + vec3<f32>(0.055)) / 1.055, vec3<f32>(2.4)), color.rgb / 12.92, color.rgb <= vec3<f32>(0.04045));
    return vec4<f32>(linear, color.a);
}
