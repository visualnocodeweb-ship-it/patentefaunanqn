function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function debounce(fn, delay) {
    let timer;
    return function () {
        clearTimeout(timer);
        timer = setTimeout(fn, delay);
    };
}

document.addEventListener('DOMContentLoaded', () => {
    const BASE = document.querySelector('meta[name="app-base"]')?.content || '';

    // --- DOM refs ---
    const thumbnailStrip = document.getElementById('latest-thumbnails');
    const patentTableBody = document.querySelector('#patent-table tbody');
    const statsBar = document.getElementById('stats-bar');
    const paginationInfo = document.getElementById('pagination-info');
    const paginationButtons = document.getElementById('pagination-buttons');

    // Filter inputs
    const filterPatent = document.getElementById('filter-patent');
    const filterStartDate = document.getElementById('filter-start-date');
    const filterEndDate = document.getElementById('filter-end-date');
    const clearFiltersButton = document.getElementById('clear-all-filters-button');

    // Modal refs
    let _modalOpen = false;
    const imageModal = document.getElementById('imageModal');
    const modalImage = document.getElementById('modalImage');
    const modalError = document.getElementById('modal-error');
    const closeButton = document.querySelector('.close-button');
    const carouselCounter = document.getElementById('carousel-counter');
    const carouselCaption = document.getElementById('carousel-caption');
    const carouselPrev = document.querySelector('.carousel-prev');
    const carouselNext = document.querySelector('.carousel-next');
    const modalSpinner = document.getElementById('modal-spinner');

    const pageSize = 30;
    let totalPages = 0;
    let totalFilteredCount = 0;

    // Filter state
    let currentPage = 1;
    let currentPatentFilter = '';
    let currentBrandFilter = [];
    let currentColorFilter = [];
    let currentTypeFilter  = [];
    let currentStartDateFilter = '';
    let currentEndDateFilter = '';
    let currentMinConfidenceFilter = '';
    let currentInvalidPlatesOnly = false;
    let currentLocationFilter = [];
    let currentInvertFilters = false;

    // Cache for filter options (brands/colors/types) used by inline edit selects
    let filterOptionsCache = { brands: [], colors: [], types: [] };

    // AbortController for in-flight requests
    let tableAbort = null;
    let statsAbort = null;

    // Redirect to login page on 401 (session expired or not authenticated)
    function handle401(response) {
        if (response.status === 401) {
            window.location.href = '/login';
            return true;
        }
        return false;
    }

    // --- Multi-select dropdown component ---
    class MultiSelectDropdown {
        /**
         * @param {string} containerId  - ID of the <div> to mount into
         * @param {string} label        - Base label shown on trigger button
         * @param {function} onChange   - Called with no args whenever selection changes
         */
        constructor(containerId, label, onChange, opts = {}) {
            this._label = label;
            this._onChange = onChange;
            this._options = [];
            this._selected = new Set();
            this._valueMode = opts.valueMode || false;
            this._placeholder = opts.placeholder || label;

            // Build DOM
            this._root = document.createElement('div');
            this._root.className = 'ms-dropdown';

            this._trigger = document.createElement('button');
            this._trigger.type = 'button';
            this._trigger.className = 'ms-trigger';
            this._trigger.textContent = label;
            this._trigger.setAttribute('aria-haspopup', 'true');
            this._trigger.setAttribute('aria-expanded', 'false');

            this._panel = document.createElement('div');
            this._panel.className = 'ms-panel';
            this._panel.setAttribute('hidden', '');
            this._panel.setAttribute('role', 'group');
            this._panel.setAttribute('aria-label', label);

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
            this._outsideClickHandler = (e) => {
                if (!this._root.contains(e.target)) this._close();
            };
            document.addEventListener('click', this._outsideClickHandler);
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
            if (this._valueMode) {
                if (count === 0) {
                    this._trigger.textContent = this._placeholder;
                } else {
                    const first = [...this._selected][0];
                    this._trigger.textContent = count > 1 ? `${first} +${count - 1}` : first;
                }
            } else {
                this._trigger.textContent = count > 0 ? `${this._label} (${count})` : this._label;
            }
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
                cb.addEventListener('change', () => {
                    if (cb.checked) {
                        this._selected.add(opt);
                    } else {
                        this._selected.delete(opt);
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
            });
            this._updateTrigger();
        }

        /** Invert selection: select unselected, deselect selected. */
        invert() {
            this._options.forEach(opt => {
                if (this._selected.has(opt)) this._selected.delete(opt);
                else this._selected.add(opt);
            });
            this._panel.querySelectorAll('input[type="checkbox"]').forEach(cb => {
                cb.checked = this._selected.has(cb.value);
            });
            this._updateTrigger();
        }

        /** Clear all selections. */
        reset() {
            this._selected.clear();
            this._panel.querySelectorAll('input[type="checkbox"]').forEach(cb => {
                cb.checked = false;
            });
            this._updateTrigger();
        }
    }

    // Instantiate multi-select dropdowns
    const dropdownBrand     = new MultiSelectDropdown('filter-brand-container',    'Marca',    () => debouncedFetch());
    const dropdownColor     = new MultiSelectDropdown('filter-color-container',    'Color',    () => debouncedFetch());
    const dropdownType      = new MultiSelectDropdown('filter-type-container',     'Tipo',     () => debouncedFetch());
    const dropdownLocation  = new MultiSelectDropdown('filter-location-container', '', () => debouncedFetch(), { valueMode: true, placeholder: 'Todas' });

    // --- URL state management ---
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
            location:    splitParam('location_filter'),
            startDate:   params.get('start_date_filter') || '',
            endDate:     params.get('end_date_filter') || '',
            minConfidence: params.get('min_confidence_filter') || '',
            invalidPlatesOnly: params.get('invalid_plates_only') === 'true',
            invertFilters: params.get('invert_filters') === 'true'
        };
    }

    function pushFiltersToURL() {
        const params = new URLSearchParams();
        if (currentPage > 1) params.set('page', currentPage);
        if (currentPatentFilter) params.set('search_term', currentPatentFilter);
        if (currentBrandFilter.length)    params.set('brand_filter',    currentBrandFilter.join(','));
        if (currentColorFilter.length)    params.set('color_filter',    currentColorFilter.join(','));
        if (currentTypeFilter.length)     params.set('type_filter',     currentTypeFilter.join(','));
        if (currentLocationFilter.length) params.set('location_filter', currentLocationFilter.join(','));
        if (currentStartDateFilter) params.set('start_date_filter', currentStartDateFilter);
        if (currentEndDateFilter) params.set('end_date_filter', currentEndDateFilter);
        if (currentMinConfidenceFilter) params.set('min_confidence_filter', currentMinConfidenceFilter);
        if (currentInvalidPlatesOnly) params.set('invalid_plates_only', 'true');
        if (currentInvertFilters) params.set('invert_filters', 'true');
        const qs = params.toString();
        const newUrl = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
        history.replaceState(null, '', newUrl);
    }

    // Initialize from URL
    const urlState = getFiltersFromURL();
    currentPage = urlState.page;
    currentPatentFilter = urlState.patent;
    currentBrandFilter = urlState.brand;
    currentColorFilter = urlState.color;
    currentTypeFilter  = urlState.type;
    currentLocationFilter = urlState.location;
    currentStartDateFilter = urlState.startDate;
    currentEndDateFilter   = urlState.endDate;
    currentMinConfidenceFilter = urlState.minConfidence;
    currentInvalidPlatesOnly = urlState.invalidPlatesOnly;
    currentInvertFilters = urlState.invertFilters;

    // Populate inputs from URL state (dates are UTC in URL, local in input)
    filterPatent.value    = currentPatentFilter;
    filterStartDate.value = currentStartDateFilter ? toLocalISODateTime(new Date(currentStartDateFilter + 'Z')).slice(0, 16) : '';
    filterEndDate.value   = currentEndDateFilter ? toLocalISODateTime(new Date(currentEndDateFilter + 'Z')).slice(0, 16) : '';
    // Dropdowns: setSelected() is called after populate() in fetchAndInitDropdowns below
    // Restore toggle-button visual states from URL
    if (currentInvalidPlatesOnly) {
        document.getElementById('toggle-invalid-plates').classList.add('active');
    }
    if (currentInvertFilters) {
        document.getElementById('invert-selection-button').classList.add('active');
    }

    // --- Read all filter inputs into state ---
    function readAllFilters() {
        currentPatentFilter   = filterPatent.value.trim();
        currentBrandFilter    = dropdownBrand.getSelected();
        currentColorFilter    = dropdownColor.getSelected();
        currentTypeFilter     = dropdownType.getSelected();
        currentLocationFilter = dropdownLocation.getSelected();
        currentStartDateFilter = localToUTC(filterStartDate.value);
        currentEndDateFilter   = localToUTC(filterEndDate.value);
        currentMinConfidenceFilter = '';
        currentPage = 1;
        updateViewAllBtn();
    }

    function triggerFilteredFetch() {
        readAllFilters();
        fetchPatentsTableData();
        fetchStats();
    }

    const debouncedFetch = debounce(triggerFilteredFetch, 350);

    // --- Table row ---
    function createTableRow(item) {
        const row = document.createElement('tr');
        const plateLabel = escapeHtml(item.plate_text || 'desconocida');
        const editedBadge = item.is_manually_edited
            ? '<span class="edited-badge" title="Editado manualmente">✎</span>'
            : '';
        row.innerHTML = `
            <td>
                <input type="checkbox" class="row-checkbox"
                       data-event-id="${escapeHtml(item.event_id)}"
                       data-plate="${escapeHtml(item.plate_text || '')}"
                       data-brand="${escapeHtml(item.vehicle_brand || '')}"
                       data-color="${escapeHtml(item.vehicle_color || '')}"
                       data-type="${escapeHtml(item.vehicle_type || '')}">
            </td>
            <td>${item.sightings != null ? item.sightings : '-'}</td>
            <td>${editedBadge}${escapeHtml(item.plate_text) || 'No detectada'}</td>
            <td>${escapeHtml(item.vehicle_brand) || 'N/A'}</td>
            <td>${escapeHtml(item.vehicle_color) || 'N/A'}</td>
            <td>${escapeHtml(item.vehicle_type) || 'N/A'}</td>
            <td>${escapeHtml(item.location) || 'N/A'}</td>
            <td>${item.plate_confidence ? (item.plate_confidence * 100).toFixed(2) + '%' : 'N/A'}</td>
            <td>${new Date(item.created_at).toLocaleString()}</td>
            <td>
                ${item.thumbnail_id
                    ? `<button class="row-thumbnail-btn" data-event-id="${escapeHtml(item.event_id)}" aria-label="Ver imagen de patente ${plateLabel}"><img src="${BASE}/api/browse_image/${escapeHtml(String(item.thumbnail_id))}"
                           class="row-thumbnail" loading="lazy" alt=""></button>`
                    : `<button class="no-image-label" data-event-id="${escapeHtml(item.event_id)}" aria-label="Ver imágenes del evento para patente ${plateLabel}">Sin imagen</button>`}
            </td>
        `;
        return row;
    }

    function displayPatentTableResults(results) {
        // Unlock column widths so they adapt to new content
        const thead = patentTableBody.closest('table').querySelector('thead tr');
        if (thead && thead._widthsLocked) {
            Array.from(thead.cells).forEach(th => { th.style.width = ''; });
            thead._widthsLocked = false;
        }
        patentTableBody.innerHTML = '';
        selectAllCheckbox.checked = false;
        selectAllCheckbox.indeterminate = false;
        selectionActionBtn.style.display = 'none';
        if (results.length === 0) {
            const noResultsRow = document.createElement('tr');
            noResultsRow.innerHTML = '<td colspan="10">No se encontraron patentes.</td>';
            patentTableBody.appendChild(noResultsRow);
            return;
        }
        results.forEach(item => {
            patentTableBody.appendChild(createTableRow(item));
        });
    }

    // --- Pagination ---
    function buildPageNumbers(current, total) {
        // Show more pages before compacting:
        // - first 5 pages
        // - around current: previous 2 and next 5
        // - last 3 pages
        const pages = new Set();
        for (let i = 1; i <= Math.min(5, total); i++) {
            pages.add(i);
        }
        for (let i = Math.max(1, total - 2); i <= total; i++) {
            pages.add(i);
        }
        for (let i = current - 2; i <= current + 5; i++) {
            if (i >= 1 && i <= total) pages.add(i);
        }
        const sorted = Array.from(pages).sort((a, b) => a - b);
        const result = [];
        for (let i = 0; i < sorted.length; i++) {
            if (i > 0 && sorted[i] - sorted[i - 1] > 1) {
                result.push('…');
            }
            result.push(sorted[i]);
        }
        return result;
    }

    function updatePaginationControls(totalCount) {
        // Info text
        if (totalCount === undefined) totalCount = 0;
        const start = totalCount === 0 ? 0 : (currentPage - 1) * pageSize + 1;
        const end = Math.min(currentPage * pageSize, totalCount);
        paginationInfo.textContent = totalCount > 0
            ? `Mostrando ${start}\u2013${end} de ${totalCount}`
            : 'Sin resultados';

        // Build buttons
        paginationButtons.innerHTML = '';
        if (totalPages <= 1) return;

        const items = buildPageNumbers(currentPage, totalPages);

        // Prev button
        const prevBtn = document.createElement('button');
        prevBtn.innerHTML = '<span aria-hidden="true">&laquo;</span>';
        prevBtn.setAttribute('aria-label', 'Página anterior');
        prevBtn.dataset.page = currentPage - 1;
        prevBtn.disabled = currentPage === 1;
        prevBtn.title = 'Anterior';
        paginationButtons.appendChild(prevBtn);

        items.forEach(item => {
            if (item === '…') {
                const span = document.createElement('span');
                span.className = 'ellipsis';
                span.textContent = '…';
                paginationButtons.appendChild(span);
            } else {
                const btn = document.createElement('button');
                btn.textContent = item;
                btn.dataset.page = item;
                if (item === currentPage) btn.classList.add('active');
                paginationButtons.appendChild(btn);
            }
        });

        // Next button
        const nextBtn = document.createElement('button');
        nextBtn.innerHTML = '<span aria-hidden="true">&raquo;</span>';
        nextBtn.setAttribute('aria-label', 'Página siguiente');
        nextBtn.dataset.page = currentPage + 1;
        nextBtn.disabled = currentPage === totalPages;
        nextBtn.title = 'Siguiente';
        paginationButtons.appendChild(nextBtn);
    }

    // --- Fetch table data ---
    async function fetchPatentsTableData() {
        if (tableAbort) tableAbort.abort();
        tableAbort = new AbortController();

        patentTableBody.innerHTML = '<tr><td colspan="10">Cargando patentes\u2026</td></tr>';
        let url = `${BASE}/api/all_patents?page=${currentPage}&page_size=${pageSize}`;
        if (currentPatentFilter) url += `&search_term=${encodeURIComponent(currentPatentFilter)}`;
        if (currentBrandFilter.length)    url += `&brand_filter=${encodeURIComponent(currentBrandFilter.join(','))}`;
        if (currentColorFilter.length)    url += `&color_filter=${encodeURIComponent(currentColorFilter.join(','))}`;
        if (currentTypeFilter.length)     url += `&type_filter=${encodeURIComponent(currentTypeFilter.join(','))}`;
        if (currentLocationFilter.length) url += `&location_filter=${encodeURIComponent(currentLocationFilter.join(','))}`;
        if (currentStartDateFilter) url += `&start_date_filter=${encodeURIComponent(currentStartDateFilter)}`;
        if (currentEndDateFilter) url += `&end_date_filter=${encodeURIComponent(currentEndDateFilter)}`;
        if (currentMinConfidenceFilter) {
            url += `&min_confidence_filter=${encodeURIComponent(currentMinConfidenceFilter / 100)}`;
        }
        if (currentInvalidPlatesOnly) url += '&invalid_plates_only=true';
        if (currentInvertFilters) url += '&invert_filters=true';

        pushFiltersToURL();

        try {
            const response = await fetch(url, { signal: tableAbort.signal });
            if (handle401(response)) return;
            const data = await response.json();
            displayPatentTableResults(data.patents);
            totalPages = Math.ceil(data.total_count / pageSize);
            totalFilteredCount = data.total_count;
            updatePaginationControls(data.total_count);
        } catch (error) {
            if (error.name === 'AbortError') return;
            console.error('Error fetching all patents:', error);
            patentTableBody.innerHTML = '<tr><td colspan="10">Error al cargar las patentes.</td></tr>';
        }
    }

    // --- Stats ---
    async function fetchStats() {
        if (statsAbort) statsAbort.abort();
        statsAbort = new AbortController();

        let url = `${BASE}/api/stats`;
        const params = new URLSearchParams();
        if (currentPatentFilter) params.set('search_term', currentPatentFilter);
        if (currentBrandFilter.length)    params.set('brand_filter',    currentBrandFilter.join(','));
        if (currentColorFilter.length)    params.set('color_filter',    currentColorFilter.join(','));
        if (currentTypeFilter.length)     params.set('type_filter',     currentTypeFilter.join(','));
        if (currentLocationFilter.length) params.set('location_filter', currentLocationFilter.join(','));
        if (currentStartDateFilter) params.set('start_date', currentStartDateFilter);
        if (currentEndDateFilter) params.set('end_date', currentEndDateFilter);
        if (currentMinConfidenceFilter) params.set('min_confidence_filter', currentMinConfidenceFilter / 100);
        if (currentInvalidPlatesOnly) params.set('invalid_plates_only', 'true');
        if (currentInvertFilters) params.set('invert_filters', 'true');
        const qs = params.toString();
        if (qs) url += '?' + qs;

        try {
            const response = await fetch(url, { signal: statsAbort.signal });
            if (handle401(response)) return;
            const data = await response.json();
            renderStats(data);
        } catch (error) {
            if (error.name === 'AbortError') return;
            console.error('Error fetching stats:', error);
            statsBar.textContent = 'Error al cargar estadísticas.';
        }
    }

    function renderStats(data) {
        statsBar.innerHTML = '';

        function buildRow(items) {
            const row = document.createElement('div');
            row.className = 'stats-row';
            items.forEach(item => {
                const el = document.createElement('span');
                el.className = 'stat-item';
                const label = document.createElement('span');
                label.className = 'stat-label';
                label.textContent = item.label + ':';
                const value = document.createElement('span');
                value.className = 'stat-value' + (item.cls ? ' ' + item.cls : '');
                value.textContent = item.value;
                el.appendChild(label);
                el.appendChild(value);
                row.appendChild(el);
            });
            return row;
        }

        const row1 = [
            { label: 'Detecciones', value: data.total },
            { label: 'Patentes únicas', value: data.unique_plates },
            { label: 'Det./hora', value: data.detections_per_hour },
        ];
        if (data.last_detection_at) {
            row1.push({ label: 'Última detección', value: timeSince(new Date(data.last_detection_at)) });
        }

        const row2 = [
            { label: 'Conf. promedio', value: (data.avg_confidence * 100).toFixed(1) + '%' },
            { label: 'Alta (\u226590%)', value: data.high_conf },
            { label: 'Media (70-90%)', value: data.mid_conf },
            { label: 'Baja conf. (<70%)', value: data.low_confidence_count },
        ];

        statsBar.appendChild(buildRow(row1));
        statsBar.appendChild(buildRow(row2));
    }

    function timeSince(date) {
        const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
        if (seconds < 60) return 'hace ' + seconds + 's';
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return 'hace ' + minutes + 'min';
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return 'hace ' + hours + 'h';
        const days = Math.floor(hours / 24);
        return 'hace ' + days + 'd';
    }

    // --- Thumbnails ---
    async function fetchLatestThumbnails() {
        try {
            const response = await fetch(`${BASE}/api/recent_thumbnails?limit=7`);
            if (handle401(response)) return;
            const data = await response.json();
            thumbnailStrip.innerHTML = '';
            data.forEach(item => {
                const plateText = item.plate_text || 'Detección';
                const btn = document.createElement('button');
                btn.className = 'thumbnail-btn';
                btn.setAttribute('aria-label', `Ver imagen de patente ${plateText}`);
                const img = document.createElement('img');
                img.className = 'thumbnail';
                img.src = `${BASE}/api/browse_image/${item.image_id}`;
                img.alt = '';
                img.width = 120;
                img.height = 80;
                btn.appendChild(img);
                btn.addEventListener('click', () => openModalForEvent(item.event_id));
                thumbnailStrip.appendChild(btn);
            });
            // "Ver Todas" button
            viewAllBtn = document.createElement('button');
            viewAllBtn.className = 'thumbnail view-all-btn';
            viewAllBtn.textContent = 'Ver Todas';
            viewAllBtn.addEventListener('click', openBrowseCarousel);
            thumbnailStrip.appendChild(viewAllBtn);
            updateViewAllBtn();
        } catch (error) {
            console.error('Error fetching thumbnails:', error);
        }
    }

    async function fetchAndInitDropdowns() {
        try {
            const response = await fetch(`${BASE}/api/filter_options`);
            if (handle401(response)) return;
            if (!response.ok) {
                console.warn('filter_options returned', response.status, '— dropdowns will be empty');
                return;
            }
            const options = await response.json();
            filterOptionsCache = {
                brands:    options.brands    || [],
                colors:    options.colors    || [],
                types:     options.types     || [],
                locations: options.locations || [],
            };
            dropdownBrand.populate(filterOptionsCache.brands);
            dropdownColor.populate(filterOptionsCache.colors);
            dropdownType.populate(filterOptionsCache.types);
            dropdownLocation.populate(filterOptionsCache.locations);
            // Restore selection from URL — intersect with available options to drop stale values
            const brandSet    = new Set(options.brands    || []);
            const colorSet    = new Set(options.colors    || []);
            const typeSet     = new Set(options.types     || []);
            const locationSet = new Set(options.locations || []);
            const validBrand    = currentBrandFilter.filter(v => brandSet.has(v));
            const validColor    = currentColorFilter.filter(v => colorSet.has(v));
            const validType     = currentTypeFilter.filter(v => typeSet.has(v));
            const validLocation = currentLocationFilter.filter(v => locationSet.has(v));
            if (validBrand.length)    dropdownBrand.setSelected(validBrand);
            if (validColor.length)    dropdownColor.setSelected(validColor);
            if (validType.length)     dropdownType.setSelected(validType);
            if (validLocation.length) dropdownLocation.setSelected(validLocation);
            // Re-sync state vars in case stale URL values were dropped during validation
            currentBrandFilter    = dropdownBrand.getSelected();
            currentColorFilter    = dropdownColor.getSelected();
            currentTypeFilter     = dropdownType.getSelected();
            currentLocationFilter = dropdownLocation.getSelected();
            updateViewAllBtn();
        } catch (e) {
            console.error('Error loading filter options:', e);
        }
    }

    // --- Filter event listeners ---
    // Text/number inputs: debounced on input, immediate on Enter
    filterPatent.addEventListener('input', debouncedFetch);
    filterPatent.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            triggerFilteredFetch();
        }
    });

    // Date inputs: immediate on change
    [filterStartDate, filterEndDate].forEach(input => {
        input.addEventListener('change', triggerFilteredFetch);
    });

    // Clear all filters
    const invertBtn = document.getElementById('invert-selection-button');
    const filterControls = [
        filterPatent, filterStartDate, filterEndDate,
        document.getElementById('toggle-invalid-plates'),
        ...document.querySelectorAll('[data-preset]'),
    ];

    function setFiltersDisabled(disabled) {
        filterControls.forEach(el => { if (el) el.disabled = disabled; });
        [dropdownBrand, dropdownColor, dropdownType, dropdownLocation].forEach(dd => {
            dd._trigger.disabled = disabled;
        });
        document.querySelector('.table-controls').classList.toggle('filters-locked', disabled);
    }

    invertBtn.addEventListener('click', () => {
        currentInvertFilters = !currentInvertFilters;
        invertBtn.classList.toggle('active', currentInvertFilters);
        setFiltersDisabled(currentInvertFilters);
        currentPage = 1;
        fetchPatentsTableData();
        fetchStats();
    });

    clearFiltersButton.addEventListener('click', () => {
        filterPatent.value = '';
        dropdownBrand.reset();
        dropdownColor.reset();
        dropdownType.reset();
        dropdownLocation.reset();
        filterStartDate.value = '';
        filterEndDate.value = '';
        currentInvalidPlatesOnly = false;
        currentInvertFilters = false;
        invertBtn.classList.remove('active');
        setFiltersDisabled(false);
        document.querySelectorAll('.time-preset-btn').forEach(b => b.classList.remove('active'));
        triggerFilteredFetch();
    });

    // --- Time preset buttons ---
    function toLocalISODate(date) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    function toLocalISODateTime(date) {
        return toLocalISODate(date) + 'T' + date.toTimeString().slice(0, 8);
    }

    /** Convert a datetime-local input value (local time) to UTC ISO string for the API. */
    function localToUTC(localValue) {
        if (!localValue) return '';
        // Avoid Date(string) parsing ambiguity across browsers.
        // datetime-local has no timezone; interpret it explicitly as local time.
        const m = localValue.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
        if (!m) return '';
        const year = Number(m[1]);
        const month = Number(m[2]) - 1;
        const day = Number(m[3]);
        const hour = Number(m[4]);
        const minute = Number(m[5]);
        const second = Number(m[6] || '00');
        const localDate = new Date(year, month, day, hour, minute, second, 0);
        if (Number.isNaN(localDate.getTime())) return '';
        return localDate.toISOString().slice(0, 19);
    }

    document.querySelectorAll('[data-preset]').forEach(btn => {
        btn.addEventListener('click', () => {
            const preset = btn.dataset.preset;
            const now = new Date();

            document.querySelectorAll('[data-preset]').forEach(b => b.classList.remove('active'));

            if (preset === 'clear') {
                filterStartDate.value = '';
                filterEndDate.value = '';
            } else {
                btn.classList.add('active');
                let start;
                if (preset === '1h') {
                    start = new Date(now.getTime() - 60 * 60 * 1000);
                } else if (preset === 'today') {
                    start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                } else if (preset === '24h') {
                    start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
                } else if (preset === '7d') {
                    start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                }
                // UTC for API, local for input display
                currentStartDateFilter = start.toISOString().slice(0, 19);
                currentEndDateFilter = now.toISOString().slice(0, 19);
                filterStartDate.value = toLocalISODateTime(start).slice(0, 16);
                filterEndDate.value = toLocalISODateTime(now).slice(0, 16);
            }
            // Read other filters too, then fetch
            currentPatentFilter = filterPatent.value.trim();
            currentBrandFilter  = dropdownBrand.getSelected();
            currentColorFilter  = dropdownColor.getSelected();
            currentTypeFilter   = dropdownType.getSelected();
            currentMinConfidenceFilter = '';
            if (preset === 'clear') {
                currentStartDateFilter = '';
                currentEndDateFilter = '';
            }
            currentPage = 1;
            fetchPatentsTableData();
            fetchStats();
            updateViewAllBtn();
        });
    });

    // --- Invalid plates toggle ---
    document.getElementById('toggle-invalid-plates').addEventListener('click', function() {
        currentInvalidPlatesOnly = !currentInvalidPlatesOnly;
        this.classList.toggle('active', currentInvalidPlatesOnly);
        currentPage = 1;
        fetchPatentsTableData();
        fetchStats();
    });

    // --- Pagination (event delegation) ---
    paginationButtons.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn || btn.disabled) return;
        const page = parseInt(btn.dataset.page);
        if (page && page >= 1 && page <= totalPages && page !== currentPage) {
            currentPage = page;
            fetchPatentsTableData();
        }
    });

    // --- Modal mode ---
    let modalMode = null; // 'event' | 'browse'

    // --- Carousel / Modal (event mode) ---
    let carouselImages = [];
    let carouselIndex = 0;

    // --- Browse mode state ---
    let browseItems = [];
    let browseIndex = 0;
    let browseTotalCount = 0;
    let browseTypes = ['vehicle_picture'];
    let browseAbort = null;
    const preloadedBrowseImageIds = new Set();
    const browseFilters = document.getElementById('browse-filters');

    function preloadBrowseImageById(imageId) {
        if (!imageId || preloadedBrowseImageIds.has(imageId)) return;
        preloadedBrowseImageIds.add(imageId);
        const pre = new Image();
        pre.src = BASE + '/api/browse_image/' + imageId;
    }

    function showModalError(msg) {
        modalError.textContent = msg;
        modalError.hidden = false;
        modalImage.style.display = 'none';
        carouselCounter.textContent = '';
        carouselCaption.textContent = '';
        carouselPrev.style.display = 'none';
        carouselNext.style.display = 'none';
    }

    function hideModalError() {
        modalError.textContent = '';
        modalError.hidden = true;
        modalImage.style.display = 'block';
    }

    function showSlide(index) {
        if (carouselImages.length === 0) return;
        carouselIndex = ((index % carouselImages.length) + carouselImages.length) % carouselImages.length;
        const img = carouselImages[carouselIndex];
        modalImage.src = `data:image/jpeg;base64,${img.image_data}`;
        modalImage.alt = `Imagen ${img.image_type || ''} — Patente ${img.plate_text || 'desconocida'}`;
        carouselCounter.textContent = `${carouselIndex + 1} / ${carouselImages.length}`;
        carouselCaption.textContent = img.image_type || '';
        const showNav = carouselImages.length > 1;
        carouselPrev.style.display = showNav ? '' : 'none';
        carouselNext.style.display = showNav ? '' : 'none';
    }

    carouselPrev.addEventListener('click', () => {
        if (modalMode === 'browse') browseShowSlide(browseIndex - 1);
        else showSlide(carouselIndex - 1);
    });
    carouselNext.addEventListener('click', () => {
        if (modalMode === 'browse') browseShowSlide(browseIndex + 1);
        else showSlide(carouselIndex + 1);
    });

    function showSpinner() {
        modalSpinner.hidden = false;
        modalImage.style.display = 'none';
        carouselPrev.style.display = 'none';
        carouselNext.style.display = 'none';
        carouselCounter.textContent = '';
        carouselCaption.textContent = '';
    }

    function hideSpinner() {
        modalSpinner.hidden = true;
    }

    async function openModalForEvent(eventId) {
        modalMode = 'event';
        browseFilters.hidden = true;
        hideModalError();
        showSpinner();
        imageModal.style.display = 'flex';
        _modalOpen = true;
        try {
            const response = await fetch(`${BASE}/api/image/${eventId}`);
            if (handle401(response)) return;
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            hideSpinner();
            if (data && data.images && data.images.length > 0) {
                hideModalError();
                carouselImages = data.images;
                showSlide(0);
            } else {
                carouselImages = [];
                showModalError('No se encontró imagen para este evento.');
            }
        } catch (error) {
            console.error('Error al obtener la imagen:', error);
            hideSpinner();
            carouselImages = [];
            showModalError('Error al cargar la imagen.');
        }
    }

    // Table click delegation
    patentTableBody.addEventListener('click', (event) => {
        const target = event.target;

        // Thumbnail click
        const thumbBtn = target.closest('.row-thumbnail-btn, .no-image-label');
        if (thumbBtn) {
            const eventId = thumbBtn.dataset.eventId;
            if (eventId) openModalForEvent(eventId);
            return;
        }

        // Save edit button
        if (target.classList.contains('save-row-btn')) {
            const row = target.closest('tr');
            saveEditRow(row);
            return;
        }

        // Cancel edit button
        if (target.classList.contains('cancel-row-btn')) {
            const row = target.closest('tr');
            cancelEditRow(row);
            return;
        }
    });

    function enterEditMode(row, editBtn) {
        if (row.classList.contains('row-editing')) return; // already editing

        const eventId = editBtn.dataset.eventId;

        // Store original HTML for cancel and original cell values for re-render after save
        row._originalHTML = row.innerHTML;
        row._eventId = eventId;
        row._originalLocationCell = row.cells[6].innerHTML;
        row._originalConfCell = row.cells[7].innerHTML;
        row._originalDateCell = row.cells[8].innerHTML;

        // Read current values from data attributes (sourced from DB at table load time)
        const plate = editBtn.dataset.plate || '';
        const brand = editBtn.dataset.brand || '';
        const color = editBtn.dataset.color || '';
        const type  = editBtn.dataset.type  || '';

        function makeSelect(options, current) {
            const sel = document.createElement('select');
            const blank = document.createElement('option');
            blank.value = '';
            blank.textContent = '—';
            sel.appendChild(blank);
            options.forEach(opt => {
                const o = document.createElement('option');
                o.value = opt;
                o.textContent = opt;
                if (opt === current) o.defaultSelected = true;
                sel.appendChild(o);
            });
            if (current && !options.includes(current)) {
                const o = document.createElement('option');
                o.value = current;
                o.textContent = current;
                o.defaultSelected = true;
                sel.appendChild(o);
            }
            return sel.outerHTML;
        }

        const cells = row.cells;
        // cells: 0=checkbox, 1=sightings, 2=plate, 3=brand, 4=color, 5=type, 6=location, 7=conf, 8=date, 9=thumbnail

        // Lock column widths on <th> to prevent layout shift when inputs replace text
        const thead = row.closest('table').querySelector('thead tr');
        if (thead && !thead._widthsLocked) {
            Array.from(thead.cells).forEach(th => { th.style.width = th.offsetWidth + 'px'; });
            thead._widthsLocked = true;
        }

        // Plate cell (index 2)
        cells[2].innerHTML = `<input type="text" class="edit-plate-input" value="${escapeHtml(plate)}" maxlength="10">`;

        // Brand cell (index 3)
        cells[3].innerHTML = makeSelect(filterOptionsCache.brands, brand);

        // Color cell (index 4)
        cells[4].innerHTML = makeSelect(filterOptionsCache.colors, color);

        // Type cell (index 5)
        cells[5].innerHTML = makeSelect(filterOptionsCache.types, type);

        // Actions in thumbnail cell (index 9) — stack vertically to avoid column overflow
        cells[9].innerHTML = `<button class="save-row-btn">Guardar</button><button class="cancel-row-btn">Cancelar</button>`;

        row.classList.add('row-editing');
    }

    async function saveEditRow(row) {
        const eventId = row._eventId;
        const plateInput = row.querySelector('.edit-plate-input');
        const selects = row.querySelectorAll('td select');

        const plateText   = plateInput ? plateInput.value.trim() : '';
        const vehicleBrand = selects[0] ? selects[0].value.trim() : '';
        const vehicleColor = selects[1] ? selects[1].value.trim() : '';
        const vehicleType  = selects[2] ? selects[2].value.trim() : '';

        if (!plateText) {
            plateInput && (plateInput.style.borderColor = 'red');
            return;
        }

        if (!confirm('¿Guardar los cambios?')) return;

        const saveBtn = row.querySelector('.save-row-btn');
        if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '…'; }

        try {
            const resp = await fetch(`${BASE}/api/event/${eventId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    plate_text: plateText,
                    vehicle_brand: vehicleBrand,
                    vehicle_color: vehicleColor,
                    vehicle_type: vehicleType
                })
            });
            if (handle401(resp)) return;
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                alert(err.error || 'Error al guardar.');
                if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Guardar'; }
                return;
            }

            // Re-render row with updated data
            row.classList.remove('row-editing');
            const item = {
                event_id: eventId,
                sightings: row.cells[1].textContent,
                plate_text: plateText,
                vehicle_brand: vehicleBrand || null,
                vehicle_color: vehicleColor || null,
                vehicle_type:  vehicleType  || null,
                plate_confidence: null,
                created_at: row._originalCreatedAt,
                is_manually_edited: true
            };
            // Extract confidence and date from original row cells (unchanged)
            const newRow = createTableRow(item);
            // Preserve original confidence and date from stored cells
            newRow.cells[6].innerHTML = row._originalLocationCell || newRow.cells[6].innerHTML;
            newRow.cells[7].innerHTML = row._originalConfCell || newRow.cells[7].innerHTML;
            newRow.cells[8].innerHTML = row._originalDateCell || newRow.cells[8].innerHTML;
            row.parentNode.replaceChild(newRow, row);
            // Unlock column widths
            const thead = newRow.closest('table').querySelector('thead tr');
            if (thead && thead._widthsLocked) {
                Array.from(thead.cells).forEach(th => { th.style.width = ''; });
                thead._widthsLocked = false;
            }
        } catch (e) {
            console.error('Error saving edit:', e);
            if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Guardar'; }
        }
    }

    function cancelEditRow(row) {
        row.classList.remove('row-editing');
        row.innerHTML = row._originalHTML;
        // Unlock column widths so table adapts naturally
        const thead = row.closest('table').querySelector('thead tr');
        if (thead && thead._widthsLocked) {
            Array.from(thead.cells).forEach(th => { th.style.width = ''; });
            thead._widthsLocked = false;
        }
    }

    // --- Checkbox selection + action button ---
    const selectAllCheckbox = document.getElementById('select-all-checkbox');
    const selectionActionBtn = document.getElementById('selection-action-btn');

    selectAllCheckbox.addEventListener('change', () => {
        const checkboxes = patentTableBody.querySelectorAll('.row-checkbox');
        checkboxes.forEach(cb => {
            cb.checked = selectAllCheckbox.checked;
            const row = cb.closest('tr');
            if (row) row.classList.toggle('row-selected', cb.checked);
        });
        updateSelectionAction();
    });

    patentTableBody.addEventListener('change', (event) => {
        if (event.target.classList.contains('row-checkbox')) {
            const cb = event.target;
            const row = cb.closest('tr');
            if (row) row.classList.toggle('row-selected', cb.checked);
            const all = patentTableBody.querySelectorAll('.row-checkbox');
            const checked = patentTableBody.querySelectorAll('.row-checkbox:checked');
            selectAllCheckbox.checked = all.length > 0 && checked.length === all.length;
            selectAllCheckbox.indeterminate = checked.length > 0 && checked.length < all.length;
            updateSelectionAction();
        }
    });

    function updateSelectionAction() {
        const checked = patentTableBody.querySelectorAll('.row-checkbox:checked');
        if (checked.length === 0) {
            selectionActionBtn.style.display = 'none';
            selectionActionBtn.className = 'selection-action-btn';
        } else if (checked.length === 1) {
            selectionActionBtn.style.display = '';
            selectionActionBtn.textContent = 'Editar';
            selectionActionBtn.className = 'selection-action-btn action-edit';
        } else {
            selectionActionBtn.style.display = '';
            selectionActionBtn.textContent = `Exportar CSV (${totalFilteredCount})`;
            selectionActionBtn.className = 'selection-action-btn action-export';
        }
    }

    selectionActionBtn.addEventListener('click', () => {
        const checked = patentTableBody.querySelectorAll('.row-checkbox:checked');
        if (checked.length === 1) {
            const cb = checked[0];
            const row = cb.closest('tr');
            enterEditMode(row, cb);
        } else if (checked.length >= 2) {
            exportFilteredCSV();
        }
    });

    function buildFilterQueryString() {
        const parts = [];
        if (currentPatentFilter) parts.push(`search_term=${encodeURIComponent(currentPatentFilter)}`);
        if (currentBrandFilter.length) parts.push(`brand_filter=${encodeURIComponent(currentBrandFilter.join(','))}`);
        if (currentColorFilter.length) parts.push(`color_filter=${encodeURIComponent(currentColorFilter.join(','))}`);
        if (currentTypeFilter.length) parts.push(`type_filter=${encodeURIComponent(currentTypeFilter.join(','))}`);
        if (currentLocationFilter.length) parts.push(`location_filter=${encodeURIComponent(currentLocationFilter.join(','))}`);
        if (currentStartDateFilter) parts.push(`start_date_filter=${encodeURIComponent(currentStartDateFilter)}`);
        if (currentEndDateFilter) parts.push(`end_date_filter=${encodeURIComponent(currentEndDateFilter)}`);
        if (currentMinConfidenceFilter) parts.push(`min_confidence_filter=${encodeURIComponent(currentMinConfidenceFilter / 100)}`);
        if (currentInvalidPlatesOnly) parts.push('invalid_plates_only=true');
        if (currentInvertFilters) parts.push('invert_filters=true');
        return parts.join('&');
    }

    async function exportFilteredCSV() {
        const btn = selectionActionBtn;
        const originalText = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Exportando…';

        try {
            const allItems = [];
            let page = 1;
            const batchSize = 100;
            const qs = buildFilterQueryString();

            while (true) {
                const url = `${BASE}/api/all_patents?page=${page}&page_size=${batchSize}${qs ? '&' + qs : ''}`;
                const resp = await fetch(url);
                if (handle401(resp)) return;
                const data = await resp.json();
                allItems.push(...data.patents);
                if (allItems.length >= data.total_count || data.patents.length < batchSize) break;
                page++;
            }

            const headers = ['Patente', 'Marca', 'Color', 'Tipo', 'Locación', 'Confianza', 'Fecha y Hora'];
            const csvRows = [headers.join(',')];
            allItems.forEach(item => {
                const conf = item.plate_confidence ? (item.plate_confidence * 100).toFixed(2) + '%' : 'N/A';
                const date = item.created_at ? new Date(item.created_at).toLocaleString() : '';
                const vals = [
                    item.plate_text || 'No detectada',
                    item.vehicle_brand || 'N/A',
                    item.vehicle_color || 'N/A',
                    item.vehicle_type || 'N/A',
                    item.location || 'N/A',
                    conf,
                    date
                ].map(v => `"${String(v).replace(/"/g, '""')}"`);
                csvRows.push(vals.join(','));
            });

            const bom = '\uFEFF';
            const blob = new Blob([bom + csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
            const blobUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const today = new Date().toISOString().slice(0, 10);
            a.href = blobUrl;
            a.download = `patentes_${today}.csv`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(blobUrl);
        } catch (e) {
            console.error('Error exporting CSV:', e);
            alert('Error al exportar CSV.');
        } finally {
            btn.disabled = false;
            btn.textContent = originalText;
        }
    }

    function closeModal() {
        imageModal.style.display = 'none';
        _modalOpen = false;
        modalImage.src = '';
        modalMode = null;
        // Event mode cleanup
        carouselImages = [];
        carouselIndex = 0;
        // Browse mode cleanup
        browseItems = [];
        browseIndex = 0;
        browseTotalCount = 0;
        if (browseAbort) { browseAbort.abort(); browseAbort = null; }
        browseFilters.hidden = true;
        // Shared cleanup
        carouselCounter.textContent = '';
        carouselCaption.textContent = '';
        hideModalError();
    }

    closeButton.addEventListener('click', closeModal);

    window.addEventListener('click', (event) => {
        if (event.target === imageModal) closeModal();
    });

    document.addEventListener('keydown', (event) => {
        if (_modalOpen) {
            if (event.key === 'Escape') closeModal();
            else if (event.key === 'ArrowLeft') {
                if (modalMode === 'browse') browseShowSlide(browseIndex - 1);
                else showSlide(carouselIndex - 1);
            } else if (event.key === 'ArrowRight') {
                if (modalMode === 'browse') browseShowSlide(browseIndex + 1);
                else showSlide(carouselIndex + 1);
            }
        }
    });

    // --- Browse mode functions ---
    async function browseLoadPage(direction) {
        if (browseAbort) browseAbort.abort();
        browseAbort = new AbortController();

        const cursor = direction === 'forward'
            ? browseItems[browseItems.length - 1]
            : browseItems[0];

        const params = new URLSearchParams({
            limit: '5',
            direction: direction,
            types: browseTypes.join(',')
        });
        if (cursor) {
            params.set('cursor_ts', cursor.created_at);
            params.set('cursor_id', cursor.image_id);
        }
        // Inherit active table filters
        if (currentStartDateFilter) params.set('start_date', currentStartDateFilter);
        if (currentEndDateFilter) params.set('end_date', currentEndDateFilter);
        if (currentPatentFilter) params.set('search_term', currentPatentFilter);
        if (currentBrandFilter.length)  params.set('brand_filter',        currentBrandFilter.join(','));
        if (currentColorFilter.length)  params.set('color_filter',        currentColorFilter.join(','));
        if (currentTypeFilter.length)   params.set('vehicle_type_filter', currentTypeFilter.join(','));

        try {
            const resp = await fetch(`${BASE}/api/browse_images?` + params, { signal: browseAbort.signal });
            if (handle401(resp)) return 0;
            const data = await resp.json();
            if (direction === 'forward') browseItems.push(...data.images);
            else browseItems.unshift(...data.images);
            if (data.total_count !== undefined) browseTotalCount = data.total_count;
            return data.images.length;
        } catch (e) {
            if (e.name === 'AbortError') return 0;
            console.error('Error loading browse page:', e);
            return 0;
        }
    }

    function browseShowSlide(index) {
        if (browseItems.length === 0) return;
        if (index < 0) index = 0;
        if (index >= browseItems.length) index = browseItems.length - 1;
        browseIndex = index;

        const item = browseItems[browseIndex];

        // Set handlers BEFORE src so cached images don't miss onload
        modalImage.onload = function () {
            hideSpinner();
            modalImage.style.display = 'block';
        };
        modalImage.onerror = function () {
            hideSpinner();
            showModalError('Error al cargar la imagen.');
        };

        // Show spinner (hides image + clears text), then set src
        modalSpinner.hidden = false;
        modalImage.style.display = 'none';
        modalImage.src = BASE + '/api/browse_image/' + item.image_id;
        preloadedBrowseImageIds.add(item.image_id);
        const browseTypeLabels = { vehicle_detection: 'Detección', vehicle_picture: 'Vehículo', plate: 'Patente' };
        modalImage.alt = `Imagen ${browseTypeLabels[item.image_type] || item.image_type} — Patente ${item.plate_text || 'desconocida'}`;

        // Set counter/caption AFTER spinner setup (don't call showSpinner which clears them)
        carouselCounter.textContent = `${browseIndex + 1} / ${browseTotalCount}`;
        const typeLabels = { vehicle_detection: 'Detección', vehicle_picture: 'Vehículo', plate: 'Patente' };
        const typeLabel = typeLabels[item.image_type] || item.image_type;
        const ts = new Date(item.created_at).toLocaleString();
        carouselCaption.textContent = `${item.plate_text || 'Sin patente'} — ${typeLabel} — ${ts}`;

        const showNav = browseTotalCount > 1;
        carouselPrev.style.display = showNav ? '' : 'none';
        carouselNext.style.display = showNav ? '' : 'none';

        // Preload nearby images conservatively to avoid request bursts.
        for (let offset = -1; offset <= 1; offset++) {
            const i = browseIndex + offset;
            if (offset !== 0 && i >= 0 && i < browseItems.length) {
                preloadBrowseImageById(browseItems[i].image_id);
            }
        }

        // Prefetch next metadata page if near end
        if (browseIndex >= browseItems.length - 2) {
            browsePrefetch();
        }
    }

    // Prefetch metadata + preload image binaries into browser cache
    let prefetchInFlight = false;
    let viewAllBtn = null;

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

    async function browsePrefetch() {
        if (prefetchInFlight) return;
        prefetchInFlight = true;
        const cursor = browseItems[browseItems.length - 1];
        if (!cursor) { prefetchInFlight = false; return; }

        const params = new URLSearchParams({
            limit: '5', direction: 'forward', types: browseTypes.join(','),
            cursor_ts: cursor.created_at, cursor_id: cursor.image_id
        });
        if (currentStartDateFilter) params.set('start_date', currentStartDateFilter);
        if (currentEndDateFilter) params.set('end_date', currentEndDateFilter);
        if (currentPatentFilter) params.set('search_term', currentPatentFilter);
        if (currentBrandFilter.length)  params.set('brand_filter',        currentBrandFilter.join(','));
        if (currentColorFilter.length)  params.set('color_filter',        currentColorFilter.join(','));
        if (currentTypeFilter.length)   params.set('vehicle_type_filter', currentTypeFilter.join(','));

        try {
            const resp = await fetch(`${BASE}/api/browse_images?` + params);
            if (handle401(resp)) return;
            const data = await resp.json();
            browseItems.push(...data.images);
        } catch (e) {
            console.error('Prefetch error:', e);
        }
        prefetchInFlight = false;
    }

    async function openBrowseCarousel() {
        modalMode = 'browse';
        browseFilters.hidden = false;
        browseItems = [];
        browseIndex = 0;
        browseTotalCount = 0;
        preloadedBrowseImageIds.clear();

        // Sync checkboxes with browseTypes
        browseFilters.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            cb.checked = browseTypes.includes(cb.value);
        });

        hideModalError();
        showSpinner();
        imageModal.style.display = 'flex';
        _modalOpen = true;

        const loaded = await browseLoadPage('forward');
        hideSpinner();
        if (loaded > 0) {
            browseShowSlide(0);
        } else {
            showModalError('No se encontraron imágenes.');
        }
    }

    // Browse filter checkbox handling
    browseFilters.addEventListener('change', async (e) => {
        if (e.target.type !== 'checkbox') return;
        const checkboxes = browseFilters.querySelectorAll('input[type="checkbox"]');
        const checked = Array.from(checkboxes).filter(cb => cb.checked);

        // Require at least 1 checked
        if (checked.length === 0) {
            e.target.checked = true;
            return;
        }

        browseTypes = checked.map(cb => cb.value);
        browseItems = [];
        browseIndex = 0;
        browseTotalCount = 0;
        preloadedBrowseImageIds.clear();

        showSpinner();
        const loaded = await browseLoadPage('forward');
        hideSpinner();
        if (loaded > 0) {
            browseShowSlide(0);
        } else {
            showModalError('No se encontraron imágenes con estos filtros.');
        }
    });

    // --- Initial loads ---
    // Data first so the table is usable immediately; thumbnails load after.
    fetchPatentsTableData();
    fetchStats();
    Promise.resolve().then(fetchLatestThumbnails);
    Promise.resolve().then(fetchAndInitDropdowns);
});
