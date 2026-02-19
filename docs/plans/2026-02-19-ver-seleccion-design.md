# Ver Selección Design

**Goal:** The "Ver Todas" button in the thumbnail strip dynamically relabels to "Ver Selección" when any table filter is active, and the browse carousel respects all active filters (plate, brand, color, type, date range) when opened.

**Architecture:** Extend the browse API to accept the same brand/color/vehicle-type filter params already used by `/api/all_patents`. The frontend tracks filter state and updates the button label on every filter change. The thumbnail strip itself is unaffected — it always shows the most recent images.

**Tech Stack:** Flask + psycopg2 (backend), vanilla JS (frontend).

---

## What changes

### `db_utils.py`
- Add `brand_filter`, `color_filter`, `vehicle_type_filter` params to `count_browsable_images` and `fetch_browsable_images`.
- Apply them via the same IN-clause + brand-normalization pattern already used in `_build_where_clause` for `all_patents`.

### `app.py`
- In `/api/browse_images`, parse `brand_filter`, `color_filter`, `vehicle_type_filter` from query params (same comma-split logic as `/api/all_patents`) and forward to db_utils.

### `static/script.js`
- Store the "Ver Todas" button in a `let viewAllBtn` variable instead of discarding the reference.
- Add `updateViewAllBtn()`: sets label to "Ver Selección" if any filter is active, "Ver Todas" otherwise.
- Call `updateViewAllBtn()` in `readAllFilters()`, the `clearFiltersButton` handler, and the time-preset handler.
- In `browseLoadPage()` and `browsePrefetch()`, append `brand_filter`, `color_filter`, `vehicle_type_filter` params when they are non-empty.

## What does NOT change
- `fetchLatestThumbnails()` — always fetches latest images regardless of filters.
- The thumbnail images themselves.
- All other modal modes (event mode, browse filter checkboxes).
