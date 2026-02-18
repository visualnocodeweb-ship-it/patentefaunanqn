# Multi-Select Dropdown Filters Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the Marca and Tipo free-text filter inputs with custom multi-select dropdown components populated from DB DISTINCT values, and add a new Color multi-select filter.

**Architecture:** New `/api/filter_options` endpoint returns sorted unique values. `_build_where_clause` switches from ILIKE partial-match to exact `IN (...)` match and gains a `color_filter` param. A vanilla-JS `MultiSelectDropdown` class renders three dropdown components that replace the old text inputs. Filter state becomes `string[]` arrays joined as comma-separated URL params.

**Tech Stack:** Python/Flask, psycopg2, vanilla JS (ES2017), CSS.

---

## Task 1: Add `fetch_filter_options` to db_utils.py and `/api/filter_options` to app.py

**Files:**
- Modify: `db_utils.py` (after `fetch_recent_thumbnails`, before `count_browsable_images`)
- Modify: `app.py` (add route after `/api/recent_thumbnails`, before `/api/search_plate`)

### Step 1: Add the DB function to `db_utils.py`

Insert this function after `fetch_recent_thumbnails` (after line ~556 in current file):

```python
# In-process cache for filter options (invalidated after 300 s)
_filter_options_cache = None
_filter_options_cache_ts = 0.0

def fetch_filter_options():
    """
    Returns unique sorted values for vehicle_brand, vehicle_color, vehicle_type.
    Results are cached for 300 seconds to avoid hammering the DB on every page load.
    Raises DBError on DB failure.
    """
    import time
    global _filter_options_cache, _filter_options_cache_ts
    if _filter_options_cache is not None and (time.time() - _filter_options_cache_ts) < 300:
        return _filter_options_cache

    conn = None
    try:
        conn = _get_conn()
        cur = conn.cursor()

        cur.execute(
            "SELECT DISTINCT vehicle_brand FROM detection_events "
            "WHERE vehicle_brand IS NOT NULL AND vehicle_brand <> ''"
        )
        raw_brands = [row[0] for row in cur.fetchall()]
        brands = sorted({normalize_vehicle_brand(b) for b in raw_brands if b})

        cur.execute(
            "SELECT DISTINCT vehicle_color FROM detection_events "
            "WHERE vehicle_color IS NOT NULL AND vehicle_color <> ''"
        )
        colors = sorted({row[0].strip() for row in cur.fetchall() if row[0] and row[0].strip()})

        cur.execute(
            "SELECT DISTINCT vehicle_type FROM detection_events "
            "WHERE vehicle_type IS NOT NULL AND vehicle_type <> ''"
        )
        types = sorted({row[0].strip() for row in cur.fetchall() if row[0] and row[0].strip()})

        cur.close()
        result = {"brands": brands, "colors": colors, "types": types}
        _filter_options_cache = result
        _filter_options_cache_ts = time.time()
        return result

    except RuntimeError:
        raise
    except psycopg2.Error as e:
        logger.error("Error fetching filter options: %s", e)
        raise DBError("Database operation failed") from e
    except Exception as e:
        logger.error("Error fetching filter options: %s", e)
        raise DBError("Database operation failed") from e
    finally:
        _put_conn(conn)
```

### Step 2: Add the route to `app.py`

Insert after the `/api/recent_thumbnails` route (after line ~160):

```python
@app.route('/api/filter_options')
def filter_options():
    """Returns unique sorted values for brand, color, and type dropdowns."""
    try:
        options = db_utils.fetch_filter_options()
    except (DBError, RuntimeError):
        return jsonify({"error": "Service temporarily unavailable"}), 503
    return jsonify(options)
```

### Step 3: Manual verification

```bash
python app.py &
sleep 2
# Login first (get session cookie)
curl -s -c /tmp/c.txt -b /tmp/c.txt \
  -d "username=admin&password=admin123" -X POST http://127.0.0.1:5000/login
# Fetch filter options
curl -s -c /tmp/c.txt -b /tmp/c.txt http://127.0.0.1:5000/api/filter_options | python3 -m json.tool
# Expected: {"brands": [...], "colors": [...], "types": [...]} — all sorted, no nulls
kill %1
```

