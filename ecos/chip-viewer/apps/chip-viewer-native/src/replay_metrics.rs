//! Deltas are bound by the producer to the actual input, never inferred from UI order.
use serde_json::Value;

pub fn comparison(metric: &Value) -> Option<(f64, &str)> {
    let comparison = metric.get("comparison")?;
    let baseline = comparison.get("baseline_value")?.as_f64()?;
    let current = metric.get("value")?.as_f64()?;
    let source = comparison.get("source_step")?.as_str()?;
    let basis = comparison.get("basis_sha256")?.as_str()?;
    if source.is_empty() || basis.len() != 64 || !baseline.is_finite() || !current.is_finite() {
        return None;
    }
    Some((current - baseline, source))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn legacy_and_unbound_values_have_no_inferred_delta() {
        assert_eq!(comparison(&json!({"id":"wns", "value": 0.1})), None);
        assert_eq!(
            comparison(&json!({"value":2,"comparison":{"baseline_value":1}})),
            None
        );
        let value = json!({"value": 5, "comparison": {
            "baseline_value":3, "source_step":"physical_input", "basis_sha256":"a".repeat(64)
        }});
        assert_eq!(comparison(&value), Some((2.0, "physical_input")));
    }
}
