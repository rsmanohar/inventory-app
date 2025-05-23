async function loadProducts(category = '', subcategory = '') {
    let url = '/api/products';
    const params = [];
    if (category) params.push(`category=${encodeURIComponent(category)}`);
    if (subcategory) params.push(`subcategory=${encodeURIComponent(subcategory)}`);
    if (params.length) url += '?' + params.join('&');

    const res = await fetch(url);
    const products = await res.json();
    const tableBody = document.querySelector('#productTable tbody');
    tableBody.innerHTML = '';
    products.forEach(p => {
        const quantity = parseInt(p.quantity || 0);
        const wholesalePrice = parseFloat(p.wholesale_price || 0);
        const retailPrice = parseFloat(p.retail_price || wholesalePrice); // Default retail to wholesale if null/undefined
        
        // Use pre-calculated totals from server if available, otherwise calculate
        const wholesaleTotalPrice = parseFloat(p.wholesale_total_price !== undefined ? p.wholesale_total_price : (quantity * wholesalePrice));
        const retailTotalPrice = parseFloat(p.retail_total_price !== undefined ? p.retail_total_price : (quantity * retailPrice));
        const profitMargin = retailTotalPrice - wholesaleTotalPrice;

        tableBody.innerHTML += `
            <tr id="row-${p.id}">
                <td>${p.id}</td>
                <td>${p.category || ''}</td>
                <td>${p.subcategory || ''}</td>
                <td>${quantity}</td>
                <td>${wholesalePrice.toFixed(2)}</td>
                <td>${retailPrice.toFixed(2)}</td>
                <td>${wholesaleTotalPrice.toFixed(2)}</td>
                <td>${retailTotalPrice.toFixed(2)}</td>
                <td>${profitMargin.toFixed(2)}</td>
                <td>
                    <button onclick="editProduct(${p.id})">Edit</button>
                    <button onclick="deleteProduct(${p.id})">Delete</button>
                </td>
            </tr>`;
    });
}

// Populate filters and modal dropdowns
async function populateCategories() {
    const res = await fetch('/api/categories');
    const categories = await res.json();
    const catFilter = document.getElementById('filter-category');
    const catModal = document.getElementById('modal-category');
    catFilter.innerHTML = '<option value="">All Categories</option>';
    catModal.innerHTML = '<option value="">Select Category</option>';
    categories.forEach(cat => {
        catFilter.innerHTML += `<option value="${cat}">${cat}</option>`;
        catModal.innerHTML += `<option value="${cat}">${cat}</option>`;
    });
}

async function populateSubcategories(category, targetId) {
    const res = await fetch(`/api/subcategories?category=${encodeURIComponent(category)}`);
    const subcategories = await res.json();
    const subFilter = document.getElementById(targetId);
    subFilter.innerHTML = `<option value="">${targetId === 'filter-subcategory' ? 'All Subcategories' : 'Select Subcategory'}</option>`;
    subcategories.forEach(sub => {
        subFilter.innerHTML += `<option value="${sub}">${sub}</option>`;
    });
}

// Filter logic
function applyFilters() {
    loadProducts(
        document.getElementById('filter-category').value,
        document.getElementById('filter-subcategory').value
    );
}
function resetFilters() {
    document.getElementById('filter-category').value = '';
    document.getElementById('filter-subcategory').value = '';
    loadProducts();
}

// --- Modal logic ---
function openAddProductModal() {
    document.getElementById('addProductModal').style.display = 'block';
    populateCategories();
    document.getElementById('modal-subcategory').innerHTML = '<option value="">Select Subcategory</option>';
    document.getElementById('modal-category').value = '';
    document.getElementById('modal-quantity').value = '';
    document.getElementById('modal-wholesale-price').value = '';
    document.getElementById('modal-retail-price').value = '';
    document.getElementById('modal-wholesale-totalprice').value = '';
    document.getElementById('modal-retail-totalprice').value = '';
}
function closeAddProductModal() {
    document.getElementById('addProductModal').style.display = 'none';
}

// Update subcategory dropdown in modal when category changes
document.addEventListener('DOMContentLoaded', () => {
    populateCategories();
    document.getElementById('filter-category').addEventListener('change', function() {
        populateSubcategories(this.value, 'filter-subcategory');
    });
    document.getElementById('modal-category').addEventListener('change', function() {
        populateSubcategories(this.value, 'modal-subcategory');
    });
    // Calculate total prices in modal
    document.getElementById('modal-quantity').addEventListener('input', updateModalTotalPrices);
    document.getElementById('modal-wholesale-price').addEventListener('input', updateModalTotalPrices);
    document.getElementById('modal-retail-price').addEventListener('input', updateModalTotalPrices);
});

function updateModalTotalPrices() {
    const qty = parseFloat(document.getElementById('modal-quantity').value) || 0;
    const wholesalePrice = parseFloat(document.getElementById('modal-wholesale-price').value) || 0;
    const retailPriceInput = document.getElementById('modal-retail-price');
    let retailPrice = parseFloat(retailPriceInput.value);

    if (isNaN(retailPrice) || retailPriceInput.value.trim() === '') { // If retail price is empty or not a number, default to wholesale
        retailPrice = wholesalePrice;
    }
    
    document.getElementById('modal-wholesale-totalprice').value = (qty * wholesalePrice).toFixed(2);
    document.getElementById('modal-retail-totalprice').value = (qty * retailPrice).toFixed(2);
}