### Step 4: Commit

```bash
git add db_utils.py app.py
git commit -m "Add /api/filter_options endpoint with 5-min in-process cache"
```

---

## Task 2: Update `_build_where_clause` and `fetch_all_patents_paginated` for multi-value IN + add color_filter

**Files:**
- Modify: `db_utils.py` (lines ~347-429)
- Modify: `app.py` (the `all_patents` route, lines ~204-244)

### Step 1: Update `_build_where_clause` in `db_utils.py`

Replace the current signature and brand/type ILIKE conditions. The function now accepts lists (or None) for brand, color, and type:

**Old signature (line 347):**
```python
def _build_where_clause(search_term=None, brand_filter=None, type_filter=None,
                        start_date_filter=None, end_date_filter=None, min_confidence_filter=None):
```

**New signature:**
```python
def _build_where_clause(search_term=None, brand_filter=None, color_filter=None,
                        type_filter=None, start_date_filter=None, end_date_filter=None,
                        min_confidence_filter=None):
```

**Old brand/type conditions (lines 355-360):**
```python
    if brand_filter:
        conditions.append("vehicle_brand ILIKE %s")
        params.append(f'%{brand_filter}%')
    if type_filter:
        conditions.append("vehicle_type ILIKE %s")
        params.append(f'%{type_filter}%')
```

**New brand/color/type IN conditions (replace those lines with):**
```python
    if brand_filter:
        placeholders = ','.join(['%s'] * len(brand_filter))
        conditions.append(f"vehicle_brand IN ({placeholders})")
        params.extend(brand_filter)
    if color_filter:
        placeholders = ','.join(['%s'] * len(color_filter))
        conditions.append(f"vehicle_color IN ({placeholders})")
        params.extend(color_filter)
    if type_filter:
        placeholders = ','.join(['%s'] * len(type_filter))
        conditions.append(f"vehicle_type IN ({placeholders})")
        params.extend(type_filter)
```

### Step 2: Update `fetch_all_patents_paginated` signature in `db_utils.py`

**Old (line 378):**
```python
def fetch_all_patents_paginated(page=1, page_size=10, search_term=None, brand_filter=None,
                                type_filter=None, start_date_filter=None, end_date_filter=None,
                                min_confidence_filter=None):
```

**New:**
```python
def fetch_all_patents_paginated(page=1, page_size=10, search_term=None, brand_filter=None,
                                color_filter=None, type_filter=None, start_date_filter=None,
                                end_date_filter=None, min_confidence_filter=None):
```

Update the `_build_where_clause` call inside the function body to pass `color_filter`:

**Old (around line 395):**
```python
        where_clause, query_params = _build_where_clause(
            search_term, brand_filter, type_filter,
            start_date_filter, end_date_filter, min_confidence_filter
        )
```

**New:**
```python
        where_clause, query_params = _build_where_clause(
            search_term, brand_filter, color_filter, type_filter,
            start_date_filter, end_date_filter, min_confidence_filter
        )
```

### Step 3: Update the `/api/all_patents` route in `app.py`

Add `color_filter` reading and split all three filters from comma-separated string to list:

**In the `all_patents()` function, replace:**
```python
    brand_filter = request.args.get('brand_filter', None, type=str)
    type_filter = request.args.get('type_filter', None, type=str)
```

**With:**
```python
    brand_filter_raw = request.args.get('brand_filter', None, type=str)
    color_filter_raw = request.args.get('color_filter', None, type=str)
    type_filter_raw  = request.args.get('type_filter',  None, type=str)
    brand_filter = [v.strip() for v in brand_filter_raw.split(',') if v.strip()] if brand_filter_raw else None
    color_filter = [v.strip() for v in color_filter_raw.split(',') if v.strip()] if color_filter_raw else None
    type_filter  = [v.strip() for v in type_filter_raw.split(',')  if v.strip()] if type_filter_raw  else None
```

**And update the `fetch_all_patents_paginated` call to pass `color_filter`:**
```python
        patents, total_count = db_utils.fetch_all_patents_paginated(
            page, page_size, search_term,
            brand_filter=brand_filter,
            color_filter=color_filter,
            type_filter=type_filter,
            start_date_filter=start_date_filter,
            end_date_filter=end_date_filter,
            min_confidence_filter=min_confidence_filter
        )
```

