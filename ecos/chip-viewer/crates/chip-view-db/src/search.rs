use std::borrow::Cow;

use super::*;

/// Unique matching shape IDs, capped at the requested limit.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct BoundedShapeSearch {
    pub shape_ids: Vec<ShapeId>,
    /// At least one additional matching shape was found.
    pub truncated: bool,
}

impl ChipViewDb {
    /// Searches owner names, including aliases. Returns `None` when cancelled.
    pub fn query_owner_name_pattern_bounded(
        &self,
        pattern: &Regex,
        owner_types: Option<&[OwnerType]>,
        limit: usize,
        is_current: impl Fn() -> bool,
    ) -> Option<BoundedShapeSearch> {
        self.search_shapes(
            NameSearch::Pattern(pattern),
            owner_types,
            limit,
            &is_current,
        )
    }

    /// Searches pin and connected net shapes. Returns `None` when cancelled.
    pub fn query_pin_name_bounded(
        &self,
        pin_name: &str,
        limit: usize,
        is_current: &(impl Fn() -> bool + Sync),
    ) -> Option<BoundedShapeSearch> {
        let endpoints = self.connectivity_metadata();
        let mut names = BTreeSet::new();
        let connectivity = self.connectivity_index.get();
        let indices = connectivity.and_then(|index| index.indices_for_pin(pin_name));
        let candidate_indices = indices.into_iter().flatten().copied().chain(
            connectivity
                .is_none()
                .then_some(0..endpoints.len())
                .into_iter()
                .flatten(),
        );
        for (index, endpoint_index) in candidate_indices.enumerate() {
            check_current(index, is_current)?;
            let endpoint = &endpoints[endpoint_index];
            if connectivity.is_none() && !endpoint_matches_pin(endpoint, pin_name) {
                continue;
            }
            names.extend([
                Cow::Borrowed(endpoint.pin_name.as_str()),
                Cow::Borrowed(endpoint.net_name.as_str()),
            ]);
            if !endpoint.instance_name.is_empty() && !endpoint.pin_name.is_empty() {
                names.insert(Cow::Owned(format!(
                    "{}/{}",
                    endpoint.instance_name, endpoint.pin_name
                )));
            }
        }

        let result = self.search_shapes(NameSearch::Exact(&names), None, limit, is_current)?;
        if result.truncated || !result.shape_ids.is_empty() {
            return Some(result);
        }
        let names = name_and_local_name(pin_name).map(Cow::Borrowed).collect();
        self.search_shapes(NameSearch::Exact(&names), None, limit, is_current)
    }

    /// Searches shapes for a bus and its members. Returns `None` when cancelled.
    pub fn query_bus_name_bounded(
        &self,
        bus_name: &str,
        limit: usize,
        is_current: &(impl Fn() -> bool + Sync),
    ) -> Option<BoundedShapeSearch> {
        let Some(bus) = find_named(self.bus_metadata(), |bus| bus.name == bus_name, is_current)?
        else {
            return Some(BoundedShapeSearch::default());
        };
        let mut names = BTreeSet::new();
        for (index, name) in bus.net_names.iter().chain(&bus.pin_names).enumerate() {
            check_current(index, is_current)?;
            names.extend(name_and_local_name(name).map(Cow::Borrowed));
        }
        let result = self.search_shapes(NameSearch::Exact(&names), None, limit, is_current)?;
        if result.truncated || !result.shape_ids.is_empty() {
            return Some(result);
        }
        let names = BTreeSet::from([Cow::Borrowed(bus_name)]);
        self.search_shapes(NameSearch::Exact(&names), None, limit, is_current)
    }

    /// Searches shapes for a group's instances and region. Returns `None` when cancelled.
    pub fn query_group_name_bounded(
        &self,
        group_name: &str,
        limit: usize,
        is_current: &(impl Fn() -> bool + Sync),
    ) -> Option<BoundedShapeSearch> {
        let Some(group) = find_named(
            self.group_metadata(),
            |group| group.name == group_name,
            is_current,
        )?
        else {
            return Some(BoundedShapeSearch::default());
        };
        let mut names = BTreeSet::from([Cow::Borrowed(group.region_name.as_str())]);
        for (index, name) in group.instance_names.iter().enumerate() {
            check_current(index, is_current)?;
            names.insert(Cow::Borrowed(name.as_str()));
        }
        self.search_shapes(NameSearch::Exact(&names), None, limit, is_current)
    }

