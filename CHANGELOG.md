# Changelog

All notable changes to this project will be documented in this file.

## [1.2.0] - 2026-03-09

### Added

- **Progressive Web App (PWA)** — The app is now installable on mobile and desktop home screens and works fully offline. Uses `vite-plugin-pwa` with Workbox's `generateSW` strategy. App shell assets (~1.3 MB including harfbuzzjs WASM) are precached on first visit; sound effects are runtime-cached on first play to keep the install lightweight. Updates activate automatically on the next page load.

## [1.1.1] - 2026-03-03

### Fixed

- **PDF preview broken** — Upstream PDF-A-go-go renamed its UMD global from `window.flipbook` to `window.pdfagogo`, breaking the preview viewer with "can't access property initializeContainer of undefined".

## [1.1.0] - 2026-02-27

### Added

- **Favicon** — SVG favicon inspired by the classic StuffIt compressed-document icon: a PDF page pinched at the waist with clamp lines on each side. Also displayed in the About dialog.
- **Version number in About and startup dialogs** — Shows `v1.1.0` (read from `package.json` at build time) as a clickable link to the changelog on GitHub, alongside the build date.
- **Changelog linked from README** — Documentation section now links to `CHANGELOG.md`.
- **Large file alert** — Platinum-style alert window (top-right, draggable, auto-dismiss) when dropping large PDFs: friendly nudge at 20 MB, emphatic warning at 50 MB.
- **Inspector HTML report download** — "Download Report" button in the Inspector palette generates a self-contained HTML report with document info, category breakdown, optimization passes, and accessibility traits.
- **Debug Console palette** — The Debug Console is now always available via the Window menu or the status bar Debug button — no page refresh or `?debug` URL param required. Adding `?debug` to the URL still auto-shows it on load. Debug data is always collected.
- **Navigation guard** — Browser warns before navigating away when optimization results exist, preventing accidental loss of work.
- **Pac-Man easter egg** — A monochrome Pac-Man + Blinky ghost animation appears in the menu bar during long-running optimizations (>10 seconds). Enabled by default; toggle in Appearance > Visual Effects. Respects `prefers-reduced-motion`. Add `?pacman` to the URL to activate immediately for testing.
- **Special menu** — Classic Mac Finder-inspired menu with Clean Up Desktop (reset palette positions), Empty Trash (clear results), Restart (reload page), and Shut Down (fade-to-black shutdown sequence).

### Fixed

- **Page content streams excluded from deduplication** — Object dedup no longer merges page content streams. The non-cryptographic hash used for dedup has a small but non-zero collision risk; a collision on a content stream would silently blank a page, and the content integrity guard cannot catch it because dedup relinks refs before deleting (so the dangling-ref check passes). Images, fonts, and other supporting objects are still deduplicated normally.
- **Stream recompression preserves DecodeParms with Predictor** — Streams using PNG/TIFF row prediction (`Predictor 10-15` in DecodeParms) were being corrupted: the pass inflated the data but did not reverse the prediction, then deleted DecodeParms. The viewer couldn't undo the prediction, producing blank pages. DecodeParms is now preserved when the stream uses Predictor, so the viewer can correctly decode the re-deflated data. This was the primary cause of blank pages on large vector-heavy PDFs.
- **Image recompression corruption on ReportLab PDFs** — FlateDecode streams with a non-standard zlib header (`0x48 0x89`, 4KB window size) were silently truncated by `fflate.inflateSync`, producing black bars in the bottom portion of recompressed images. Switched to `decompressSync` (auto-detects zlib/gzip/raw DEFLATE) as the primary decompressor.
- **Content integrity guard now checks page resources** — The post-pipeline integrity check now verifies that each page's XObject, Font, and ExtGState resource refs still resolve, not just content stream refs. Dangling resource refs (e.g., a removed Form XObject) trigger fallback to original bytes, preventing blank pages from missing vector drawings or fonts.
- **Per-pass resource tracking in Debug Console** — When the Debug Console is active, the pipeline snapshots each page's resource refs before and after every pass, reporting which pass introduced dangling refs. Surfaces as "Resource integrity warnings" in the Debug Console.

### Changed

- **Semver versioning** — Project now uses semantic versioning (`package.json` version is the source of truth, injected at build time via `__APP_VERSION__`).
- **"Removed" label clarity** — Inspector items in the "Page Content" category now show "stream merged" instead of "removed", with a tooltip explaining the object was deduplicated rather than deleted.
- **Read Me palette viewport fix** — The Read Me palette no longer overflows below the viewport on smaller screens. Default position lowered; palettes now auto-clamp to viewport bounds after content is set.
- **Main window focus on drag** — Dragging files onto the page brings the main window to the front, ensuring the drop zone is visible above any palettes.

## [1.0.0] - 2026-02-19

### Changed

- **Font subsetting off by default** — Font subsetting is off by default across all presets. A rendering issue with cmap-less CIDFontType2 fonts and already-subsetted simple fonts has been fixed (GID-based subsetting for cmap-less fonts, skip re-subsetting simple fonts with subset prefixes), but we continue to monitor for edge cases. Users can enable font subsetting in Advanced Settings.
- **Preset hint text updated** — Lossless preset hint no longer references font subsetting.

### Added

- **Max Compress preset** — New optimization preset for maximum file size reduction. Uses lossy JPEG at 50% quality with a 72 DPI cap. Available as a fourth tab alongside Lossless, Web, and Print.
- **Settings encoded in download filename** — Download filenames now include the optimization settings and date (e.g. `report_lossless_20260219.pdf` or `report_lossy-q75-150dpi_20260219.pdf`).
- **Startup warning dialog** — A one-time warning dialog explains the tool is experimental and that font subsetting is off by default. Includes "Don't show this again" checkbox (localStorage). Accessible via "Learn more" link in Advanced Settings.
- **Font subsetting fixes** — Fixed invisible text when re-subsetting Type0/CIDFontType2 fonts that lack a `cmap` table (uses GID-based subsetting via `hb_subset_input_glyph_set`). Simple fonts with subset prefixes (`ABCDEF+`) are skipped to prevent glyph corruption.
- **CHANGELOG.md** — This file, tracking notable changes going forward.