### Step 4: Manual verification

```bash
python app.py &
sleep 2
curl -s -c /tmp/c.txt -b /tmp/c.txt \
  -d "username=admin&password=admin123" -X POST http://127.0.0.1:5000/login

# Single brand filter
curl -s -c /tmp/c.txt -b /tmp/c.txt \
  "http://127.0.0.1:5000/api/all_patents?brand_filter=Chevrolet" | python3 -m json.tool | head -20

# Multi-brand filter
curl -s -c /tmp/c.txt -b /tmp/c.txt \
  "http://127.0.0.1:5000/api/all_patents?brand_filter=Chevrolet,Ford" | python3 -m json.tool | head -5
# Expected: patents array (may be empty if those brands don't exist), total_count integer

# Color filter (check a color from filter_options first)
curl -s -c /tmp/c.txt -b /tmp/c.txt \
  "http://127.0.0.1:5000/api/filter_options" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['colors'][:3])"
kill %1
```

### Step 5: Commit

```bash
git add db_utils.py app.py
git commit -m "Switch brand/type filters from ILIKE to IN, add color_filter support"
```

---

## Task 3: Add multi-select dropdown CSS to `style.css`

**Files:**
- Modify: `static/style.css` (append before the `@media` blocks)

### Step 1: Add CSS

Find the line `/* Responsive: tablet / mobile */` (currently around line 503). Insert the following block **immediately before** that line:

```css
/* Multi-select dropdown */
.ms-dropdown {
    position: relative;
    display: inline-block;
}

.ms-trigger {
    padding: 6px 10px;
    background-color: #e9ecef;
    color: #333;
    border: 1px solid #ced4da;
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
    touch-action: manipulation;
    white-space: nowrap;
}

.ms-trigger:hover {
    background-color: #dee2e6;
}

.ms-trigger.has-selection {
    background-color: #007bff;
    color: #fff;
    border-color: #007bff;
}

.ms-panel {
    position: absolute;
    z-index: 20;
    top: calc(100% + 4px);
    left: 0;
    background: #fff;
    border: 1px solid #ced4da;
    border-radius: 4px;
    padding: 4px 0;
    min-width: 160px;
    max-height: 260px;
    overflow-y: auto;
    box-shadow: 0 2px 8px rgba(0,0,0,0.12);
}

.ms-panel[hidden] { display: none; }

.ms-panel label {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 12px;
    font-size: 13px;
    cursor: pointer;
    white-space: nowrap;
    color: #333;
}

.ms-panel label:hover {
    background-color: #f0f4f8;
}

.ms-panel input[type="checkbox"] {
    cursor: pointer;
    accent-color: #007bff;
}
```

Also add inside the existing `@media (max-width: 768px)` block (after `.stats-bar` rules, before `.thumbnail` rules):

```css
    .ms-panel {
        min-width: 140px;
    }
```

### Step 2: Verify visually (no server needed)

Open `templates/index.html` in a browser after Task 4 is complete. Panel should appear below the trigger button with proper shadow and scrolling.

### Step 3: Commit

```bash
git add static/style.css
git commit -m "Add multi-select dropdown CSS"
```

---

## Task 4: Update `index.html` — replace text inputs with dropdown containers

**Files:**
- Modify: `templates/index.html` (lines 39-48, the `.table-controls` div)

### Step 1: Replace the brand and type inputs with container divs, add color container

**Old `.table-controls` block (lines 39-48):**
```html
            <div class="table-controls">
                <input type="text" id="filter-patent" autocomplete="off" placeholder="Patente…" title="Filtrar por patente">
                <input type="text" id="filter-brand" autocomplete="off" placeholder="Marca…" title="Filtrar por marca">
                <input type="text" id="filter-type" autocomplete="off" placeholder="Tipo…" title="Filtrar por tipo">
                <span class="filter-label">Desde</span>
                <input type="date" id="filter-start-date" autocomplete="off" title="Fecha desde">
                <span class="filter-label">Hasta</span>
                <input type="date" id="filter-end-date" autocomplete="off" title="Fecha hasta">
                <button id="clear-all-filters-button">Limpiar</button>
            </div>
```

