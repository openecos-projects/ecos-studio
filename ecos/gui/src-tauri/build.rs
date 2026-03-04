fn main() {
    // Pass the TARGET environment variable to the main code
    // This allows env!("TARGET") to work in src/main.rs
    println!(
        "cargo:rustc-env=TARGET={}",
        std::env::var("TARGET").unwrap()
    );

    tauri_build::build()
}
