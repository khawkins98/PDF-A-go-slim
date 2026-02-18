# Benchmark Results

Generated: 2026-02-18 20:17:42 UTC  
Node: v22.22.0  
Platform: linux x64

## Summary

| Benchmark | Input | Output | Saved | Time |
|-----------|-------|--------|-------|------|
| Illustrator-style bloat | 13.4 KB | 1.3 KB | 90.4% | 36ms |
| Photo-heavy (lossless) | 380.0 KB | 378.2 KB | 0.5% | 41ms |
| Photo-heavy (lossy q=75) | 380.0 KB | 30.9 KB | 91.9% | 182ms |
| Photo-heavy (lossy q=75, 150dpi) | 380.0 KB | 23.1 KB | 93.9% | 140ms |
| Tagged accessible PDF | 5.8 KB | 1.2 KB | 78.8% | 5ms |
| PDF/A-1b document | 10.2 KB | 3.2 KB | 68.3% | 4ms |
| Multi-font duplicates | 8.2 KB | 1.7 KB | 79.4% | 17ms |
| Kitchen sink (lossless) | 156.0 KB | 139.8 KB | 10.4% | 14ms |
| Kitchen sink (lossy q=75) | 156.0 KB | 20.1 KB | 87.1% | 81ms |

## Illustrator-style bloat

**Input:** 13.4 KB | **Output:** 1.3 KB | **Saved:** 90.4% (12.1 KB) | **Time:** 36ms
**Detected traits:** None

### Pass results

| Pass | Result | Time |
|------|--------|------|
| Recompressing streams | 9 recompressed, 18 skipped | 17ms |
| Recompressing images | 0 converted | 0ms |
| Unembedding standard fonts | 2 unembedded | 1ms |
| Subsetting fonts | 0 subsetted | 0ms |
| Deduplicating objects | 3 deduplicated | 1ms |
| Deduplicating fonts | 0 deduplicated | 0ms |
| Stripping metadata | 7 stripped | 1ms |
| Removing unreferenced objects | 8 removed | 0ms |

### Object breakdown

| Metric | Before | After |
|--------|--------|-------|
| Objects | 27 | 11 |
| Total stream size | 9.8 KB | 137 B |
| Fonts | 6 obj, 1.0 KB | 2 obj, 0 B |
| Metadata | 1 obj, 3.6 KB | 0 obj, 0 B |
| Document Structure | 3 obj, 0 B | 3 obj, 0 B |
| Other Data | 17 obj, 5.2 KB | 6 obj, 137 B |

## Photo-heavy (lossless)

**Input:** 380.0 KB | **Output:** 378.2 KB | **Saved:** 0.5% (1.8 KB) | **Time:** 41ms
**Detected traits:** None

### Pass results

| Pass | Result | Time |
|------|--------|------|
| Recompressing streams | 3 recompressed, 8 skipped | 32ms |
| Recompressing images | 0 converted | 0ms |
| Unembedding standard fonts | 0 unembedded | 0ms |
| Subsetting fonts | 0 subsetted | 0ms |
| Deduplicating objects | 0 deduplicated | 3ms |
| Deduplicating fonts | 0 deduplicated | 0ms |
| Stripping metadata | 0 stripped | 0ms |
| Removing unreferenced objects | 0 removed | 0ms |

### Object breakdown

| Metric | Before | After |
|--------|--------|-------|
| Objects | 11 | 11 |
| Total stream size | 378.0 KB | 376.7 KB |
| Images | 4 obj, 377.9 KB | 4 obj, 376.6 KB |
| Document Structure | 4 obj, 0 B | 4 obj, 0 B |
| Other Data | 3 obj, 64 B | 3 obj, 64 B |

## Photo-heavy (lossy q=75)

**Input:** 380.0 KB | **Output:** 30.9 KB | **Saved:** 91.9% (349.1 KB) | **Time:** 182ms
**Detected traits:** None

### Pass results

