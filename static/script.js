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

    // Filter state
    let currentPage = 1;
    let currentPatentFilter = '';
    let currentBrandFilter = [];
    let currentColorFilter = [];
    let currentTypeFilter  = [];
    let currentStartDateFilter = '';
    let currentEndDateFilter = '';
    let currentMinConfidenceFilter = '';

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

    // Instantiate multi-select dropdowns
    const dropdownBrand = new MultiSelectDropdown('filter-brand-container', 'Marca', () => debouncedFetch());
    const dropdownColor = new MultiSelectDropdown('filter-color-container', 'Color', () => debouncedFetch());
    const dropdownType  = new MultiSelectDropdown('filter-type-container',  'Tipo',  () => debouncedFetch());

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
            startDate:   params.get('start_date_filter') || '',
            endDate:     params.get('end_date_filter') || '',
            minConfidence: params.get('min_confidence_filter') || ''
        };
    }

    function pushFiltersToURL() {
        const params = new URLSearchParams();
        if (currentPage > 1) params.set('page', currentPage);
        if (currentPatentFilter) params.set('search_term', currentPatentFilter);
        if (currentBrandFilter.length) params.set('brand_filter', currentBrandFilter.join(','));
        if (currentColorFilter.length) params.set('color_filter', currentColorFilter.join(','));
        if (currentTypeFilter.length)  params.set('type_filter',  currentTypeFilter.join(','));
        if (currentStartDateFilter) params.set('start_date_filter', currentStartDateFilter);
        if (currentEndDateFilter) params.set('end_date_filter', currentEndDateFilter);
        if (currentMinConfidenceFilter) params.set('min_confidence_filter', currentMinConfidenceFilter);
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
    currentStartDateFilter = urlState.startDate;
    currentEndDateFilter   = urlState.endDate;
    currentMinConfidenceFilter = urlState.minConfidence;

    // Populate inputs from URL state
    filterPatent.value    = currentPatentFilter;
    filterStartDate.value = currentStartDateFilter;
    filterEndDate.value   = currentEndDateFilter;
    // Dropdowns: setSelected() is called after populate() in fetchAndInitDropdowns below

    // --- Read all filter inputs into state ---
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

    function triggerFilteredFetch() {
        readAllFilters();
        fetchPatentsTableData();
        fetchStats();
    }

    const debouncedFetch = debounce(triggerFilteredFetch, 350);

    // --- Table row ---
    function createTableRow(item) {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${item.sightings != null ? item.sightings : '-'}</td>
            <td>${escapeHtml(item.plate_text) || 'No detectada'}</td>
            <td>${escapeHtml(item.vehicle_brand) || 'N/A'}</td>
            <td>${escapeHtml(item.vehicle_color) || 'N/A'}</td>
            <td>${escapeHtml(item.vehicle_type) || 'N/A'}</td>
            <td>${item.plate_confidence ? (item.plate_confidence * 100).toFixed(2) + '%' : 'N/A'}</td>
            <td>${new Date(item.created_at).toLocaleString()}</td>
            <td><button data-event-id="${escapeHtml(item.event_id)}" class="view-image-button">Ver Imágenes</button></td>
        `;
        return row;
    }

    function displayPatentTableResults(results) {
        patentTableBody.innerHTML = '';
        if (results.length === 0) {
            const noResultsRow = document.createElement('tr');
            noResultsRow.innerHTML = '<td colspan="8">No se encontraron patentes.</td>';
            patentTableBody.appendChild(noResultsRow);
            return;
        }
        results.forEach(item => {
            patentTableBody.appendChild(createTableRow(item));
        });
    }

    // --- Pagination ---
    function buildPageNumbers(current, total) {
        // Always show first 2, last 2, and current ±1
        const pages = new Set();
        pages.add(1);
        if (total > 1) pages.add(2);
        if (total > 0) pages.add(total);
        if (total > 1) pages.add(total - 1);
        for (let i = current - 1; i <= current + 1; i++) {
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
        prevBtn.innerHTML = '&laquo;';
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
        nextBtn.innerHTML = '&raquo;';
        nextBtn.dataset.page = currentPage + 1;
        nextBtn.disabled = currentPage === totalPages;
        nextBtn.title = 'Siguiente';
        paginationButtons.appendChild(nextBtn);
    }

    // --- Fetch table data ---
    async function fetchPatentsTableData() {
        if (tableAbort) tableAbort.abort();
        tableAbort = new AbortController();

        patentTableBody.innerHTML = '<tr><td colspan="8">Cargando patentes\u2026</td></tr>';
        let url = `/api/all_patents?page=${currentPage}&page_size=${pageSize}`;
        if (currentPatentFilter) url += `&search_term=${encodeURIComponent(currentPatentFilter)}`;
        if (currentBrandFilter.length) url += `&brand_filter=${encodeURIComponent(currentBrandFilter.join(','))}`;
        if (currentColorFilter.length) url += `&color_filter=${encodeURIComponent(currentColorFilter.join(','))}`;
        if (currentTypeFilter.length)  url += `&type_filter=${encodeURIComponent(currentTypeFilter.join(','))}`;
        if (currentStartDateFilter) url += `&start_date_filter=${encodeURIComponent(currentStartDateFilter)}`;
        if (currentEndDateFilter) url += `&end_date_filter=${encodeURIComponent(currentEndDateFilter)}`;
        if (currentMinConfidenceFilter) {
            url += `&min_confidence_filter=${encodeURIComponent(currentMinConfidenceFilter / 100)}`;
        }

        pushFiltersToURL();

        try {
            const response = await fetch(url, { signal: tableAbort.signal });
            if (handle401(response)) return;
            const data = await response.json();
            displayPatentTableResults(data.patents);
            totalPages = Math.ceil(data.total_count / pageSize);
            updatePaginationControls(data.total_count);
        } catch (error) {
            if (error.name === 'AbortError') return;
            console.error('Error fetching all patents:', error);
            patentTableBody.innerHTML = '<tr><td colspan="8">Error al cargar las patentes.</td></tr>';
        }
    }

    // --- Stats ---
    async function fetchStats() {
        if (statsAbort) statsAbort.abort();
        statsAbort = new AbortController();

        let url = '/api/stats';
        const params = new URLSearchParams();
        if (currentStartDateFilter) params.set('start_date', currentStartDateFilter);
        if (currentEndDateFilter) params.set('end_date', currentEndDateFilter);
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
        const items = [
            { label: 'Detecciones', value: data.total },
            { label: 'Patentes únicas', value: data.unique_plates },
            { label: 'Conf. promedio', value: (data.avg_confidence * 100).toFixed(1) + '%' },
            { label: 'Baja conf. (<70%)', value: data.low_confidence_count, cls: data.low_confidence_count > 0 ? 'low-conf' : '' },
            { label: 'Alta (\u226590%)', value: data.high_conf },
            { label: 'Media (70-90%)', value: data.mid_conf },
            { label: 'Det./hora', value: data.detections_per_hour },
        ];
        if (data.last_detection_at) {
            items.push({ label: 'Última detección', value: timeSince(new Date(data.last_detection_at)) });
        }
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
            statsBar.appendChild(el);
        });
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
            const response = await fetch('/api/recent_thumbnails?limit=7');
            if (handle401(response)) return;
            const data = await response.json();
            thumbnailStrip.innerHTML = '';
            data.forEach(item => {
                const img = document.createElement('img');
                img.className = 'thumbnail';
                img.src = `/api/browse_image/${item.image_id}`;
                img.alt = item.plate_text || 'Detección';
                img.width = 120;
                img.height = 80;
                img.dataset.eventId = item.event_id;
                img.addEventListener('click', () => openModalForEvent(item.event_id));
                thumbnailStrip.appendChild(img);
            });
            // "Ver Todas" button
            const viewAllBtn = document.createElement('button');
            viewAllBtn.className = 'thumbnail view-all-btn';
            viewAllBtn.textContent = 'Ver Todas';
            viewAllBtn.addEventListener('click', openBrowseCarousel);
            thumbnailStrip.appendChild(viewAllBtn);
        } catch (error) {
            console.error('Error fetching thumbnails:', error);
        }
    }

    async function fetchAndInitDropdowns() {
        try {
            const response = await fetch('/api/filter_options');
            if (handle401(response)) return;
            if (!response.ok) {
                console.warn('filter_options returned', response.status, '— dropdowns will be empty');
                return;
            }
            const options = await response.json();
            dropdownBrand.populate(options.brands || []);
            dropdownColor.populate(options.colors || []);
            dropdownType.populate(options.types  || []);
            // Restore selection from URL — intersect with available options to drop stale values
            const brandSet  = new Set(options.brands || []);
            const colorSet  = new Set(options.colors || []);
            const typeSet   = new Set(options.types  || []);
            const validBrand = currentBrandFilter.filter(v => brandSet.has(v));
            const validColor = currentColorFilter.filter(v => colorSet.has(v));
            const validType  = currentTypeFilter.filter(v => typeSet.has(v));
            if (validBrand.length) dropdownBrand.setSelected(validBrand);
            if (validColor.length) dropdownColor.setSelected(validColor);
            if (validType.length)  dropdownType.setSelected(validType);
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

    document.querySelectorAll('.time-preset-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const preset = btn.dataset.preset;
            const now = new Date();

            document.querySelectorAll('.time-preset-btn').forEach(b => b.classList.remove('active'));

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
                // Set full datetime for API, date-only for input display
                currentStartDateFilter = toLocalISODateTime(start);
                currentEndDateFilter = toLocalISODateTime(now);
                filterStartDate.value = toLocalISODate(start);
                filterEndDate.value = toLocalISODate(now);
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
        });
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
    const browseFilters = document.getElementById('browse-filters');

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
        try {
            const response = await fetch(`/api/image/${eventId}`);
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

    // Table click delegation for "Ver Imagen" buttons
    patentTableBody.addEventListener('click', (event) => {
        if (event.target.classList.contains('view-image-button')) {
            const eventId = event.target.dataset.eventId;
            if (eventId) openModalForEvent(eventId);
        }
    });

    function closeModal() {
        imageModal.style.display = 'none';
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
        if (imageModal.style.display === 'flex') {
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

        try {
            const resp = await fetch('/api/browse_images?' + params, { signal: browseAbort.signal });
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
        modalImage.src = '/api/browse_image/' + item.image_id;

        // Set counter/caption AFTER spinner setup (don't call showSpinner which clears them)
        carouselCounter.textContent = `${browseIndex + 1} / ${browseTotalCount}`;
        const typeLabels = { vehicle_detection: 'Detección', vehicle_picture: 'Vehículo', plate: 'Patente' };
        const typeLabel = typeLabels[item.image_type] || item.image_type;
        const ts = new Date(item.created_at).toLocaleString();
        carouselCaption.textContent = `${item.plate_text || 'Sin patente'} — ${typeLabel} — ${ts}`;

        const showNav = browseTotalCount > 1;
        carouselPrev.style.display = showNav ? '' : 'none';
        carouselNext.style.display = showNav ? '' : 'none';

        // Preload nearby image binaries into browser cache (3 ahead, 3 behind)
        for (let offset = -3; offset <= 3; offset++) {
            const i = browseIndex + offset;
            if (offset !== 0 && i >= 0 && i < browseItems.length) {
                const pre = new Image();
                pre.src = '/api/browse_image/' + browseItems[i].image_id;
            }
        }

        // Prefetch next metadata page if near end
        if (browseIndex >= browseItems.length - 2) {
            browsePrefetch();
        }
    }

    // Prefetch metadata + preload image binaries into browser cache
    let prefetchInFlight = false;
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

        try {
            const resp = await fetch('/api/browse_images?' + params);
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

        // Sync checkboxes with browseTypes
        browseFilters.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            cb.checked = browseTypes.includes(cb.value);
        });

        hideModalError();
        showSpinner();
        imageModal.style.display = 'flex';

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
