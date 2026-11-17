use anyhow::{ensure, Result};
use chipgeom_format::replay::Fingerprint;
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::Path;

pub fn verify(path: &Path, expected: &Fingerprint) -> Result<()> {
    let mut stream = std::fs::File::open(path)?;
    ensure!(
        stream.metadata()?.len() == expected.size,
        "Replay asset size mismatch: {}",
        path.display()
    );
    let mut digest = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let count = stream.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    ensure!(
        format!("{:x}", digest.finalize()) == expected.sha256,
        "Replay asset checksum mismatch: {}",
        path.display()
    );
    Ok(())
}