// --- Add Product via Modal ---
async function submitAddProduct(event) {
    event.preventDefault();
    const category = document.getElementById('modal-category').value;
    const subcategory = document.getElementById('modal-subcategory').value;
    const quantity = parseFloat(document.getElementById('modal-quantity').value) || 0;
    const wholesale_price = parseFloat(document.getElementById('modal-wholesale-price').value) || 0;
    let retail_price = parseFloat(document.getElementById('modal-retail-price').value);

    if (isNaN(retail_price)) { // If retail price is not entered, default to wholesale
        retail_price = wholesale_price;
    }

    // Server will calculate total prices
    await fetch('/api/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, subcategory, quantity, wholesale_price, retail_price })
    });

    closeAddProductModal();
    loadProducts();
}

// --- Update edit/save logic to handle new price fields ---
async function editProduct(id) {
    const row = document.getElementById(`row-${id}`);
    const cells = row.getElementsByTagName('td');
    const category = cells[1].textContent;
    const subcategory = cells[2].textContent;
    const quantity = cells[3].textContent;
    const wholesale_price = cells[4].textContent;
    const retail_price = cells[5].textContent;
    const wholesale_total_price = cells[6].textContent;
    const retail_total_price = cells[7].textContent;
    // Profit margin (cells[8]) is display-only

    row.innerHTML = `
        <td>${id}</td>
        <td><input type="text" id="edit-category-${id}" value="${category}"></td>
        <td><input type="text" id="edit-subcategory-${id}" value="${subcategory}"></td>
        <td><input type="number" id="edit-quantity-${id}" value="${quantity}" oninput="updateEditTotalPrices(${id})"></td>
        <td><input type="number" step="0.01" id="edit-wholesale-price-${id}" value="${wholesale_price}" oninput="updateEditTotalPrices(${id})"></td>
        <td><input type="number" step="0.01" id="edit-retail-price-${id}" value="${retail_price}" oninput="updateEditTotalPrices(${id})"></td>
        <td><input type="text" id="edit-wholesale-totalprice-${id}" value="${wholesale_total_price}" readonly></td>
        <td><input type="text" id="edit-retail-totalprice-${id}" value="${retail_total_price}" readonly></td>
        <td><input type="text" id="edit-profit-margin-${id}" value="${(parseFloat(retail_total_price) - parseFloat(wholesale_total_price)).toFixed(2)}" readonly></td>
        <td>
            <button onclick="saveEdit(${id})">Save</button>
            <button onclick="cancelEdit(${id})">Cancel</button>
        </td>
    `;
}

function updateEditTotalPrices(id) {
    const qty = parseFloat(document.getElementById(`edit-quantity-${id}`).value) || 0;
    const wholesalePrice = parseFloat(document.getElementById(`edit-wholesale-price-${id}`).value) || 0;
    const retailPriceEl = document.getElementById(`edit-retail-price-${id}`);
    let retailPrice = parseFloat(retailPriceEl.value);

    if (isNaN(retailPrice) || retailPriceEl.value.trim() === '') {
        retailPrice = wholesalePrice; // Default retail to wholesale if empty or NaN
    }

    const wholesaleTotalPrice = qty * wholesalePrice;
    const retailTotalPrice = qty * retailPrice;
    const profitMargin = retailTotalPrice - wholesaleTotalPrice;

    document.getElementById(`edit-wholesale-totalprice-${id}`).value = wholesaleTotalPrice.toFixed(2);
    document.getElementById(`edit-retail-totalprice-${id}`).value = retailTotalPrice.toFixed(2);
    document.getElementById(`edit-profit-margin-${id}`).value = profitMargin.toFixed(2);
}

async function saveEdit(id) {
    const category = document.getElementById(`edit-category-${id}`).value;
    const subcategory = document.getElementById(`edit-subcategory-${id}`).value;
    const quantity = parseFloat(document.getElementById(`edit-quantity-${id}`).value) || 0;
    const wholesale_price = parseFloat(document.getElementById(`edit-wholesale-price-${id}`).value) || 0;
    let retail_price = parseFloat(document.getElementById(`edit-retail-price-${id}`).value);

    if (isNaN(retail_price)) { // If retail price is not entered, default to wholesale
        retail_price = wholesale_price;
    }
    
    // Server will recalculate total prices based on these inputs
    await fetch(`/api/update/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, subcategory, quantity, wholesale_price, retail_price })
    });

    loadProducts();
}

function cancelEdit(id) {
    loadProducts();
}

// Inline update functions (updateQuantity, updatePrice) are removed as per the new edit flow.

async function deleteProduct(id) {
    await fetch(`/api/delete/${id}`, { method: 'DELETE' });
    loadProducts();
}

// Initial load
document.addEventListener('DOMContentLoaded', () => {
    loadProducts();
    populateCategories();
});