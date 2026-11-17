//! Indexed, immutable display data; opening a catalog never deserializes records.
use anyhow::{ensure, Context, Result};
use chipgeom_format::{display::*, Rect32};
use memmap2::{Mmap, MmapOptions};
use serde::de::DeserializeOwned;
use serde_json::Value;
use std::{fs::File, path::Path, sync::Arc};

#[derive(Clone, Debug)]
pub struct DisplayAsset {
    bytes: Arc<Mmap>,
    pub metadata: Value,
    pub encoding: u32,
    pub count: usize,
    data: usize,
    index: usize,
}

impl DisplayAsset {
    pub fn open(path: &Path) -> Result<Self> {
        let file =
            File::open(path).with_context(|| format!("Open display asset {}", path.display()))?;
        ensure!(
            file.metadata()?.len() >= HEADER_SIZE as u64,
            "Truncated display header"
        );
        // Geometry publishers use immutable epoch files and publish the manifest last.
        let bytes = Arc::new(unsafe { MmapOptions::new().map(&file)? });
        ensure!(
            &bytes[..8] == MAGIC && u32_at(&bytes, 8)? == VERSION,
            "Unsupported display schema"
        );
        let encoding = u32_at(&bytes, 12)?;
        let metadata_size = u32_at(&bytes, 16)? as usize;
        let record_size = u32_at(&bytes, 20)? as usize;
        let count = usize::try_from(u64_at(&bytes, 24)?)?;
        let index = usize::try_from(u64_at(&bytes, 32)?)?;
        ensure!(
            metadata_size <= MAX_METADATA_BYTES,
            "Display metadata exceeds limit"
        );
        let data = HEADER_SIZE
            .checked_add(metadata_size)
            .context("Display offset overflow")?;
        ensure!(data <= bytes.len(), "Truncated display metadata");
        match encoding {
            CELLS => {
                ensure!(
                    record_size == CELL_SIZE && index == 0,
                    "Invalid display cell header"
                );
                let end = count
                    .checked_mul(CELL_SIZE)
                    .and_then(|n| data.checked_add(n));
                ensure!(end == Some(bytes.len()), "Display cell count/size mismatch");
            }
            RECORDS => {
                ensure!(
                    record_size == 0 && index >= data,
                    "Invalid display record header"
                );
                let end = count
                    .checked_add(1)
                    .and_then(|n| n.checked_mul(8))
                    .and_then(|n| index.checked_add(n));
                ensure!(
                    end == Some(bytes.len()),
                    "Display record index/size mismatch"
                );
                ensure!(
                    u64_at(&bytes, index)? == 0,
                    "Invalid first display record offset"
                );
                ensure!(
                    u64_at(&bytes, bytes.len() - 8)? == (index - data) as u64,
                    "Invalid final display record offset"
                );
            }
            _ => anyhow::bail!("Unsupported display encoding"),
        }
        let metadata: Value = serde_json::from_slice(&bytes[HEADER_SIZE..data])?;
        ensure!(metadata.is_object(), "Display metadata must be an object");
        for field in ["kind", "key", "label"] {
            ensure!(
                metadata[field].as_str().is_some_and(|s| !s.is_empty()),
                "Missing display {field}"
            );
        }
        Ok(Self {
            bytes,
            metadata,
            encoding,
            count,
            data,
            index,
        })
    }

    pub fn cell(&self, index: usize) -> Result<DisplayCell> {
        ensure!(
            self.encoding == CELLS && index < self.count,
            "Invalid display cell index"
        );
        let offset = self.data + index * CELL_SIZE;
        let bounds = Rect32 {
            lx: u32_at(&self.bytes, offset + 8)? as i32,
            ly: u32_at(&self.bytes, offset + 12)? as i32,
            hx: u32_at(&self.bytes, offset + 16)? as i32,
            hy: u32_at(&self.bytes, offset + 20)? as i32,
        };
        let value = f64::from_bits(u64_at(&self.bytes, offset + 24)?);
        ensure!(
            bounds.lx <= bounds.hx && bounds.ly <= bounds.hy && value.is_finite(),
            "Invalid display cell value/bounds"
        );
        Ok(DisplayCell {
            row: u32_at(&self.bytes, offset)?,
            column: u32_at(&self.bytes, offset + 4)?,
            bounds,
            value,
        })
    }

    pub fn record<T: DeserializeOwned>(&self, index: usize) -> Result<T> {
        ensure!(
            self.encoding == RECORDS && index < self.count,
            "Invalid display record index"
        );
        let first = usize::try_from(u64_at(&self.bytes, self.index + index * 8)?)?;
        let last = usize::try_from(u64_at(&self.bytes, self.index + (index + 1) * 8)?)?;
        ensure!(
            first < last && last <= self.index - self.data,
            "Invalid display record offsets"
        );
        ensure!(
            last - first <= MAX_RECORD_BYTES,
            "Display record exceeds limit"
        );
        Ok(rmp_serde::from_slice(
            &self.bytes[self.data + first..self.data + last],
        )?)
    }
}

fn u32_at(bytes: &[u8], offset: usize) -> Result<u32> {
    Ok(u32::from_le_bytes(
        bytes
            .get(offset..offset + 4)
            .context("Truncated display u32")?
            .try_into()?,
    ))
}
fn u64_at(bytes: &[u8], offset: usize) -> Result<u64> {
    Ok(u64::from_le_bytes(
        bytes
            .get(offset..offset + 8)
            .context("Truncated display u64")?
            .try_into()?,
    ))
}

#[cfg(test)]
#[path = "display_tests.rs"]
mod tests;

/// Deserialize a typed geometry table without an intermediate JSON value tree.
pub(crate) fn read_records<T: DeserializeOwned>(path: &Path, kind: &str) -> Result<Vec<T>> {
    let asset = DisplayAsset::open(path)?;
    ensure!(asset.metadata["kind"] == kind, "Wrong geometry table kind");
    (0..asset.count).map(|i| asset.record(i)).collect()
}