**New `.table-controls` block:**
```html
            <div class="table-controls">
                <input type="text" id="filter-patent" autocomplete="off" placeholder="Patente…" title="Filtrar por patente">
                <div id="filter-brand-container"></div>
                <div id="filter-color-container"></div>
                <div id="filter-type-container"></div>
                <span class="filter-label">Desde</span>
                <input type="date" id="filter-start-date" autocomplete="off" title="Fecha desde">
                <span class="filter-label">Hasta</span>
                <input type="date" id="filter-end-date" autocomplete="off" title="Fecha hasta">
                <button id="clear-all-filters-button">Limpiar</button>
            </div>
```

### Step 2: Commit

```bash
git add templates/index.html
git commit -m "Replace brand/type text inputs with dropdown containers, add color container"
```

---

## Task 5: Implement `MultiSelectDropdown` and wire everything in `script.js`

**Files:**
- Modify: `static/script.js`

This is the largest task. Read the full file before making any changes.

### Step 1: Remove stale references to `filterBrand` and `filterType` DOM elements

**Delete these lines (around lines 29-30):**
```javascript
    const filterBrand = document.getElementById('filter-brand');
    const filterType = document.getElementById('filter-type');
```

### Step 2: Change filter state variables from `string` to `string[]`

**Old (lines 52-53):**
```javascript
    let currentBrandFilter = '';
    let currentTypeFilter = '';
```

**New (insert `currentColorFilter` too):**
```javascript
    let currentBrandFilter = [];
    let currentColorFilter = [];
    let currentTypeFilter  = [];
```

### Step 3: Add the `MultiSelectDropdown` class

Insert this class definition immediately after the `handle401` function (after line ~69, before `getFiltersFromURL`):

```javascript
    // --- Multi-select dropdown component ---
    class MultiSelectDropdown {
        /**
         * @param {string} containerId  - ID of the <div> to mount into
         * @param {string} label        - Base label shown on trigger button
         * @param {function} onChange   - Called with no args whenever selection changes
         */
        constructor(containerId, label, onChange) {
            this._label = label;
            this._onChange = onChange;
            this._options = [];
            this._selected = new Set();

            // Build DOM
            this._root = document.createElement('div');
            this._root.className = 'ms-dropdown';

            this._trigger = document.createElement('button');
            this._trigger.type = 'button';
            this._trigger.className = 'ms-trigger';
            this._trigger.textContent = label;
            this._trigger.setAttribute('aria-haspopup', 'listbox');
            this._trigger.setAttribute('aria-expanded', 'false');

            this._panel = document.createElement('div');
            this._panel.className = 'ms-panel';
            this._panel.setAttribute('hidden', '');
            this._panel.setAttribute('role', 'listbox');
            this._panel.setAttribute('aria-multiselectable', 'true');

            this._root.appendChild(this._trigger);
            this._root.appendChild(this._panel);

            const container = document.getElementById(containerId);
            if (container) container.appendChild(this._root);

            // Toggle panel on trigger click
            this._trigger.addEventListener('click', (e) => {
                e.stopPropagation();
                const isOpen = !this._panel.hasAttribute('hidden');
                if (isOpen) {
                    this._close();
                } else {
                    this._open();
                }
            });

            // Close when clicking outside
            document.addEventListener('click', (e) => {
                if (!this._root.contains(e.target)) this._close();
            });
        }

        _open() {
            this._panel.removeAttribute('hidden');
            this._trigger.setAttribute('aria-expanded', 'true');
        }

        _close() {
            this._panel.setAttribute('hidden', '');
            this._trigger.setAttribute('aria-expanded', 'false');
        }

        _updateTrigger() {
            const count = this._selected.size;
            this._trigger.textContent = count > 0 ? `${this._label} (${count})` : this._label;
            this._trigger.classList.toggle('has-selection', count > 0);
        }

        /** Populate the panel with options. Preserves existing selection. */
        populate(options) {
            this._options = options;
            this._panel.innerHTML = '';
            options.forEach(opt => {
                const label = document.createElement('label');
                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.value = opt;
                cb.checked = this._selected.has(opt);
                cb.setAttribute('role', 'option');
                cb.setAttribute('aria-selected', cb.checked ? 'true' : 'false');
                cb.addEventListener('change', () => {
                    if (cb.checked) {
                        this._selected.add(opt);
                        cb.setAttribute('aria-selected', 'true');
                    } else {
                        this._selected.delete(opt);
                        cb.setAttribute('aria-selected', 'false');
                    }
                    this._updateTrigger();
                    this._onChange();
                });
                label.appendChild(cb);
                label.appendChild(document.createTextNode(' ' + opt));
                this._panel.appendChild(label);
            });
            this._updateTrigger();
        }

        /** Returns array of selected values. */
        getSelected() {
            return [...this._selected];
        }

        /** Sets selection from an array of values (for URL restore). */
        setSelected(values) {
            this._selected = new Set(values);
            // Update checkboxes if panel is already populated
            this._panel.querySelectorAll('input[type="checkbox"]').forEach(cb => {
                cb.checked = this._selected.has(cb.value);
                cb.setAttribute('aria-selected', cb.checked ? 'true' : 'false');
            });
            this._updateTrigger();
        }

        /** Clear all selections. */
        reset() {
            this._selected.clear();
            this._panel.querySelectorAll('input[type="checkbox"]').forEach(cb => {
                cb.checked = false;
                cb.setAttribute('aria-selected', 'false');
            });
            this._updateTrigger();
        }
    }
```

