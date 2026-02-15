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
    const totalPatentsCountSpan = document.getElementById('total-patents-count');
    const statsBar = document.getElementById('stats-bar');
    const prevPageButton = document.getElementById('prev-page-button');
    const nextPageButton = document.getElementById('next-page-button');
    const currentPageSpan = document.getElementById('current-page');

    // Filter inputs
    const filterPatent = document.getElementById('filter-patent');
    const filterBrand = document.getElementById('filter-brand');
    const filterType = document.getElementById('filter-type');
    const filterConfidence = document.getElementById('filter-confidence');
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

    const pageSize = 10;
    let totalPages = 0;

    // Filter state
    let currentPage = 1;
    let currentPatentFilter = '';
    let currentBrandFilter = '';
    let currentTypeFilter = '';
    let currentStartDateFilter = '';
    let currentEndDateFilter = '';
    let currentMinConfidenceFilter = '';

    // AbortController for in-flight requests
    let tableAbort = null;
    let statsAbort = null;

    // --- URL state management ---
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

    function pushFiltersToURL() {
        const params = new URLSearchParams();
        if (currentPage > 1) params.set('page', currentPage);
        if (currentPatentFilter) params.set('search_term', currentPatentFilter);
        if (currentBrandFilter) params.set('brand_filter', currentBrandFilter);
        if (currentTypeFilter) params.set('type_filter', currentTypeFilter);
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
    filterConfidence.value = currentMinConfidenceFilter;

    // --- Read all filter inputs into state ---
    function readAllFilters() {
        currentPatentFilter = filterPatent.value.trim();
        currentBrandFilter = filterBrand.value.trim();
        currentTypeFilter = filterType.value.trim();
        currentStartDateFilter = filterStartDate.value;
        currentEndDateFilter = filterEndDate.value;
        const confVal = filterConfidence.value.trim();
        currentMinConfidenceFilter = confVal ? parseFloat(confVal) : '';
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
            <td>${escapeHtml(item.plate_text) || 'No detectada'}</td>
            <td>${escapeHtml(item.vehicle_brand) || 'N/A'}</td>
            <td>${escapeHtml(item.vehicle_color) || 'N/A'}</td>
            <td>${escapeHtml(item.vehicle_type) || 'N/A'}</td>
            <td>${item.plate_confidence ? (item.plate_confidence * 100).toFixed(2) + '%' : 'N/A'}</td>
            <td>${item.sightings != null ? item.sightings : '-'}</td>
            <td>${new Date(item.created_at).toLocaleString()}</td>
            <td><button data-event-id="${escapeHtml(item.event_id)}" class="view-image-button">Ver Imagen</button></td>
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
    function updatePaginationControls() {
        prevPageButton.disabled = currentPage === 1;
        nextPageButton.disabled = currentPage === totalPages || totalPages === 0;
        currentPageSpan.textContent = currentPage;
    }

    // --- Fetch table data ---
    async function fetchPatentsTableData() {
        if (tableAbort) tableAbort.abort();
        tableAbort = new AbortController();

        patentTableBody.innerHTML = '<tr><td colspan="8">Cargando patentes\u2026</td></tr>';
        let url = `/api/all_patents?page=${currentPage}&page_size=${pageSize}`;
        if (currentPatentFilter) url += `&search_term=${encodeURIComponent(currentPatentFilter)}`;
        if (currentBrandFilter) url += `&brand_filter=${encodeURIComponent(currentBrandFilter)}`;
        if (currentTypeFilter) url += `&type_filter=${encodeURIComponent(currentTypeFilter)}`;
        if (currentStartDateFilter) url += `&start_date_filter=${encodeURIComponent(currentStartDateFilter)}`;
        if (currentEndDateFilter) url += `&end_date_filter=${encodeURIComponent(currentEndDateFilter)}`;
        if (currentMinConfidenceFilter) {
            url += `&min_confidence_filter=${encodeURIComponent(currentMinConfidenceFilter / 100)}`;
        }

        pushFiltersToURL();

        try {
            const response = await fetch(url, { signal: tableAbort.signal });
            const data = await response.json();
            displayPatentTableResults(data.patents);
            totalPatentsCountSpan.textContent = data.total_count;
            totalPages = Math.ceil(data.total_count / pageSize);
            updatePaginationControls();
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
            const response = await fetch('/api/recent_thumbnails?limit=8');
            const data = await response.json();
            thumbnailStrip.innerHTML = '';
            data.forEach(item => {
                const img = document.createElement('img');
                img.className = 'thumbnail';
                img.src = `data:image/jpeg;base64,${item.image_data}`;
                img.alt = item.plate_text || 'Detección';
                img.width = 120;
                img.height = 80;
                img.dataset.eventId = item.event_id;
                img.addEventListener('click', () => openModalForEvent(item.event_id));
                thumbnailStrip.appendChild(img);
            });
        } catch (error) {
            console.error('Error fetching thumbnails:', error);
        }
    }

    // --- Filter event listeners ---
    // Text/number inputs: debounced on input, immediate on Enter
    [filterPatent, filterBrand, filterType, filterConfidence].forEach(input => {
        input.addEventListener('input', debouncedFetch);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                triggerFilteredFetch();
            }
        });
    });

    // Date inputs: immediate on change
    [filterStartDate, filterEndDate].forEach(input => {
        input.addEventListener('change', triggerFilteredFetch);
    });

    // Clear all filters
    clearFiltersButton.addEventListener('click', () => {
        filterPatent.value = '';
        filterBrand.value = '';
        filterType.value = '';
        filterConfidence.value = '';
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
            currentBrandFilter = filterBrand.value.trim();
            currentTypeFilter = filterType.value.trim();
            const confVal = filterConfidence.value.trim();
            currentMinConfidenceFilter = confVal ? parseFloat(confVal) : '';
            if (preset === 'clear') {
                currentStartDateFilter = '';
                currentEndDateFilter = '';
            }
            currentPage = 1;
            fetchPatentsTableData();
            fetchStats();
        });
    });

    // --- Pagination ---
    prevPageButton.addEventListener('click', () => {
        if (currentPage > 1) {
            currentPage--;
            fetchPatentsTableData();
        }
    });

    nextPageButton.addEventListener('click', () => {
        if (currentPage < totalPages) {
            currentPage++;
            fetchPatentsTableData();
        }
    });

    // --- Carousel / Modal ---
    let carouselImages = [];
    let carouselIndex = 0;

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

    carouselPrev.addEventListener('click', () => showSlide(carouselIndex - 1));
    carouselNext.addEventListener('click', () => showSlide(carouselIndex + 1));

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
        hideModalError();
        showSpinner();
        imageModal.style.display = 'flex';
        try {
            const response = await fetch(`/api/image/${eventId}`);
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
        carouselImages = [];
        carouselIndex = 0;
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
            else if (event.key === 'ArrowLeft') showSlide(carouselIndex - 1);
            else if (event.key === 'ArrowRight') showSlide(carouselIndex + 1);
        }
    });

    // --- Initial loads ---
    fetchLatestThumbnails();
    fetchPatentsTableData();
    fetchStats();
});
