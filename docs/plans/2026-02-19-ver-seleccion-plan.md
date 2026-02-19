# Ver Selección Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** The "Ver Todas" button relabels to "Ver Selección" when any table filter is active, and the browse carousel respects all active filters (plate, brand, color, vehicle type, date range).

**Architecture:** Extend `count_browsable_images` and `fetch_browsable_images` in `db_utils.py` to accept `brand_filter`, `color_filter`, `vehicle_type_filter` using the same IN-clause + brand-normalization pattern already in `_build_where_clause`. Wire those params through the Flask route and the JS fetch calls. Store the "Ver Todas" button reference at module scope so it can be relabeled whenever filter state changes.

**Tech Stack:** Python 3 / Flask / psycopg2, vanilla JS. No test suite — verification is done via curl and browser.

---

## Context and key files

- `db_utils.py:353–393` — `_build_where_clause` and the `_BRAND_RAW_VARIANTS` reverse map. Copy the brand-expansion pattern from lines 362–369 into the browse functions.
- `db_utils.py:643–685` — `count_browsable_images`: builds its own inline conditions list. Add brand/color/type IN clauses here.
- `db_utils.py:688–754` — `fetch_browsable_images`: same inline conditions pattern. Add brand/color/type IN clauses here.
- `app.py:277–318` — `/api/browse_images` route. Add comma-split parsing for `brand_filter`, `color_filter`, `vehicle_type_filter` (same pattern as lines 226–228 for `/api/all_patents`).
- `static/script.js:470–497` — `fetchLatestThumbnails()`. The `viewAllBtn` is created locally and discarded; promote it to `let viewAllBtn = null` at module scope.
- `static/script.js:256–271` — `readAllFilters()` and `triggerFilteredFetch()`. Call `updateViewAllBtn()` here.
- `static/script.js:546–555` — `clearFiltersButton` handler. Call `updateViewAllBtn()` here.
- `static/script.js:569–611` — Time-preset handler. Call `updateViewAllBtn()` here.
- `static/script.js:763–875` — `browseLoadPage()` and `browsePrefetch()`. Add brand/color/type to `URLSearchParams`.

---

### Task 1: Extend `count_browsable_images` with brand/color/vehicle-type filters

**Files:**
- Modify: `db_utils.py:643–685`

**Step 1: Update the function signature**

Change:
```python
def count_browsable_images(types, start_date=None, end_date=None, search_term=None):
```
To:
```python
def count_browsable_images(types, start_date=None, end_date=None, search_term=None,
                           brand_filter=None, color_filter=None, vehicle_type_filter=None):
```

**Step 2: Add IN-clause conditions after the `search_term` block (before `where = ...`)**

Insert after line 666 (`params.append(f'%{search_term}%')`):

```python
        if brand_filter:
            expanded_brands = []
            for b in brand_filter:
                expanded_brands.append(b)
                expanded_brands.extend(_BRAND_RAW_VARIANTS.get(b, []))
            placeholders = ','.join(['%s'] * len(expanded_brands))
            conditions.append(f"de.vehicle_brand IN ({placeholders})")
            params.extend(expanded_brands)
        if color_filter:
            placeholders = ','.join(['%s'] * len(color_filter))
            conditions.append(f"de.vehicle_color IN ({placeholders})")
            params.extend(color_filter)
        if vehicle_type_filter:
            placeholders = ','.join(['%s'] * len(vehicle_type_filter))
            conditions.append(f"de.vehicle_type IN ({placeholders})")
            params.extend(vehicle_type_filter)
```

**Step 3: Verify with curl (after server restart)**

```bash
# Should return same count as without filters when no filter given
curl -s "http://127.0.0.1:5000/api/browse_images" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('total_count'))"
```

**Step 4: Commit**

```bash
git add db_utils.py
git commit -m "feat: extend count_browsable_images with brand/color/type filters"
```

---

### Task 2: Extend `fetch_browsable_images` with brand/color/vehicle-type filters

**Files:**
- Modify: `db_utils.py:688–754`

**Step 1: Update the function signature**

