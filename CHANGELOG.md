# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.1.4] - 2026-09-13

### Security

- Bumped `vitest`/`@vitest/coverage-v8` to 4.1.11, resolving **GHSA-82fw-gwwq-j7x9** (a stale
  transitive `@vitest/mocker`).
- Raised the `fast-uri` override from 3.1.5 to 3.1.7, resolving **GHSA-5jgf-p345-68v8**,
  **GHSA-f65p-4m7j-42xc**, **GHSA-fph4-wmhf-6fwf**, **GHSA-jqff-g426-hqxp** (all HIGH). Both
  bumps stay within existing major/minor ranges; `osv-scanner` reports no issues beyond the
  already-waived `image-size`/`xlsx` findings in `osv-scanner.toml`.
- Renewed the `xlsx` osv-scanner waivers for another 90 days (new expiry 2026-11-13). SheetJS's
  CDN still ships 0.20.3, already past both advisories' fix ranges — the findings remain an OSV
  structured-range artifact of xlsx being CDN-only, so there is nothing to bump to.

### Changed

- Bumped Biome to 2.5.8 and migrated `biome.json` off the deprecated `rules.recommended` field
  to the `preset` key it is replaced by (required before the next Biome major drops
  `recommended` outright). Biome 2.5 also started linting standalone `.svg` files; build-copied
  static assets under `public/` are now excluded via `files.includes` rather than silenced.
- Bumped the transitive `browserslist` dependency (4.28.2 -> 4.28.9).
