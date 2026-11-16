//! Decode extensible geometry without serde flatten's intermediate value tree.
use crate::replay::{Object, Orientation};
use serde::de::{self, MapAccess, Visitor};
use serde::{Deserialize, Deserializer};
use std::collections::BTreeMap;

#[derive(Deserialize)]
#[serde(field_identifier, rename_all = "lowercase")]
enum Key {
    Kind,
    Bbox,
    Name,
    Layer,
    Master,
    Orient,
    Attribute(String),
}

impl<'de> Deserialize<'de> for Object {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct ObjectVisitor;
        impl<'de> Visitor<'de> for ObjectVisitor {
            type Value = Object;
            fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
                formatter.write_str("a Replay geometry object")
            }
            fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Object, A::Error> {
                let (mut kind, mut bbox, mut name, mut layer, mut master) =
                    (None, None, None, None, None);
                let mut orient: Option<Option<Orientation>> = None;
                let mut attributes = BTreeMap::new();
                while let Some(key) = map.next_key::<Key>()? {
                    match key {
                        Key::Kind => field(&mut map, &mut kind, "kind")?,
                        Key::Bbox => field(&mut map, &mut bbox, "bbox")?,
                        Key::Name => field(&mut map, &mut name, "name")?,
                        Key::Layer => field(&mut map, &mut layer, "layer")?,
                        Key::Master => field(&mut map, &mut master, "master")?,
                        Key::Orient => field(&mut map, &mut orient, "orient")?,
                        Key::Attribute(key) => {
                            attributes.insert(key, map.next_value()?);
                        }
                    }
                }
                Ok(Object {
                    kind: kind.ok_or_else(|| de::Error::missing_field("kind"))?,
                    bbox: bbox.ok_or_else(|| de::Error::missing_field("bbox"))?,
                    name: name.unwrap_or_default(),
                    layer: layer.unwrap_or_default(),
                    master: master.unwrap_or_default(),
                    orient: orient.unwrap_or_default(),
                    attributes,
                })
            }
        }
        deserializer.deserialize_map(ObjectVisitor)
    }
}

fn field<'de, A: MapAccess<'de>, T: Deserialize<'de>>(
    map: &mut A,
    slot: &mut Option<T>,
    name: &'static str,
) -> Result<(), A::Error> {
    if slot.is_some() {
        return Err(de::Error::duplicate_field(name));
    }
    *slot = Some(map.next_value()?);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn geometry_extensions_and_legacy_defaults_round_trip() {
        for orient in [json!(null), json!(0), json!("R180")] {
            let data = json!({
                "kind":"instance", "bbox":[-20,0,5,30], "orient":orient,
                "placed":false,"pins":{"A":{"net":"clk","position":[-10,12]}},
                "future":{"nested":[1,null,"x"],"value":0.125}
            });
            let object: Object = serde_json::from_value(data.clone()).unwrap();
            let mut expected = data;
            for key in ["name", "layer", "master"] {
                expected[key] = json!("");
            }
            assert_eq!(serde_json::to_value(object).unwrap(), expected);
        }
    }

    #[test]
    fn malformed_and_duplicate_known_fields_still_fail() {
        for data in [
            r#"{"kind":"wire"}"#,
            r#"{"kind":"wire","bbox":[0,1,2]}"#,
            r#"{"kind":"wire","bbox":[0,1,2,3],"name":null}"#,
            r#"{"kind":"wire","kind":"via","bbox":[0,1,2,3]}"#,
            r#"{"kind":"wire","bbox":[0,1,2,3],"orient":null,"orient":0}"#,
        ] {
            assert!(serde_json::from_str::<Object>(data).is_err(), "{data}");
        }
    }
}
