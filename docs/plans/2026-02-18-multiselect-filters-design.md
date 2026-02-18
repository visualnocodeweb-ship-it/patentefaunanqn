# Multi-Select Dropdown Filters Design

**Date:** 2026-02-18
**Branch:** audit-remediation
**Scope:** Replace Marca and Tipo text inputs with custom multi-select dropdowns. Add a new Color multi-select dropdown. All options populated from DB DISTINCT values.

---

## Requirements

- Marca, Color, and Tipo filters become dropdown multi-select components.
- Options fetched from DB DISTINCT values (normalized for brand).
- Selecting multiple values → OR logic (`WHERE vehicle_brand IN ('Toyota', 'Ford')`).
- Color filter is new (no existing filter for it).
- Selecting no values = no filter applied (same as before).
- "Limpiar" button resets all dropdowns.
- URL state (query params) preserved across page reload.

---

## Backend

### New endpoint: `GET /api/filter_options`

Returns unique sorted values for all three filter dimensions:

```json
{
  "brands": ["Chevrolet", "Ford", "Toyota"],
  "colors": ["Blanco", "Negro", "Rojo"],
  "types":  ["Auto", "Camioneta", "Moto"]
}
```

- One `SELECT DISTINCT` per column on `detection_events`.
- Brand values run through `normalize_vehicle_brand`.
- Deduplication after normalization (set → sorted list).
- NULLs and empty strings excluded.
- Simple in-process cache: result stored with timestamp, invalidated after 300 seconds.

### Modified filtering: `_build_where_clause`

| Param | Old behaviour | New behaviour |
|-------|--------------|---------------|
| `brand_filter` | `ILIKE %value%` (partial match) | `IN (...)` (exact, multiple) |
| `type_filter` | `ILIKE %value%` (partial match) | `IN (...)` (exact, multiple) |
| `color_filter` | not implemented | `IN (...)` (new) |

API params are comma-separated strings: `brand_filter=Toyota,Ford`. Empty string = param absent = no filter.

`fetch_all_patents_paginated` gains a `color_filter` parameter.

### Modified app.py route: `GET /api/all_patents`

Reads new `color_filter` query param (same pattern as `brand_filter`).

---

## Frontend

### Component: `MultiSelectDropdown`

A plain-JS class (no framework). Constructor takes:
- `containerId` — element to replace with the component
- `label` — display name (e.g. "Marca")
- `onChange` — callback called on any check/uncheck

Structure:
```html
<div class="ms-dropdown">
  <button class="ms-trigger">Marca</button>   <!-- shows "Marca (2)" when 2 selected -->
  <div class="ms-panel" hidden>
    <!-- one per option: -->
    <label><input type="checkbox" value="Toyota"> Toyota</label>
    ...
  </div>
</div>
```

Behavior:
- Click trigger → toggle panel visibility.
- Click outside → close panel.
- Any checkbox change → update trigger label → call `onChange`.
- `.getSelected()` → returns `string[]` of checked values.
- `.setSelected(values)` → checks matching boxes (for URL restore).
- `.populate(options)` → builds checkbox list from string array.
- `.reset()` → unchecks all, resets label.

### Integration into existing JS

- On `DOMContentLoaded`: fetch `/api/filter_options`, then call `.populate()` on each dropdown.
- `readAllFilters()` updated: reads from `.getSelected()` instead of `.value.trim()`.
- `currentBrandFilter`, `currentColorFilter`, `currentTypeFilter` → `string[]` (was `string`).
- API URL building: `brand_filter=Toyota%2CFord` (comma-joined, `encodeURIComponent` applied to the whole joined string).
- `pushFiltersToURL` / `getFiltersFromURL`: serialize as `brand_filter=Toyota,Ford` (comma in URL param, decoded on restore).
- Clear button: calls `.reset()` on all three dropdowns.
- Event binding: `onChange` → debounced `triggerFilteredFetch()`.

### HTML changes (`index.html`)

Remove:
```html
<input type="text" id="filter-brand" ...>
<input type="text" id="filter-type" ...>
```

Add:
```html
<div id="filter-brand-container"></div>
<div id="filter-color-container"></div>
<div id="filter-type-container"></div>
```

(Components mounted into these containers by JS.)

### CSS additions (`style.css`)

```css
.ms-dropdown { position: relative; display: inline-block; }
.ms-trigger  { /* same style as .time-preset-btn */ }
.ms-trigger.active { /* same as .time-preset-btn.active */ }
.ms-panel    { position: absolute; z-index: 10; background: #fff; border: 1px solid #ced4da;
               border-radius: 4px; padding: 6px 0; min-width: 160px; max-height: 260px;
               overflow-y: auto; top: calc(100% + 4px); left: 0; }
.ms-panel label { display: flex; gap: 6px; align-items: center; padding: 4px 12px;
                  font-size: 13px; cursor: pointer; white-space: nowrap; }
.ms-panel label:hover { background: #f0f4f8; }
```

Mobile: panel goes full-width on `max-width: 480px`.

---

## Out of scope

- Server-side caching with Redis (simple in-process timestamp cache is sufficient).
- Search/filter within the dropdown (value count is small).
- "Select all" / "Deselect all" buttons inside the panel.
- Changing the existing `min_confidence_filter` behaviour.
