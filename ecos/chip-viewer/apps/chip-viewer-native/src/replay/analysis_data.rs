//! Expand compact Replay object IDs against shared name tables.
use crate::replay::data::{read, Recording};
use anyhow::{ensure, Context, Result};
use chipgeom_format::replay_analysis::Analysis;

/// Helper RCX runs for clock timing are not the owning step's RCX result.
pub(super) fn belongs_to_step(step: &str, kind: &str) -> bool {
    kind != "rcx" || step.eq_ignore_ascii_case("RCX")
}

pub fn load(record: &Recording) -> Result<Analysis> {
    let Some(path) = &record.manifest.analysis else {
        return Ok(Analysis::default());
    };
    let path = record.asset(path)?;
    let mut data: Analysis = read(&path)?;
    data.views
        .retain(|view| belongs_to_step(&record.manifest.step, &view.kind));
    expand_references(&mut data)?;
    if data.geometry_display {
        super::geometry_analysis::append(record, &mut data)?;
    }
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

    #[test]
    fn same_rcx_report_only_adds_views_and_time_to_its_own_step() {
        let fixture = crate::replay::data::tests::Fixture::new();
        fixture.write(
            "attempts/a/index.json",
            serde_json::json!({
                "schema":"ecos.replay.analysis.v2", "views":[
                    {"kind":"rcx", "label":"TYPICAL SPEF extraction", "basis":"final", "items":[]}
                ]
            }),
        );
        let mut record = fixture.open();
        record.manifest.analysis = Some("index.json".into());
        record.manifest.step = "RCX".into();
        assert_eq!(load(&record).unwrap().views.len(), 1);
        assert_eq!(
            duration(&record).unwrap(),
            super::super::rcx::CORNER_SECONDS
        );
        record.manifest.step = "filler".into();
        assert!(load(&record).unwrap().views.is_empty());
        assert_eq!(duration(&record).unwrap(), 0.0);
    }
}

pub fn duration(record: &Recording) -> Result<f64> {
    let Some(path) = &record.manifest.analysis else {
        return Ok(0.0);
    };
    let index: Analysis = read(&record.asset(path)?)?;
    if index.geometry_display {
        super::geometry_analysis::duration(record)
    } else {
        Ok(super::analysis::ReplayAnalysis::open(record).duration())
    }
}