| Pass | Result | Time |
|------|--------|------|
| Recompressing streams | 3 recompressed, 8 skipped | 18ms |
| Recompressing images | 4 converted | 160ms |
| Unembedding standard fonts | 0 unembedded | 0ms |
| Subsetting fonts | 0 subsetted | 0ms |
| Deduplicating objects | 0 deduplicated | 0ms |
| Deduplicating fonts | 0 deduplicated | 0ms |
| Stripping metadata | 0 stripped | 1ms |
| Removing unreferenced objects | 0 removed | 0ms |

### Object breakdown

| Metric | Before | After |
|--------|--------|-------|
| Objects | 11 | 11 |
| Total stream size | 378.0 KB | 29.4 KB |
| Images | 4 obj, 377.9 KB | 4 obj, 29.3 KB |
| Document Structure | 4 obj, 0 B | 4 obj, 0 B |
| Other Data | 3 obj, 64 B | 3 obj, 64 B |

## Photo-heavy (lossy q=75, 150dpi)

**Input:** 380.0 KB | **Output:** 23.1 KB | **Saved:** 93.9% (356.9 KB) | **Time:** 140ms
**Detected traits:** None

### Pass results

| Pass | Result | Time |
|------|--------|------|
| Recompressing streams | 3 recompressed, 8 skipped | 26ms |
| Recompressing images | 4 converted, 1 downsampled | 110ms |
| Unembedding standard fonts | 0 unembedded | 1ms |
| Subsetting fonts | 0 subsetted | 0ms |
| Deduplicating objects | 0 deduplicated | 0ms |
| Deduplicating fonts | 0 deduplicated | 0ms |
| Stripping metadata | 0 stripped | 0ms |
| Removing unreferenced objects | 0 removed | 0ms |

### Object breakdown

| Metric | Before | After |
|--------|--------|-------|
| Objects | 11 | 11 |
| Total stream size | 378.0 KB | 21.6 KB |
| Images | 4 obj, 377.9 KB | 4 obj, 21.5 KB |
| Document Structure | 4 obj, 0 B | 4 obj, 0 B |
| Other Data | 3 obj, 64 B | 3 obj, 64 B |

## Tagged accessible PDF

**Input:** 5.8 KB | **Output:** 1.2 KB | **Saved:** 78.8% (4.6 KB) | **Time:** 5ms
**Detected traits:** Tagged, StructTree, Lang=en-US

### Pass results

| Pass | Result | Time |
|------|--------|------|
| Recompressing streams | 3 recompressed, 13 skipped | 2ms |
| Recompressing images | 0 converted | 0ms |
| Unembedding standard fonts | 1 unembedded | 0ms |
| Subsetting fonts | 0 subsetted | 0ms |
| Deduplicating objects | 0 deduplicated | 0ms |
| Deduplicating fonts | 0 deduplicated | 0ms |
| Stripping metadata | 0 stripped | 0ms |
| Removing unreferenced objects | 1 removed | 0ms |

### Object breakdown

| Metric | Before | After |
|--------|--------|-------|
| Objects | 16 | 13 |
| Total stream size | 3.7 KB | 208 B |
| Fonts | 3 obj, 515 B | 1 obj, 0 B |
| Document Structure | 3 obj, 0 B | 3 obj, 0 B |
| Other Data | 10 obj, 3.1 KB | 9 obj, 208 B |

## PDF/A-1b document

**Input:** 10.2 KB | **Output:** 3.2 KB | **Saved:** 68.3% (7.0 KB) | **Time:** 4ms
**Detected traits:** PDF/A-1B

### Pass results

| Pass | Result | Time |
|------|--------|------|
| Recompressing streams | 5 recompressed, 10 skipped | 2ms |
| Recompressing images | 0 converted | 0ms |
| Unembedding standard fonts | 0 unembedded, PDF/A skipped | 0ms |
| Subsetting fonts | 0 subsetted | 0ms |
| Deduplicating objects | 1 deduplicated | 0ms |
| Deduplicating fonts | 0 deduplicated | 1ms |
| Stripping metadata | 1 stripped, XMP preserved | 0ms |
| Removing unreferenced objects | 1 removed | 0ms |

### Object breakdown

| Metric | Before | After |
|--------|--------|-------|
| Objects | 15 | 13 |
| Total stream size | 7.8 KB | 973 B |
| Fonts | 3 obj, 515 B | 3 obj, 515 B |
| Metadata | 1 obj, 490 B | 1 obj, 299 B |
| Document Structure | 3 obj, 0 B | 3 obj, 0 B |
| Other Data | 8 obj, 6.9 KB | 6 obj, 159 B |

