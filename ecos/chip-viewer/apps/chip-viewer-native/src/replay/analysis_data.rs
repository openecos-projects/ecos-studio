//! Expand compact Replay object IDs against shared name tables.
use crate::replay::data::{read, Recording};
use anyhow::{ensure, Context, Result};
use chipgeom_format::replay_analysis::Analysis;

pub fn load(record: &Recording) -> Result<Analysis> {
    let Some(path) = &record.manifest.analysis else {
        return Ok(Analysis::default());
    };
    let path = record.asset(path)?;
    let mut data: Analysis = read(&path)?;
    expand_references(&mut data)?;
    Ok(data)
}

pub fn expand_references(data: &mut Analysis) -> Result<()> {
    ensure!(
        matches!(
            data.schema.as_str(),
            "ecos.replay.analysis.v1" | "ecos.replay.analysis.v2"
        ),
        "Unsupported analysis schema"
    );
    for view in &mut data.views {
        for item in &mut view.items {
            ensure!(
                item.net_ref.is_none() || item.instance_ref.is_none(),
                "Ambiguous analysis reference"
            );
            if let Some(index) = item.net_ref {
                let name = data
                    .nets
                    .get(index)
                    .context("Invalid analysis net reference")?;
                item.label = name.clone();
                item.nets = vec![name.clone()];
            }
            if let Some(index) = item.instance_ref {
                let name = data
                    .instances
                    .get(index)
                    .context("Invalid analysis instance reference")?;
                item.label = name.clone();
                item.instances = vec![name.clone()];
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn compact_references_preserve_names_and_reject_invalid_ids() {
        let mut data: Analysis = serde_json::from_value(serde_json::json!({
            "schema":"ecos.replay.analysis.v2","nets":["clk"],"instances":["u"],
            "views":[{"label":"v","kind":"rcx","basis":"final","items":[{"net_ref":0,"value":1.0},{"instance_ref":0,"value":2.0}]}]
        })).unwrap();
        expand_references(&mut data).unwrap();
        assert_eq!(data.views[0].items[0].nets, ["clk"]);
        assert_eq!(data.views[0].items[1].instances, ["u"]);
        data.views[0].items[0].net_ref = Some(1);
        assert!(expand_references(&mut data).is_err());
    }
}