Change:
```python
def fetch_browsable_images(cursor_ts=None, cursor_id=None, limit=5, direction='forward',
                           types=None, start_date=None, end_date=None, search_term=None):
```
To:
```python
def fetch_browsable_images(cursor_ts=None, cursor_id=None, limit=5, direction='forward',
                           types=None, start_date=None, end_date=None, search_term=None,
                           brand_filter=None, color_filter=None, vehicle_type_filter=None):
```

**Step 2: Add IN-clause conditions after the `search_term` block (before `where = ""`)**

Insert after line 720 (`params.append(f'%{search_term}%')`):

```python
        if brand_filter:
            expanded_brands = []
            for b in brand_filter:
                expanded_brands.append(b)
                expanded_brands.extend(_BRAND_RAW_VARIANTS.get(b, []))
            placeholders = ','.join(['%s'] * len(expanded_brands))
            conditions.append(f"de.vehicle_brand IN ({placeholders})")
            params.extend(expanded_brands)
        if color_filter:
            placeholders = ','.join(['%s'] * len(color_filter))
            conditions.append(f"de.vehicle_color IN ({placeholders})")
            params.extend(color_filter)
        if vehicle_type_filter:
            placeholders = ','.join(['%s'] * len(vehicle_type_filter))
            conditions.append(f"de.vehicle_type IN ({placeholders})")
            params.extend(vehicle_type_filter)
```

**Step 3: Commit**

```bash
git add db_utils.py
git commit -m "feat: extend fetch_browsable_images with brand/color/type filters"
```

---

### Task 3: Wire filters through `/api/browse_images`

**Files:**
- Modify: `app.py:277–318`

**Step 1: Parse the three new query params**

After the existing `search_term = request.args.get(...)` line (around line 296), add:

```python
    brand_filter_raw  = request.args.get('brand_filter',        None, type=str)
    color_filter_raw  = request.args.get('color_filter',        None, type=str)
    vtype_filter_raw  = request.args.get('vehicle_type_filter', None, type=str)
    brand_filter  = [v.strip() for v in brand_filter_raw.split(',')  if v.strip()] if brand_filter_raw  else None
    color_filter  = [v.strip() for v in color_filter_raw.split(',')  if v.strip()] if color_filter_raw  else None
    vtype_filter  = [v.strip() for v in vtype_filter_raw.split(',')  if v.strip()] if vtype_filter_raw  else None
```

**Step 2: Pass to both db_utils calls**

In the `db_utils.fetch_browsable_images(...)` call, add:
```python
            brand_filter=brand_filter,
            color_filter=color_filter,
            vehicle_type_filter=vtype_filter,
```

In the `db_utils.count_browsable_images(...)` call, add:
```python
                brand_filter=brand_filter,
                color_filter=color_filter,
                vehicle_type_filter=vtype_filter,
```

**Step 3: Verify with curl**

```bash
# Restart server first, then:
COOKIE=/tmp/t.txt
curl -sc $COOKIE http://127.0.0.1:5000/login -X POST \
  --data-urlencode 'username=neuqadmin' \
  --data-urlencode 'password=...'
# With brand filter — count should be <= total
curl -sb $COOKIE "http://127.0.0.1:5000/api/browse_images?brand_filter=Toyota" | \
  python3 -c "import sys,json; d=json.load(sys.stdin); print('total:', d.get('total_count'), 'images:', len(d['images']))"
```

**Step 4: Commit**

```bash
git add app.py
git commit -m "feat: wire brand/color/vehicle_type_filter through /api/browse_images"
```

---

### Task 4: JS — store viewAllBtn, add updateViewAllBtn(), call on filter changes

**Files:**
- Modify: `static/script.js`

**Step 1: Declare `viewAllBtn` at module scope**

After the existing `let prefetchInFlight = false;` line (~line 851), add:

```javascript
    let viewAllBtn = null;
```

**Step 2: Store the reference in `fetchLatestThumbnails`**

Find the block in `fetchLatestThumbnails` that creates the button (lines 489–493):
```javascript
            const viewAllBtn = document.createElement('button');
            viewAllBtn.className = 'thumbnail view-all-btn';
            viewAllBtn.textContent = 'Ver Todas';
            viewAllBtn.addEventListener('click', openBrowseCarousel);
            thumbnailStrip.appendChild(viewAllBtn);
```

