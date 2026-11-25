# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.0] - 2026-11-23

### Added
- Added the `loadData(adapter)` method and the `FormatAdapter` ingestion contract.

### Changed
- Refactored `withView()`.
- Deprecated `assertNotBorrowed()`.

## [1.3.1] - 2026-11-19

### Added
- Added the `borrowed` field to the internal `Metadata` structure.

### Changed
- `extractMetadata()` now decodes the `borrowed` flag.
- Refactored `withView()` from a multi-pass to a single-pass borrow algorithm.

## [1.3.0] - 2026-11-19

### Added
- `shrink()` method ([#5](https://github.com/AugustoVasques75/balloc/issues/5)).

### Changed
- `withView()` now supports multiple blocks ([#6](https://github.com/AugustoVasques75/balloc/issues/6)).

### Fixed
- Removed extraneous sections from API documentation.

## [1.2.0]

### Added
- `withView()` method ([#3](https://github.com/AugustoVasques75/balloc/issues/3)).
- `indexOf()` method ([#1](https://github.com/AugustoVasques75/balloc/issues/1)).
- `lastIndexOf()` method.
- `isFull()` method ([#2](https://github.com/AugustoVasques75/balloc/issues/2)).

### Fixed
- Duplicate memory allocation in constructor ([#4](https://github.com/AugustoVasques75/balloc/issues/4)).
- Typos in documentation.
