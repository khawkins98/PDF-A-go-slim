# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Changed

- **Font subsetting disabled by default** — Font subsetting has been temporarily disabled across all presets due to a rendering issue that can cause text to become visually invisible in some PDFs. The text remains present and copyable but may not render visually. Users can still enable font subsetting manually via Advanced Settings. We are actively investigating a fix.
- **Preset hint text updated** — Lossless preset hint no longer references font subsetting.

### Added

- **Super Compress preset** — New optimization preset designed for maximum file size reduction, ideal for feeding PDFs to AI tools. Uses lossy JPEG at 50% quality with a 72 DPI cap. Available as a fourth tab alongside Lossless, Web, and Print.
- **Optimization metadata in output PDFs** — Optimized PDFs now carry provenance metadata in the PDF Info dictionary: tool name (`OptimizedBy`), settings used (`OptimizationSettings`), and processing timestamp (`OptimizationDate`). This allows downstream consumers to identify how a PDF was optimized.
- **Startup notice dialog** — A one-time notice dialog informs users that font subsetting is disabled by default and introduces the Super Compress preset. Dismissed per session; accessible via "Learn more" link in the Advanced Settings panel.
- **CHANGELOG.md** — This file, tracking notable changes going forward.