### Step 4: Instantiate the three dropdowns

After the class definition (still before `getFiltersFromURL`), add:

```javascript
    // Instantiate multi-select dropdowns
    const dropdownBrand = new MultiSelectDropdown('filter-brand-container', 'Marca', () => debouncedFetch());
    const dropdownColor = new MultiSelectDropdown('filter-color-container', 'Color', () => debouncedFetch());
    const dropdownType  = new MultiSelectDropdown('filter-type-container',  'Tipo',  () => debouncedFetch());
```

### Step 5: Update `getFiltersFromURL` to read comma-separated values

**Old `getFiltersFromURL` (lines ~72-83):**
```javascript
    function getFiltersFromURL() {
        const params = new URLSearchParams(window.location.search);
        return {
            page: parseInt(params.get('page')) || 1,
            patent: params.get('search_term') || '',
            brand: params.get('brand_filter') || '',
            type: params.get('type_filter') || '',
            startDate: params.get('start_date_filter') || '',
            endDate: params.get('end_date_filter') || '',
            minConfidence: params.get('min_confidence_filter') || ''
        };
    }
```

**New:**
```javascript
    function getFiltersFromURL() {
        const params = new URLSearchParams(window.location.search);
        const splitParam = (key) => {
            const v = params.get(key);
            return v ? v.split(',').map(s => s.trim()).filter(Boolean) : [];
        };
        return {
            page:        parseInt(params.get('page')) || 1,
            patent:      params.get('search_term') || '',
            brand:       splitParam('brand_filter'),
            color:       splitParam('color_filter'),
            type:        splitParam('type_filter'),
            startDate:   params.get('start_date_filter') || '',
            endDate:     params.get('end_date_filter') || '',
            minConfidence: params.get('min_confidence_filter') || ''
        };
    }
```

### Step 6: Update `pushFiltersToURL` to serialize arrays

**Old lines (89-90):**
```javascript
        if (currentBrandFilter) params.set('brand_filter', currentBrandFilter);
        if (currentTypeFilter) params.set('type_filter', currentTypeFilter);
```

**New (replace those two lines with three):**
```javascript
        if (currentBrandFilter.length) params.set('brand_filter', currentBrandFilter.join(','));
        if (currentColorFilter.length) params.set('color_filter', currentColorFilter.join(','));
        if (currentTypeFilter.length)  params.set('type_filter',  currentTypeFilter.join(','));
```

### Step 7: Update URL state initialization