    fn search_shapes(
        &self,
        search: NameSearch<'_>,
        owner_types: Option<&[OwnerType]>,
        limit: usize,
        is_current: &impl Fn() -> bool,
    ) -> Option<BoundedShapeSearch> {
        let allows_shape = |shape_id| {
            owner_types.is_none_or(|types| {
                self.find_shape(shape_id)
                    .and_then(|shape| self.owner_for_shape(shape))
                    .and_then(|owner| OwnerType::from_raw(owner.owner_type))
                    .is_some_and(|owner_type| types.contains(&owner_type))
            })
        };
        let mut results = SearchResults::new(limit);
        if let Some(lookup) = self
            .name_index
            .get()
            .and_then(|index| index.owner_shapes.get())
        {
            let mut add_matches = |shape_ids: &[ShapeId]| -> Option<bool> {
                for (index, &id) in shape_ids.iter().enumerate() {
                    check_current(index, is_current)?;
                    if allows_shape(id) && results.insert(id) {
                        return Some(true);
                    }
                }
                Some(false)
            };
            match search {
                NameSearch::Pattern(pattern) => {
                    for (index, (name, shape_ids)) in lookup.by_name.iter().enumerate() {
                        check_current(index, is_current)?;
                        if pattern.is_match(name) && add_matches(shape_ids)? {
                            break;
                        }
                    }
                }
                NameSearch::Exact(names) => {
                    for (index, name) in names.iter().enumerate() {
                        check_current(index, is_current)?;
                        if name.is_empty() {
                            continue;
                        }
                        if let Some(shape_ids) = lookup.by_name.get(name.as_ref()) {
                            if add_matches(shape_ids)? {
                                break;
                            }
                        }
                    }
                }
            }
        } else {
            // Query the mapped data directly while the optional lookup is cold.
            // Its full build sorts and copies live shape IDs, which would delay cancellation.
            let mut matching_owners = HashSet::new();
            for (index, record) in self.snapshot.name_records().iter().enumerate() {
                check_current(index, is_current)?;
                if record.owner_type != OwnerType::None as u8
                    && self
                        .snapshot
                        .owner_name(record)
                        .is_some_and(|name| search.matches(name))
                {
                    matching_owners.insert((record.owner_type, record.owner_id));
                }
            }
            if !matching_owners.is_empty() {
                for (index, shape) in self.snapshot.shapes().iter().enumerate() {
                    check_current(index, is_current)?;
                    if shape.state == ShapeState::Alive as u8
                        && self.owner_for_shape(shape).is_some_and(|owner| {
                            matching_owners.contains(&(owner.owner_type, owner.owner_id))
                        })
                        && allows_shape(shape.id)
                        && results.insert(shape.id)
                    {
                        break;
                    }
                }
            }
        }
        results.finish(is_current)
    }
}

enum NameSearch<'a> {
    Pattern(&'a Regex),
    Exact(&'a BTreeSet<Cow<'a, str>>),
}

impl NameSearch<'_> {
    fn matches(&self, name: &str) -> bool {
        match self {
            Self::Pattern(pattern) => pattern.is_match(name),
            Self::Exact(names) => !name.is_empty() && names.contains(name),
        }
    }
}

fn name_and_local_name(name: &str) -> impl Iterator<Item = &str> {
    std::iter::once(name).chain(name.rsplit_once('/').map(|(_, local)| local))
}

fn check_current(index: usize, is_current: &impl Fn() -> bool) -> Option<()> {
    (!index.is_multiple_of(256) || is_current()).then_some(())
}

fn find_named<'a, T>(
    items: &'a [T],
    matches: impl Fn(&T) -> bool,
    is_current: &impl Fn() -> bool,
) -> Option<Option<&'a T>> {
    for (index, item) in items.iter().enumerate() {
        check_current(index, is_current)?;
        if matches(item) {
            return Some(Some(item));
        }
    }
    is_current().then_some(None)
}

struct SearchResults {
    ids: BTreeSet<ShapeId>,
    limit: usize,
    truncated: bool,
}

impl SearchResults {
    fn new(limit: usize) -> Self {
        Self {
            ids: BTreeSet::new(),
            limit,
            truncated: false,
        }
    }

    fn insert(&mut self, id: ShapeId) -> bool {
        if self.ids.len() < self.limit {
            self.ids.insert(id);
        } else if !self.ids.contains(&id) {
            self.truncated = true;
        }
        self.truncated
    }

    fn finish(self, is_current: &impl Fn() -> bool) -> Option<BoundedShapeSearch> {
        is_current().then(|| BoundedShapeSearch {
            shape_ids: self.ids.into_iter().collect(),
            truncated: self.truncated,
        })
    }
}
