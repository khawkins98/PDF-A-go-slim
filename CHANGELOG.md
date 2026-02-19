# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Changed

- **Font subsetting off by default** — Font subsetting is off by default across all presets. A rendering issue with cmap-less CIDFontType2 fonts and already-subsetted simple fonts has been fixed (GID-based subsetting for cmap-less fonts, skip re-subsetting simple fonts with subset prefixes), but we continue to monitor for edge cases. Users can enable font subsetting in Advanced Settings.
- **Preset hint text updated** — Lossless preset hint no longer references font subsetting.

### Added

- **Max Compress preset** — New optimization preset for maximum file size reduction. Uses lossy JPEG at 50% quality with a 72 DPI cap. Available as a fourth tab alongside Lossless, Web, and Print.
- **Settings encoded in download filename** — Download filenames now include the optimization settings and date (e.g. `report_lossless_20260219.pdf` or `report_lossy-q75-150dpi_20260219.pdf`).
- **Startup warning dialog** — A one-time warning dialog explains the tool is experimental and that font subsetting is off by default. Includes "Don't show this again" checkbox (localStorage). Accessible via "Learn more" link in Advanced Settings.
- **Font subsetting fixes** — Fixed invisible text when re-subsetting Type0/CIDFontType2 fonts that lack a `cmap` table (uses GID-based subsetting via `hb_subset_input_glyph_set`). Simple fonts with subset prefixes (`ABCDEF+`) are skipped to prevent glyph corruption.
- **CHANGELOG.md** — This file, tracking notable changes going forward.
