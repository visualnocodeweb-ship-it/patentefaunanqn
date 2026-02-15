function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

document.addEventListener('DOMContentLoaded', () => {
    const latestImagesContainer = document.getElementById('latest-images');
    const searchForm = document.getElementById('search-form');
    const plateInput = document.getElementById('plate-input');
    const searchResultsContainer = document.getElementById('search-results');

    // --- Referencias para la nueva tabla de patentes y paginación ---
    const patentTableBody = document.querySelector('#patent-table tbody');
    const totalPatentsCountSpan = document.getElementById('total-patents-count');
    const patentTableSearchInput = document.getElementById('patent-table-search-input');
    const patentTableSearchBrandInput = document.getElementById('patent-table-search-brand');
    const patentTableSearchTypeInput = document.getElementById('patent-table-search-type');
    const patentTableSearchStartDateInput = document.getElementById('patent-table-search-start-date');
    const patentTableSearchEndDateInput = document.getElementById('patent-table-search-end-date');

    const searchPatentButton = document.getElementById('search-patent-button');
    const searchBrandButton = document.getElementById('search-brand-button');
    const searchTypeButton = document.getElementById('search-type-button');
    const searchDateRangeButton = document.getElementById('search-date-range-button');
    const applyAllFiltersButton = document.getElementById('apply-all-filters-button');

    const prevPageButton = document.getElementById('prev-page-button');
    const nextPageButton = document.getElementById('next-page-button');
    const currentPageSpan = document.getElementById('current-page');

    // --- Referencias para el modal de imagen ---
    const imageModal = document.getElementById('imageModal');
    const modalImage = document.getElementById('modalImage');
    const modalError = document.getElementById('modal-error');
    const closeButton = document.querySelector('.close-button');

    const pageSize = 10;
    let totalPages = 0;

    // --- URL state management ---
    function getFiltersFromURL() {
        const params = new URLSearchParams(window.location.search);
        return {
            page: parseInt(params.get('page')) || 1,
            patent: params.get('search_term') || '',
            brand: params.get('brand_filter') || '',
            type: params.get('type_filter') || '',
            startDate: params.get('start_date_filter') || '',
            endDate: params.get('end_date_filter') || ''
        };
    }

    function pushFiltersToURL(filters) {
        const params = new URLSearchParams();
        if (filters.page > 1) params.set('page', filters.page);
        if (filters.patent) params.set('search_term', filters.patent);
        if (filters.brand) params.set('brand_filter', filters.brand);
        if (filters.type) params.set('type_filter', filters.type);
        if (filters.startDate) params.set('start_date_filter', filters.startDate);
        if (filters.endDate) params.set('end_date_filter', filters.endDate);
        const qs = params.toString();
        const newUrl = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
        history.replaceState(null, '', newUrl);
    }

    // Initialize filter state from URL
    let urlState = getFiltersFromURL();
    let currentPage = urlState.page;
    let currentPatentFilter = urlState.patent;
    let currentBrandFilter = urlState.brand;
    let currentTypeFilter = urlState.type;
    let currentStartDateFilter = urlState.startDate;
    let currentEndDateFilter = urlState.endDate;

    // Populate inputs from URL state
    patentTableSearchInput.value = currentPatentFilter;
    patentTableSearchBrandInput.value = currentBrandFilter;
    patentTableSearchTypeInput.value = currentTypeFilter;
    patentTableSearchStartDateInput.value = currentStartDateFilter;
    patentTableSearchEndDateInput.value = currentEndDateFilter;

    // Function to create and display an image item (card view)
    function createImageItem(item) {
        const imageItem = document.createElement('div');
        imageItem.className = 'image-item';

        const img = document.createElement('img');
        img.src = `data:image/jpeg;base64,${item.image_data}`;
        img.alt = `Imagen ${item.id}`;
        img.width = 250;
        img.height = 200;
        imageItem.appendChild(img);

        const details = document.createElement('div');
        details.className = 'image-details';
        details.innerHTML = `
            <p><strong>Patente:</strong> ${escapeHtml(item.plate_text) || 'No detectada'}</p>
            <p><strong>Tipo:</strong> ${escapeHtml(item.image_type) || 'N/A'}</p>
            <p><strong>Fecha:</strong> ${new Date(item.created_at).toLocaleString()}</p>
            <p><strong>Confianza:</strong> ${item.plate_confidence ? (item.plate_confidence * 100).toFixed(2) + '%' : 'N/A'}</p>
            <p><strong>Archivo:</strong> ${escapeHtml(item.file_name) || 'N/A'}</p>
        `;
        imageItem.appendChild(details);

        return imageItem;
    }

    // Function to display results in a container (card view)
    function displayCardResults(container, results) {
        container.innerHTML = '';
        if (results.length === 0) {
            const noResults = document.createElement('p');
            noResults.className = 'no-results';
            noResults.textContent = 'No se encontraron resultados.';
            container.appendChild(noResults);
            return;
        }
        results.forEach(item => {
            container.appendChild(createImageItem(item));
        });
    }

    // Function to create a table row for patent data
    function createTableRow(item) {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${escapeHtml(item.plate_text) || 'No detectada'}</td>
            <td>${escapeHtml(item.vehicle_brand) || 'N/A'}</td>
            <td>${escapeHtml(item.vehicle_color) || 'N/A'}</td>
            <td>${escapeHtml(item.vehicle_type) || 'N/A'}</td>
            <td>${item.plate_confidence ? (item.plate_confidence * 100).toFixed(2) + '%' : 'N/A'}</td>
            <td>${new Date(item.created_at).toLocaleString()}</td>
            <td><button data-event-id="${escapeHtml(item.event_id)}" class="view-image-button">Ver Imagen</button></td>
        `;
        return row;
    }

    // Function to display results in the patent table
    function displayPatentTableResults(results) {
        patentTableBody.innerHTML = '';
        if (results.length === 0) {
            const noResultsRow = document.createElement('tr');
            noResultsRow.innerHTML = `<td colspan="7">No se encontraron patentes.</td>`;
            patentTableBody.appendChild(noResultsRow);
            return;
        }
        results.forEach(item => {
            patentTableBody.appendChild(createTableRow(item));
        });
    }

    // --- Funciones de paginación ---
    function updatePaginationControls() {
        prevPageButton.disabled = currentPage === 1;
        nextPageButton.disabled = currentPage === totalPages || totalPages === 0;
        currentPageSpan.textContent = currentPage;
    }

    function syncURLState() {
        pushFiltersToURL({
            page: currentPage,
            patent: currentPatentFilter,
            brand: currentBrandFilter,
            type: currentTypeFilter,
            startDate: currentStartDateFilter,
            endDate: currentEndDateFilter
        });
    }

    async function fetchPatentsTableData() {
        patentTableBody.innerHTML = '<tr><td colspan="7">Cargando patentes\u2026</td></tr>';
        let url = `/api/all_patents?page=${currentPage}&page_size=${pageSize}`;
        if (currentPatentFilter) {
            url += `&search_term=${encodeURIComponent(currentPatentFilter)}`;
        }
        if (currentBrandFilter) {
            url += `&brand_filter=${encodeURIComponent(currentBrandFilter)}`;
        }
        if (currentTypeFilter) {
            url += `&type_filter=${encodeURIComponent(currentTypeFilter)}`;
        }
        if (currentStartDateFilter) {
            url += `&start_date_filter=${encodeURIComponent(currentStartDateFilter)}`;
        }
        if (currentEndDateFilter) {
            url += `&end_date_filter=${encodeURIComponent(currentEndDateFilter)}`;
        }

        syncURLState();

        try {
            const response = await fetch(url);
            const data = await response.json();

            displayPatentTableResults(data.patents);
            totalPatentsCountSpan.textContent = data.total_count;
            totalPages = Math.ceil(data.total_count / pageSize);
            updatePaginationControls();
        } catch (error) {
            console.error('Error fetching all patents:', error);
            patentTableBody.innerHTML = '<tr><td colspan="7">Error al cargar las patentes.</td></tr>';
        }
    }

    // Fetch and display latest images on load (card view)
    async function fetchLatestImages() {
        try {
            const response = await fetch('/api/latest_images');
            const data = await response.json();
            displayCardResults(latestImagesContainer, data);
        } catch (error) {
            console.error('Error fetching latest images:', error);
            latestImagesContainer.innerHTML = '<p class="no-results">Error al cargar las últimas imágenes.</p>';
        }
    }

    // Handle search form submission (for the image gallery)
    searchForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const plate = plateInput.value.trim();
        if (plate) {
            try {
                searchResultsContainer.innerHTML = '<p class="no-results">Buscando\u2026</p>';
                const response = await fetch(`/api/search_plate?plate=${encodeURIComponent(plate)}`);
                const data = await response.json();
                displayCardResults(searchResultsContainer, data);
            } catch (error) {
                console.error('Error searching for plate:', error);
                searchResultsContainer.innerHTML = '<p class="no-results">Error al buscar la patente.</p>';
            }
        } else {
            searchResultsContainer.innerHTML = '<p class="no-results">Por favor, introduce una patente para buscar.</p>';
        }
    });

    // Get references for datetime search
    const datetimeSearchForm = document.getElementById('datetime-search-form');
    const startDateInput = document.getElementById('start-date');
    const startTimeInput = document.getElementById('start-time');
    const endDateInput = document.getElementById('end-date');
    const endTimeInput = document.getElementById('end-time');
    const datetimeSearchResultsContainer = document.getElementById('datetime-search-results');

    // Handle datetime search form submission
    datetimeSearchForm.addEventListener('submit', async (event) => {
        event.preventDefault();

        const startDate = startDateInput.value;
        const startTime = startTimeInput.value;
        const endDate = endDateInput.value;
        const endTime = endTimeInput.value;

        if (!startDate || !startTime || !endDate || !endTime) {
            datetimeSearchResultsContainer.innerHTML = '<p class="no-results">Por favor, selecciona fecha y hora de inicio y fin.</p>';
            return;
        }

        const startDatetime = `${startDate}T${startTime}:00`;
        const endDatetime = `${endDate}T${endTime}:00`;

        try {
            datetimeSearchResultsContainer.innerHTML = '<p class="no-results">Buscando por fecha y hora\u2026</p>';
            const response = await fetch(`/api/images_by_datetime?start_datetime=${encodeURIComponent(startDatetime)}&end_datetime=${encodeURIComponent(endDatetime)}`);
            const data = await response.json();

            displayCardResults(datetimeSearchResultsContainer, data);
        } catch (error) {
            console.error('Error searching by datetime range:', error);
            datetimeSearchResultsContainer.innerHTML = '<p class="no-results">Error al buscar por rango de fecha y hora.</p>';
        }
    });

    // --- Event Listeners para la paginación y búsqueda de la tabla de patentes ---
    searchPatentButton.addEventListener('click', () => {
        currentPatentFilter = patentTableSearchInput.value.trim();
        currentPage = 1;
        fetchPatentsTableData();
    });
    searchBrandButton.addEventListener('click', () => {
        currentBrandFilter = patentTableSearchBrandInput.value.trim();
        currentPage = 1;
        fetchPatentsTableData();
    });
    searchTypeButton.addEventListener('click', () => {
        currentTypeFilter = patentTableSearchTypeInput.value.trim();
        currentPage = 1;
        fetchPatentsTableData();
    });
    searchDateRangeButton.addEventListener('click', () => {
        currentStartDateFilter = patentTableSearchStartDateInput.value;
        currentEndDateFilter = patentTableSearchEndDateInput.value;
        currentPage = 1;
        fetchPatentsTableData();
    });
    applyAllFiltersButton.addEventListener('click', () => {
        currentPatentFilter = patentTableSearchInput.value.trim();
        currentBrandFilter = patentTableSearchBrandInput.value.trim();
        currentTypeFilter = patentTableSearchTypeInput.value.trim();
        currentStartDateFilter = patentTableSearchStartDateInput.value;
        currentEndDateFilter = patentTableSearchEndDateInput.value;
        currentPage = 1;
        fetchPatentsTableData();
    });

    // Listeners para 'Enter' en los inputs de búsqueda
    patentTableSearchInput.addEventListener('keypress', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            searchPatentButton.click();
        }
    });
    patentTableSearchBrandInput.addEventListener('keypress', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            searchBrandButton.click();
        }
    });
    patentTableSearchTypeInput.addEventListener('keypress', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            searchTypeButton.click();
        }
    });
    patentTableSearchStartDateInput.addEventListener('keypress', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            searchDateRangeButton.click();
        }
    });
    patentTableSearchEndDateInput.addEventListener('keypress', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            searchDateRangeButton.click();
        }
    });

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

    // --- Carousel references ---
    const carouselCounter = document.getElementById('carousel-counter');
    const carouselCaption = document.getElementById('carousel-caption');
    const carouselPrev = document.querySelector('.carousel-prev');
    const carouselNext = document.querySelector('.carousel-next');

    const modalSpinner = document.getElementById('modal-spinner');

    let carouselImages = [];
    let carouselIndex = 0;

    // --- Lógica del modal de imagen ---
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

    patentTableBody.addEventListener('click', async (event) => {
        if (event.target.classList.contains('view-image-button')) {
            const eventId = event.target.dataset.eventId;
            if (eventId) {
                hideModalError();
                showSpinner();
                imageModal.style.display = 'flex';
                try {
                    const response = await fetch(`/api/image/${eventId}`);
                    if (!response.ok) {
                        throw new Error(`HTTP error! status: ${response.status}`);
                    }
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
        if (event.target === imageModal) {
            closeModal();
        }
    });

    document.addEventListener('keydown', (event) => {
        if (imageModal.style.display === 'flex') {
            if (event.key === 'Escape') {
                closeModal();
            } else if (event.key === 'ArrowLeft') {
                showSlide(carouselIndex - 1);
            } else if (event.key === 'ArrowRight') {
                showSlide(carouselIndex + 1);
            }
        }
    });

    // Initial loads
    fetchLatestImages();
    fetchPatentsTableData();
});