Change the `const viewAllBtn` to an assignment to the outer variable:
```javascript
            viewAllBtn = document.createElement('button');
            viewAllBtn.className = 'thumbnail view-all-btn';
            viewAllBtn.textContent = 'Ver Todas';
            viewAllBtn.addEventListener('click', openBrowseCarousel);
            thumbnailStrip.appendChild(viewAllBtn);
```

**Step 3: Add `updateViewAllBtn()`**

Add immediately after the `viewAllBtn = null;` declaration:

```javascript
    function updateViewAllBtn() {
        if (!viewAllBtn) return;
        const hasFilter = currentPatentFilter ||
            currentBrandFilter.length ||
            currentColorFilter.length ||
            currentTypeFilter.length  ||
            currentStartDateFilter    ||
            currentEndDateFilter;
        viewAllBtn.textContent = hasFilter ? 'Ver Selección' : 'Ver Todas';
    }
```

**Step 4: Call `updateViewAllBtn()` after every filter-state change**

- In `readAllFilters()`, add `updateViewAllBtn();` as the last line.
- In the `clearFiltersButton` click handler, add `updateViewAllBtn();` after `triggerFilteredFetch();`.
- In the time-preset handler, add `updateViewAllBtn();` after the final `fetchStats();` call.

**Step 5: Verify in browser**

1. Open the page with no filters → button says "Ver Todas".
2. Type anything in the plate filter → button says "Ver Selección".
3. Clear all filters → button says "Ver Todas".

**Step 6: Commit**

```bash
git add static/script.js
git commit -m "feat: relabel Ver Todas->Ver Seleccion when filters are active"
```

---

### Task 5: JS — pass brand/color/type to browseLoadPage and browsePrefetch

**Files:**
- Modify: `static/script.js:763–875`

**Step 1: Add filters to `browseLoadPage`**

In `browseLoadPage`, find the params block (around lines 772–784):
```javascript
        const params = new URLSearchParams({
            limit: '5',
            direction: direction,
            types: browseTypes.join(',')
        });
        if (cursor) { ... }
        if (currentStartDateFilter) params.set('start_date', currentStartDateFilter);
        if (currentEndDateFilter) params.set('end_date', currentEndDateFilter);
        if (currentPatentFilter) params.set('search_term', currentPatentFilter);
```

Add after the last `params.set` for `search_term`:
```javascript
        if (currentBrandFilter.length)  params.set('brand_filter',        currentBrandFilter.join(','));
        if (currentColorFilter.length)  params.set('color_filter',        currentColorFilter.join(','));
        if (currentTypeFilter.length)   params.set('vehicle_type_filter', currentTypeFilter.join(','));
```

**Step 2: Add filters to `browsePrefetch`**

In `browsePrefetch`, find the params block (around lines 858–864):
```javascript
        const params = new URLSearchParams({
            limit: '5', direction: 'forward', types: browseTypes.join(','),
            cursor_ts: cursor.created_at, cursor_id: cursor.image_id
        });
        if (currentStartDateFilter) params.set('start_date', currentStartDateFilter);
        if (currentEndDateFilter) params.set('end_date', currentEndDateFilter);
        if (currentPatentFilter) params.set('search_term', currentPatentFilter);
```

Add the same three lines after:
```javascript
        if (currentBrandFilter.length)  params.set('brand_filter',        currentBrandFilter.join(','));
        if (currentColorFilter.length)  params.set('color_filter',        currentColorFilter.join(','));
        if (currentTypeFilter.length)   params.set('vehicle_type_filter', currentTypeFilter.join(','));
```

**Step 3: Verify end-to-end in browser**

1. Apply a brand filter (e.g. "Toyota") → table shows only Toyotas, button says "Ver Selección".
2. Click "Ver Selección" → carousel opens, shows only Toyota images.
3. Clear all filters → button says "Ver Todas", carousel shows all images.
4. Thumbnail strip still shows latest images regardless of filters. ✓

**Step 4: Commit**

```bash
git add static/script.js
git commit -m "feat: pass brand/color/type filters to browse carousel fetch calls"
```

---

## Deploy

```bash
git push origin main
ssh root@ai.altermundi.net "cd /opt/patentefaunanqn && git pull && systemctl restart patentefaunanqn"
```