**Old (lines 100-114):**
```javascript
    const urlState = getFiltersFromURL();
    currentPage = urlState.page;
    currentPatentFilter = urlState.patent;
    currentBrandFilter = urlState.brand;
    currentTypeFilter = urlState.type;
    currentStartDateFilter = urlState.startDate;
    currentEndDateFilter = urlState.endDate;
    currentMinConfidenceFilter = urlState.minConfidence;

    // Populate inputs from URL state
    filterPatent.value = currentPatentFilter;
    filterBrand.value = currentBrandFilter;
    filterType.value = currentTypeFilter;
    filterStartDate.value = currentStartDateFilter;
    filterEndDate.value = currentEndDateFilter;
    // currentMinConfidenceFilter kept for API compat but no UI input
```

**New:**
```javascript
    const urlState = getFiltersFromURL();
    currentPage = urlState.page;
    currentPatentFilter = urlState.patent;
    currentBrandFilter = urlState.brand;
    currentColorFilter = urlState.color;
    currentTypeFilter  = urlState.type;
    currentStartDateFilter = urlState.startDate;
    currentEndDateFilter   = urlState.endDate;
    currentMinConfidenceFilter = urlState.minConfidence;

    // Populate inputs from URL state
    filterPatent.value         = currentPatentFilter;
    filterStartDate.value      = currentStartDateFilter;
    filterEndDate.value        = currentEndDateFilter;
    // Dropdowns: setSelected() is called after populate() in fetchAndInitDropdowns below
```

### Step 8: Update `readAllFilters`

**Old (lines ~118-125):**
```javascript
    function readAllFilters() {
        currentPatentFilter = filterPatent.value.trim();
        currentBrandFilter = filterBrand.value.trim();
        currentTypeFilter = filterType.value.trim();
        currentStartDateFilter = filterStartDate.value;
        currentEndDateFilter = filterEndDate.value;
        currentMinConfidenceFilter = '';
        currentPage = 1;
    }
```

**New:**
```javascript
    function readAllFilters() {
        currentPatentFilter = filterPatent.value.trim();
        currentBrandFilter  = dropdownBrand.getSelected();
        currentColorFilter  = dropdownColor.getSelected();
        currentTypeFilter   = dropdownType.getSelected();
        currentStartDateFilter = filterStartDate.value;
        currentEndDateFilter   = filterEndDate.value;
        currentMinConfidenceFilter = '';
        currentPage = 1;
    }
```

### Step 9: Update `fetchPatentsTableData` URL building

**Old (lines ~240-243):**
```javascript
        if (currentBrandFilter) url += `&brand_filter=${encodeURIComponent(currentBrandFilter)}`;
        if (currentTypeFilter) url += `&type_filter=${encodeURIComponent(currentTypeFilter)}`;
```

**New (replace those lines with three):**
```javascript
        if (currentBrandFilter.length) url += `&brand_filter=${encodeURIComponent(currentBrandFilter.join(','))}`;
        if (currentColorFilter.length) url += `&color_filter=${encodeURIComponent(currentColorFilter.join(','))}`;
        if (currentTypeFilter.length)  url += `&type_filter=${encodeURIComponent(currentTypeFilter.join(','))}`;
```

### Step 10: Update filter event listeners — remove brand/type text input listeners

**Old (lines ~361-368):**
```javascript
    [filterPatent, filterBrand, filterType].forEach(input => {
        input.addEventListener('input', debouncedFetch);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                triggerFilteredFetch();
            }
        });
    });
```

**New (only patent remains as text input):**
```javascript
    filterPatent.addEventListener('input', debouncedFetch);
    filterPatent.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            triggerFilteredFetch();
        }
    });
```

### Step 11: Update clear button handler

**Old (lines ~377-385):**
```javascript
    clearFiltersButton.addEventListener('click', () => {
        filterPatent.value = '';
        filterBrand.value = '';
        filterType.value = '';
        filterStartDate.value = '';
        filterEndDate.value = '';
        document.querySelectorAll('.time-preset-btn').forEach(b => b.classList.remove('active'));
        triggerFilteredFetch();
    });
```

**New:**
```javascript
    clearFiltersButton.addEventListener('click', () => {
        filterPatent.value = '';
        dropdownBrand.reset();
        dropdownColor.reset();
        dropdownType.reset();
        filterStartDate.value = '';
        filterEndDate.value = '';
        document.querySelectorAll('.time-preset-btn').forEach(b => b.classList.remove('active'));
        triggerFilteredFetch();
    });
```

