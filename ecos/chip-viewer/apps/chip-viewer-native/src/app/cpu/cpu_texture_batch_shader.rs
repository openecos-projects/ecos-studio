//! Matches egui_glow 0.31.1's vertex/color, sRGB sampling and dither math.
//! Texture selection is flat per triangle; UVs are passed through unchanged.
use super::*;

pub(super) struct Program {
    pub(super) program: glow::Program,
    screen: glow::UniformLocation,
    samplers: Vec<glow::UniformLocation>,
}

impl Program {
    pub(super) fn new(gl: &glow::Context) -> Result<Self, String> {
        let program = unsafe { gl.create_program()? };
        let mut shaders = Vec::new();
        let result = (|| {
            let srgb = gl
                .supported_extensions()
                .iter()
                .any(|extension| extension.contains("sRGB"));
            let fragment = format!(
                "#version 140\n#define SRGB_TEXTURES {}\n{FRAGMENT}",
                srgb as u8
            );
            for (kind, source) in [
                (glow::VERTEX_SHADER, VERTEX),
                (glow::FRAGMENT_SHADER, fragment.as_str()),
            ] {
                let shader = unsafe { gl.create_shader(kind)? };
                shaders.push(shader);
                unsafe {
                    gl.attach_shader(program, shader);
                    gl.shader_source(shader, source);
                    gl.compile_shader(shader);
                    if !gl.get_shader_compile_status(shader) {
                        return Err(gl.get_shader_info_log(shader));
                    }
                }
            }
            unsafe {
                for (index, name) in ["a_pos", "a_tc", "a_srgba", "a_slot"]
                    .into_iter()
                    .enumerate()
                {
                    gl.bind_attrib_location(program, index as u32, name);
                }
                gl.link_program(program);
                if !gl.get_program_link_status(program) {
                    return Err(gl.get_program_info_log(program));
                }
            }
            let screen = unsafe { gl.get_uniform_location(program, "u_screen_size") }
                .ok_or("missing screen uniform")?;
            let samplers = (0..8)
                .map(|index| unsafe {
                    gl.get_uniform_location(program, &format!("u_sampler{index}"))
                        .ok_or("missing sampler uniform".to_owned())
                })
                .collect::<Result<_, _>>()?;
            Ok(Self {
                program,
                screen,
                samplers,
            })
        })();
        for shader in shaders {
            unsafe {
                gl.detach_shader(program, shader);
                gl.delete_shader(shader);
            }
        }
        if result.is_err() {
            unsafe {
                gl.delete_program(program);
            }
        }
        result
    }

    pub(super) fn bind(&self, gl: &glow::Context, key: &SceneKey) {
        unsafe {
            gl.use_program(Some(self.program));
            gl.uniform_2_f32(
                Some(&self.screen),
                key.screen_size[0] as f32 / key.pixels_per_point,
                key.screen_size[1] as f32 / key.pixels_per_point,
            );
            for (index, sampler) in self.samplers.iter().enumerate() {
                gl.uniform_1_i32(Some(sampler), index as i32);
            }
        }
    }
}

const VERTEX: &str = r#"#version 140
uniform vec2 u_screen_size;
in vec2 a_pos;
in vec4 a_srgba;
in vec2 a_tc;
in uint a_slot;
out vec4 v_rgba_in_gamma;
out vec2 v_tc;
flat out uint v_slot;
void main() {
    gl_Position = vec4(2.0 * a_pos.x / u_screen_size.x - 1.0,
                      1.0 - 2.0 * a_pos.y / u_screen_size.y, 0.0, 1.0);
    v_rgba_in_gamma = a_srgba / 255.0;
    v_tc = a_tc;
    v_slot = a_slot;
}
"#;

const FRAGMENT: &str = r#"
in vec4 v_rgba_in_gamma;
in vec2 v_tc;
flat in uint v_slot;
uniform sampler2D u_sampler0;
uniform sampler2D u_sampler1;
uniform sampler2D u_sampler2;
uniform sampler2D u_sampler3;
uniform sampler2D u_sampler4;
uniform sampler2D u_sampler5;
uniform sampler2D u_sampler6;
uniform sampler2D u_sampler7;
out vec4 f_color;
float interleaved_gradient_noise(vec2 n) {
    float f = 0.06711056 * n.x + 0.00583715 * n.y;
    return fract(52.9829189 * fract(f));
}
vec3 dither_interleaved(vec3 rgb, float levels) {
    float noise = interleaved_gradient_noise(gl_FragCoord.xy);
    noise = (noise - 0.5) * 0.95;
    return rgb + noise / (levels - 1.0);
}
vec3 srgb_gamma_from_linear(vec3 rgb) {
    bvec3 cutoff = lessThan(rgb, vec3(0.0031308));
    vec3 lower = rgb * vec3(12.92);
    vec3 higher = vec3(1.055) * pow(rgb, vec3(1.0 / 2.4)) - vec3(0.055);
    return mix(higher, lower, vec3(cutoff));
}
vec4 srgba_gamma_from_linear(vec4 rgba) {
    return vec4(srgb_gamma_from_linear(rgba.rgb), rgba.a);
}
vec4 sample_texture() {
    vec2 dx = dFdx(v_tc);
    vec2 dy = dFdy(v_tc);
    if (v_slot == 0u) return textureGrad(u_sampler0, v_tc, dx, dy);
    if (v_slot == 1u) return textureGrad(u_sampler1, v_tc, dx, dy);
    if (v_slot == 2u) return textureGrad(u_sampler2, v_tc, dx, dy);
    if (v_slot == 3u) return textureGrad(u_sampler3, v_tc, dx, dy);
    if (v_slot == 4u) return textureGrad(u_sampler4, v_tc, dx, dy);
    if (v_slot == 5u) return textureGrad(u_sampler5, v_tc, dx, dy);
    if (v_slot == 6u) return textureGrad(u_sampler6, v_tc, dx, dy);
    return textureGrad(u_sampler7, v_tc, dx, dy);
}

void main() {
#if SRGB_TEXTURES
    vec4 texture_in_gamma = srgba_gamma_from_linear(sample_texture());
#else
    vec4 texture_in_gamma = sample_texture();
#endif
    vec4 frag_color_gamma = v_rgba_in_gamma * texture_in_gamma;
    frag_color_gamma.rgb = dither_interleaved(frag_color_gamma.rgb, 256.0);
    f_color = frag_color_gamma;
}
"#;
