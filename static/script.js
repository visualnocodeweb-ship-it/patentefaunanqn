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
    const closeButton = document.querySelector('.close-button');


    let currentPage = 1;
    const pageSize = 10;
    // Variables de estado para los filtros
    let currentPatentFilter = ''; // Renombrado de currentSearchTerm para mayor claridad
    let currentBrandFilter = '';
    let currentTypeFilter = '';
    let currentStartDateFilter = '';
    let currentEndDateFilter = '';
    let totalPages = 0;

    // Function to create and display an image item (card view)
    function createImageItem(item) {
        const imageItem = document.createElement('div');
        imageItem.className = 'image-item';

        const img = document.createElement('img');
        img.src = `data:image/jpeg;base64,${item.image_data}`;
        img.alt = `Imagen ${item.id}`;
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

    async function fetchPatentsTableData() {
        patentTableBody.innerHTML = '<tr><td colspan="7">Cargando patentes...</td></tr>';
        let url = `/api/all_patents?page=${currentPage}&page_size=${pageSize}`;
        if (currentPatentFilter) { // Usar currentPatentFilter
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
                searchResultsContainer.innerHTML = '<p class="no-results">Buscando...</p>';
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
            datetimeSearchResultsContainer.innerHTML = '<p class="no-results">Buscando por fecha y hora...</p>';
            const response = await fetch(`/api/images_by_datetime?start_datetime=${encodeURIComponent(startDatetime)}&end_datetime=${encodeURIComponent(endDatetime)}`);
            const data = await response.json();
            
            displayCardResults(datetimeSearchResultsContainer, data);
        } catch (error) {
            console.error('Error searching by datetime range:', error);
            datetimeSearchResultsContainer.innerHTML = '<p class="no-results">Error al buscar por rango de fecha y hora.</p>';
        }
    });

    // --- Event Listeners para la paginación y búsqueda de la tabla de patentes ---
    // Listeners para los botones de búsqueda individuales
    searchPatentButton.addEventListener('click', () => {
        currentPatentFilter = patentTableSearchInput.value.trim(); // Actualiza solo el filtro de patente
        currentPage = 1; 
        fetchPatentsTableData();
    });
    searchBrandButton.addEventListener('click', () => {
        currentBrandFilter = patentTableSearchBrandInput.value.trim(); // Actualiza solo el filtro de marca
        currentPage = 1;
        fetchPatentsTableData();
    });
    searchTypeButton.addEventListener('click', () => {
        currentTypeFilter = patentTableSearchTypeInput.value.trim(); // Actualiza solo el filtro de tipo
        currentPage = 1;
        fetchPatentsTableData();
    });
    searchDateRangeButton.addEventListener('click', () => {
        currentStartDateFilter = patentTableSearchStartDateInput.value; // Actualiza solo los filtros de fecha
        currentEndDateFilter = patentTableSearchEndDateInput.value;
        currentPage = 1;
        fetchPatentsTableData();
    });
    applyAllFiltersButton.addEventListener('click', () => { // Botón general que aplica todos los filtros
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
            searchPatentButton.click(); // Dispara la búsqueda individual de patente
        }
    });
    patentTableSearchBrandInput.addEventListener('keypress', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            searchBrandButton.click(); // Dispara la búsqueda individual de marca
        }
    });
    patentTableSearchTypeInput.addEventListener('keypress', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            searchTypeButton.click(); // Dispara la búsqueda individual de tipo
        }
    });
    patentTableSearchStartDateInput.addEventListener('keypress', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            searchDateRangeButton.click(); // Dispara la búsqueda individual de fecha
        }
    });
    patentTableSearchEndDateInput.addEventListener('keypress', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            searchDateRangeButton.click(); // Dispara la búsqueda individual de fecha
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

    // --- Lógica del modal de imagen ---
    patentTableBody.addEventListener('click', async (event) => {
        if (event.target.classList.contains('view-image-button')) {
            const eventId = event.target.dataset.eventId;
            if (eventId) {
                try {
                    const response = await fetch(`/api/image/${eventId}`);
                    if (!response.ok) {
                        throw new Error(`HTTP error! status: ${response.status}`);
                    }
                    const imageData = await response.json();
                    if (imageData && imageData.image_data) {
                        const mimeType = imageData.image_type || 'image/jpeg';
                        modalImage.src = `data:${mimeType};base64,${imageData.image_data}`;
                        imageModal.style.display = 'flex'; // Mostrar el modal
                    } else {
                        alert('No se encontró imagen para este evento.');
                    }
                } catch (error) {
                    console.error('Error al obtener la imagen:', error);
                    alert('Error al cargar la imagen.');
                }
            }
        }
    });

    closeButton.addEventListener('click', () => {
        imageModal.style.display = 'none';
        modalImage.src = ''; // Limpiar la imagen del modal
    });

    window.addEventListener('click', (event) => {
        if (event.target === imageModal) {
            imageModal.style.display = 'none';
            modalImage.src = '';
        }
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            imageModal.style.display = 'none';
            modalImage.src = '';
        }
    });


    // Initial loads
    fetchLatestImages(); // Carga las últimas imágenes (vista de tarjetas)
    fetchPatentsTableData(); // Carga los datos de la tabla de patentes
});