### Step 12: Update time-preset handler — remove brand/type text references

**Old (lines ~428-430):**
```javascript
            currentPatentFilter = filterPatent.value.trim();
            currentBrandFilter = filterBrand.value.trim();
            currentTypeFilter = filterType.value.trim();
```

**New:**
```javascript
            currentPatentFilter = filterPatent.value.trim();
            currentBrandFilter  = dropdownBrand.getSelected();
            currentColorFilter  = dropdownColor.getSelected();
            currentTypeFilter   = dropdownType.getSelected();
```

### Step 13: Add `fetchAndInitDropdowns` function and call it on load

Add this function after `fetchLatestThumbnails` (before the filter event listeners block):

```javascript
    async function fetchAndInitDropdowns() {
        try {
            const response = await fetch('/api/filter_options');
            if (handle401(response)) return;
            if (!response.ok) return;
            const options = await response.json();
            dropdownBrand.populate(options.brands || []);
            dropdownColor.populate(options.colors || []);
            dropdownType.populate(options.types  || []);
            // Restore selection from URL
            if (currentBrandFilter.length) dropdownBrand.setSelected(currentBrandFilter);
            if (currentColorFilter.length) dropdownColor.setSelected(currentColorFilter);
            if (currentTypeFilter.length)  dropdownType.setSelected(currentTypeFilter);
        } catch (e) {
            console.error('Error loading filter options:', e);
        }
    }
```

**At the bottom of the DOMContentLoaded callback, find the three initial fetch calls:**
```javascript
    fetchPatentsTableData();
    fetchStats();
    Promise.resolve().then(fetchLatestThumbnails);
```

**Add `fetchAndInitDropdowns` to the initial calls:**
```javascript
    fetchPatentsTableData();
    fetchStats();
    Promise.resolve().then(fetchLatestThumbnails);
    Promise.resolve().then(fetchAndInitDropdowns);
```

### Step 14: Manual end-to-end verification

```bash
python app.py &
sleep 2
# Open http://127.0.0.1:5000 in browser after logging in
# Expected:
#  - Three dropdown buttons appear: "Marca", "Color", "Tipo"
#  - Clicking each opens a panel with checkboxes
#  - Checking values filters the table immediately (debounced)
#  - Selected count shows in button: "Marca (2)"
#  - "Limpiar" resets all dropdowns
#  - Reloading the page restores dropdown selection from URL
kill %1
```

### Step 15: Commit

```bash
git add static/script.js
git commit -m "Implement MultiSelectDropdown: replace brand/type inputs, add color dropdown"
```

---

## Final verification checklist

```bash
python app.py &
sleep 2
# Login
curl -s -c /tmp/c.txt -b /tmp/c.txt \
  -d "username=admin&password=admin123" -X POST http://127.0.0.1:5000/login

# 1. Filter options endpoint returns all three arrays
curl -s -c /tmp/c.txt -b /tmp/c.txt \
  http://127.0.0.1:5000/api/filter_options | python3 -c \
  "import sys,json; d=json.load(sys.stdin); print('brands:', len(d['brands']), 'colors:', len(d['colors']), 'types:', len(d['types']))"

# 2. Multi-brand filter returns only matching rows
curl -s -c /tmp/c.txt -b /tmp/c.txt \
  "http://127.0.0.1:5000/api/all_patents?brand_filter=Chevrolet,Ford&page_size=5" | \
  python3 -c "import sys,json; d=json.load(sys.stdin); brands=set(p['vehicle_brand'] for p in d['patents']); print('brands in result:', brands)"
# Expected: only Chevrolet and/or Ford appear

# 3. Color filter works
curl -s -c /tmp/c.txt -b /tmp/c.txt \
  "http://127.0.0.1:5000/api/filter_options" | python3 -c \
  "import sys,json; d=json.load(sys.stdin); print('first color:', d['colors'][0] if d['colors'] else 'none')"
# Use that color:
curl -s -c /tmp/c.txt -b /tmp/c.txt \
  "http://127.0.0.1:5000/api/all_patents?color_filter=Blanco&page_size=3" | \
  python3 -c "import sys,json; d=json.load(sys.stdin); print('total matching white:', d['total_count'])"

kill %1
```
