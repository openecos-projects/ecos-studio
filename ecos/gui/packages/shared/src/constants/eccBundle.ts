/**
 * Identity of the ECC runtime bundle the app expects.
 *
 * The value tracks the ecc package version the release pipeline publishes to
 * the resource registry (`tool:ecc`). The release pipeline is expected to
 * generate/verify this constant; it is pinned here until that pipeline lands.
 */
export const EXPECTED_ECC_BUNDLE_VERSION = '0.1.0-alpha.12'

/** Registry resource id under which the ECC bundle is published. */
export const ECC_BUNDLE_RESOURCE_ID = 'tool:ecc'
