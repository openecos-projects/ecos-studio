use std::path::Path;

use anyhow::Result;

#[derive(Debug, Clone)]
pub struct ViewJsonPackage {
    pub root: std::path::PathBuf,
}

pub fn open_viewjson_package(root: impl AsRef<Path>) -> Result<ViewJsonPackage> {
    Ok(ViewJsonPackage {
        root: root.as_ref().to_path_buf(),
    })
}
