use super::*;

pub(super) struct SolidProgram {
    program: glow::Program,
    screen: glow::UniformLocation,
}

impl SolidProgram {
    pub(super) fn new(
        gl: &glow::Context,
        position: u32,
        color: u32,
        texture_coordinate: u32,
    ) -> Result<Self, String> {
        let program = unsafe { gl.create_program()? };
        let mut shaders = Vec::new();
        let result = (|| {
            for (kind, source) in [
                (glow::VERTEX_SHADER, VERTEX),
                (glow::FRAGMENT_SHADER, FRAGMENT),
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
                gl.bind_attrib_location(program, position, "a_pos");
                gl.bind_attrib_location(program, color, "a_srgba");
                gl.bind_attrib_location(program, texture_coordinate, "a_tc");
                gl.link_program(program);
                if !gl.get_program_link_status(program) {
                    return Err(gl.get_program_info_log(program));
                }
                let screen = gl
                    .get_uniform_location(program, "u_screen_size")
                    .ok_or("solid screen uniform unavailable")?;
                gl.use_program(Some(program));
                gl.uniform_1_i32(gl.get_uniform_location(program, "u_sampler").as_ref(), 0);
                Ok(Self { program, screen })
            }
        })();
        unsafe {
            for shader in shaders {
                gl.detach_shader(program, shader);
                gl.delete_shader(shader);
            }
            if result.is_err() {
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
        }
    }

    pub(super) fn destroy(self, gl: &glow::Context) {
        unsafe { gl.delete_program(self.program) };
    }
}

const VERTEX: &str = r#"#version 140
uniform vec2 u_screen_size;
in vec2 a_pos;
in vec4 a_srgba;
in vec2 a_tc;
out vec4 v_rgba_in_gamma;
out vec2 v_tc;
void main() {
    gl_Position = vec4(2.0 * a_pos.x / u_screen_size.x - 1.0,
                      1.0 - 2.0 * a_pos.y / u_screen_size.y, 0.0, 1.0);
    v_rgba_in_gamma = a_srgba / 255.0;
    v_tc = a_tc;
}
"#;

const FRAGMENT: &str = r#"#version 140
in vec4 v_rgba_in_gamma;
in vec2 v_tc;
uniform sampler2D u_sampler;
out vec4 f_color;
float interleaved_gradient_noise(vec2 position) {
    float phase = 0.06711056 * position.x + 0.00583715 * position.y;
    return fract(52.9829189 * fract(phase));
}
vec3 dither_interleaved(vec3 rgb, float levels) {
    float noise = interleaved_gradient_noise(gl_FragCoord.xy);
    noise = (noise - 0.5) * 0.95;
    return rgb + noise / (levels - 1.0);
}
void main() {
    vec4 texel = texelFetch(u_sampler, ivec2(0, 0), 0);
    float white = texel.r < 0.0031308 ? texel.r * 12.92
        : 1.055 * pow(texel.r, 1.0 / 2.4) - 0.055;
    vec4 color = v_rgba_in_gamma * vec4(vec3(white), texel.a);
    color.rgb = dither_interleaved(color.rgb, 256.0);
    f_color = color;
}
"#;