## Multi-font duplicates

**Input:** 8.2 KB | **Output:** 1.7 KB | **Saved:** 79.4% (6.5 KB) | **Time:** 17ms
**Detected traits:** None

### Pass results

| Pass | Result | Time |
|------|--------|------|
| Recompressing streams | 1 recompressed, 28 skipped | 13ms |
| Recompressing images | 0 converted | 0ms |
| Unembedding standard fonts | 1 skipped, 6 unembedded | 0ms |
| Subsetting fonts | 0 subsetted | 0ms |
| Deduplicating objects | 0 deduplicated | 0ms |
| Deduplicating fonts | 0 deduplicated | 0ms |
| Stripping metadata | 1 stripped | 0ms |
| Removing unreferenced objects | 0 removed | 0ms |

### Object breakdown

| Metric | Before | After |
|--------|--------|-------|
| Objects | 29 | 16 |
| Total stream size | 3.7 KB | 489 B |
| Fonts | 21 obj, 3.4 KB | 9 obj, 393 B |
| Metadata | 1 obj, 192 B | 0 obj, 0 B |
| Document Structure | 3 obj, 0 B | 3 obj, 0 B |
| Other Data | 4 obj, 96 B | 4 obj, 96 B |

## Kitchen sink (lossless)

**Input:** 156.0 KB | **Output:** 139.8 KB | **Saved:** 10.4% (16.2 KB) | **Time:** 14ms
**Detected traits:** Tagged, StructTree, Lang=en-US

### Pass results

| Pass | Result | Time |
|------|--------|------|
| Recompressing streams | 15 recompressed, 34 skipped | 9ms |
| Recompressing images | 0 converted | 0ms |
| Unembedding standard fonts | 4 unembedded | 0ms |
| Subsetting fonts | 0 subsetted | 1ms |
| Deduplicating objects | 8 deduplicated | 0ms |
| Deduplicating fonts | 0 deduplicated | 0ms |
| Stripping metadata | 13 stripped | 0ms |
| Removing unreferenced objects | 8 removed | 0ms |

### Object breakdown

| Metric | Before | After |
|--------|--------|-------|
| Objects | 49 | 24 |
| Total stream size | 149.5 KB | 138.0 KB |
| Fonts | 12 obj, 2.0 KB | 4 obj, 0 B |
| Images | 2 obj, 137.9 KB | 2 obj, 137.8 KB |
| Metadata | 1 obj, 2.3 KB | 0 obj, 0 B |
| Document Structure | 6 obj, 0 B | 6 obj, 0 B |
| Other Data | 28 obj, 7.4 KB | 12 obj, 137 B |

## Kitchen sink (lossy q=75)

**Input:** 156.0 KB | **Output:** 20.1 KB | **Saved:** 87.1% (135.9 KB) | **Time:** 81ms
**Detected traits:** Tagged, StructTree, Lang=en-US

### Pass results

| Pass | Result | Time |
|------|--------|------|
| Recompressing streams | 15 recompressed, 34 skipped | 8ms |
| Recompressing images | 2 converted | 70ms |
| Unembedding standard fonts | 4 unembedded | 0ms |
| Subsetting fonts | 0 subsetted | 0ms |
| Deduplicating objects | 8 deduplicated | 0ms |
| Deduplicating fonts | 0 deduplicated | 0ms |
| Stripping metadata | 13 stripped | 0ms |
| Removing unreferenced objects | 8 removed | 0ms |

### Object breakdown

| Metric | Before | After |
|--------|--------|-------|
| Objects | 49 | 24 |
| Total stream size | 149.5 KB | 18.3 KB |
| Fonts | 12 obj, 2.0 KB | 4 obj, 0 B |
| Images | 2 obj, 137.9 KB | 2 obj, 18.2 KB |
| Metadata | 1 obj, 2.3 KB | 0 obj, 0 B |
| Document Structure | 6 obj, 0 B | 6 obj, 0 B |
| Other Data | 28 obj, 7.4 KB | 12 obj, 137 B |
