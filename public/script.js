let products = []; // Make products globally accessible for editProduct

async function loadProducts(category = '', subcategory = '') {
    let url = '/api/products';
    const params = [];
    if (category) params.push(`category=${encodeURIComponent(category)}`);
    if (subcategory) params.push(`subcategory=${encodeURIComponent(subcategory)}`);
    if (params.length) url += '?' + params.join('&');

    const res = await fetch(url);
    products = await res.json(); // Assign to the global products variable
    const tableBody = document.querySelector('#productTable tbody');
    tableBody.innerHTML = '';
    const LOW_STOCK_THRESHOLD = 5; // Define a threshold for low stock

    products.forEach(p => {
        const original_quantity = parseInt(p.original_quantity || 0);
        const current_quantity = parseInt(p.current_quantity || 0);
        const wholesalePrice = parseFloat(p.wholesale_price || 0);
        const retailPrice = parseFloat(p.retail_price || wholesalePrice);
        
        const wholesaleTotalPrice = parseFloat(p.wholesale_total_price !== undefined ? p.wholesale_total_price : (current_quantity * wholesalePrice));
        const retailTotalPrice = parseFloat(p.retail_total_price !== undefined ? p.retail_total_price : (current_quantity * retailPrice));
        
        const itemsSold = original_quantity - current_quantity;
        const profitPerItem = retailPrice - wholesalePrice;
        const totalProfitOnSoldItems = itemsSold > 0 ? itemsSold * profitPerItem : 0;

        let rowClass = '';
        if (current_quantity === 0) {
            rowClass = 'zero-stock';
        } else if (current_quantity <= LOW_STOCK_THRESHOLD) {
            rowClass = 'low-stock';
        }

        tableBody.innerHTML += `
            <tr id="row-${p.id}" class="${rowClass}">
                <td>${p.product_code || p.id}</td> <!-- Display product_code, fallback to id if undefined -->
                <td>${p.category || ''}</td>
                <td>${p.subcategory || ''}</td>
                <td>${original_quantity}</td>
                <td>${current_quantity}</td>
                <td>₹${wholesalePrice.toFixed(2)}</td>
                <td>₹${retailPrice.toFixed(2)}</td>
                <td>₹${wholesaleTotalPrice.toFixed(2)}</td>
                <td>₹${retailTotalPrice.toFixed(2)}</td>
                <td>₹${totalProfitOnSoldItems.toFixed(2)}</td>
                <td>
                    <button onclick="editProduct(${p.id})">Edit</button>
                    <button onclick="deleteProduct(${p.id})">Delete</button>
                </td>
                <td><svg id="barcode-${p.id}"></svg></td>
            </tr>`;
    });

    // After adding all rows, generate barcodes
    products.forEach(p => {
        const barcodeTargetId = `barcode-${p.id}`; // Still use internal id for DOM element ID uniqueness
        const valueToEncode = p.product_code || String(p.id); // Use product_code for barcode value
        if (valueToEncode) {
            try {
                JsBarcode(`#${barcodeTargetId}`, valueToEncode, {
                    format: "CODE128",
                    lineColor: "#000",
                    width: 1.5,
                    height: 40,
                    displayValue: true,
                    fontSize: 14
                });
            } catch (e) {
                console.error("Error generating barcode for product ID", p.id, "using value", valueToEncode, ":", e);
                const barcodeCell = document.getElementById(barcodeTargetId);
                if (barcodeCell) {
                    barcodeCell.innerHTML = "Error";
                }
            }
        } else { // Should not happen if product_code is always generated
            const barcodeCell = document.getElementById(barcodeTargetId);
            if (barcodeCell) {
                barcodeCell.innerHTML = "N/A";
            }
        }
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
    
    document.getElementById('modal-wholesale-totalprice').value = `₹${(qty * wholesalePrice).toFixed(2)}`;
    document.getElementById('modal-retail-totalprice').value = `₹${(qty * retailPrice).toFixed(2)}`;
}

// --- Add Product via Modal ---
async function submitAddProduct(event) {
    event.preventDefault();
    const category = document.getElementById('modal-category').value;
    const subcategory = document.getElementById('modal-subcategory').value;
    // This 'quantity' from the modal is the initial stock level
    const quantity = parseFloat(document.getElementById('modal-quantity').value) || 0;
    const wholesale_price = parseFloat(document.getElementById('modal-wholesale-price').value) || 0;
    let retail_price = parseFloat(document.getElementById('modal-retail-price').value);

    if (isNaN(retail_price) || document.getElementById('modal-retail-price').value.trim() === '') {
        retail_price = wholesale_price;
    }

    // The 'quantity' sent here will be used by the server for both original_quantity and current_quantity
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
    const original_quantity = cells[3].textContent; // This is original_quantity
    const current_quantity = cells[4].textContent;  // This is current_quantity
    const wholesale_price = cells[5].textContent;
    const retail_price = cells[6].textContent;
    const wholesale_total_price = cells[7].textContent;
    const retail_total_price = cells[8].textContent;
    // Profit (Sold Items) (cells[9]) is display-only
    // Actions (cells[10])
    // Barcode (cells[11])
    
    const productBeingEdited = products.find(prod => prod.id === id); // Find product first
    const barcodeSvgId = `edit-barcode-${id}`;

    // When editing, the quantity input should represent the new total stock (original_quantity)
    row.innerHTML = `
        <td>${id}</td>
        <td><input type="text" id="edit-category-${id}" value="${category}"></td>
        <td><input type="text" id="edit-subcategory-${id}" value="${subcategory}"></td>
        <td><input type="number" id="edit-original-quantity-${id}" value="${original_quantity}" oninput="updateEditTotalPrices(${id})"></td>
        <td><input type="text" id="edit-current-quantity-${id}" value="${current_quantity}" readonly></td>
        <td><input type="number" step="0.01" id="edit-wholesale-price-${id}" value="${wholesale_price.replace('₹','')}" oninput="updateEditTotalPrices(${id})"></td>
        <td><input type="number" step="0.01" id="edit-retail-price-${id}" value="${retail_price.replace('₹','')}" oninput="updateEditTotalPrices(${id})"></td>
        <td><input type="text" id="edit-wholesale-totalprice-${id}" value="₹${wholesale_total_price.replace('₹','')}" readonly></td>
        <td><input type="text" id="edit-retail-totalprice-${id}" value="₹${retail_total_price.replace('₹','')}" readonly></td>
        <td><input type="text" id="edit-profit-sold-items-${id}" value="" readonly></td>
        <td>
            <button onclick="saveEdit(${id})">Save</button>
            <button onclick="cancelEdit(${id})">Cancel</button>
        </td>
        <td><svg id="${barcodeSvgId}"></svg></td>
    `;
    // Generate barcode for edit view
    const valueForEditBarcode = productBeingEdited ? productBeingEdited.product_code : String(id);
    if (valueForEditBarcode) {
         try {
            JsBarcode(`#${barcodeSvgId}`, valueForEditBarcode, {
                format: "CODE128",
                lineColor: "#000",
                width: 1.5, // Adjust size as needed for edit row
                height: 30,
                displayValue: true,
                fontSize: 12
            });
        } catch (e) {
            console.error("Error generating edit barcode for product ID", id, ":", e);
            const editBarcodeCell = document.getElementById(barcodeSvgId); // Use variable
            if (editBarcodeCell) {
                editBarcodeCell.innerHTML = "Error";
            }
        }
    } else {
        const editBarcodeCell = document.getElementById(barcodeSvgId); // Use variable
        if (editBarcodeCell) {
            editBarcodeCell.innerHTML = "N/A";
        }
    }
}

function updateEditTotalPrices(id) {
    // When editing, the quantity input is for original_quantity. Current quantity is not directly editable here.
    const original_qty = parseFloat(document.getElementById(`edit-original-quantity-${id}`).value) || 0;
    // We assume current_quantity will be reset to original_quantity on this type of edit (restock)
    // Or, if we want to preserve sales history, current_quantity might need separate logic or be non-editable here.
    // For now, let's assume an edit of original_quantity implies a reset of current_quantity for total calculations.
    // However, for "Profit (Sold Items)", we should use the actual current_quantity from the input field.
    const current_qty_val = parseFloat(document.getElementById(`edit-current-quantity-${id}`).value) || 0;
    // If original_qty is edited, it might imply a restock, so current_qty might also be intended to be updated.
    // For calculating "Profit (Sold Items)" in edit mode, we use the difference between original and current from the input fields.
    document.getElementById(`edit-current-quantity-${id}`).value = current_qty_val; // Ensure it's what's used

    const wholesalePrice = parseFloat(document.getElementById(`edit-wholesale-price-${id}`).value) || 0;
    const retailPriceEl = document.getElementById(`edit-retail-price-${id}`);
    let retailPrice = parseFloat(retailPriceEl.value);

    if (isNaN(retailPrice) || retailPriceEl.value.trim() === '') {
        retailPrice = wholesalePrice;
    }

    // Calculate total prices based on original_qty for display consistency if it's a restock view
    const display_total_qty = original_qty;
    const wholesaleTotalPrice = display_total_qty * wholesalePrice;
    const retailTotalPrice = display_total_qty * retailPrice;
    
    const itemsSoldInEdit = original_qty - current_qty_val;
    const profitPerItemInEdit = retailPrice - wholesalePrice;
    const totalProfitOnSoldItemsInEdit = itemsSoldInEdit > 0 ? itemsSoldInEdit * profitPerItemInEdit : 0;

    document.getElementById(`edit-wholesale-totalprice-${id}`).value = `₹${wholesaleTotalPrice.toFixed(2)}`;
    document.getElementById(`edit-retail-totalprice-${id}`).value = `₹${retailTotalPrice.toFixed(2)}`;
    document.getElementById(`edit-profit-sold-items-${id}`).value = `₹${totalProfitOnSoldItemsInEdit.toFixed(2)}`;
}

async function saveEdit(id) {
    const category = document.getElementById(`edit-category-${id}`).value;
    const subcategory = document.getElementById(`edit-subcategory-${id}`).value;
    // This quantity is the new original_quantity (and current_quantity will be reset to this by the server)
    const original_quantity = parseFloat(document.getElementById(`edit-original-quantity-${id}`).value) || 0;
    const wholesale_price = parseFloat(document.getElementById(`edit-wholesale-price-${id}`).value) || 0;
    let retail_price = parseFloat(document.getElementById(`edit-retail-price-${id}`).value);

    if (isNaN(retail_price) || document.getElementById(`edit-retail-price-${id}`).value.trim() === '') {
        retail_price = wholesale_price;
    }
    
    // Send original_quantity to server; server will set both original and current.
    await fetch(`/api/update/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            category,
            subcategory,
            original_quantity, // This tells the server it's a full stock update
            wholesale_price,
            retail_price
        })
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
    // Set active navigation link
    const currentPage = window.location.pathname.split("/").pop();
    if (currentPage === 'index.html' || currentPage === '') {
        document.getElementById('nav-inventory')?.classList.add('active');
    } else if (currentPage === 'sales.html') {
        // This part will be handled by sales.js for sales.html
    }

    loadProducts();
    populateCategories();
    loadMonthlySalesSummary(); // Load the summary on page load
});

async function loadMonthlySalesSummary() {
    const summaryDataEl = document.getElementById('monthly-summary-data');
    summaryDataEl.innerHTML = '<p>Loading summary...</p>'; // Clear previous/loading message

    try {
        const response = await fetch('/api/sales-summary/monthly');
        if (!response.ok) {
            const errorText = await response.text();
            summaryDataEl.innerHTML = `<p style="color: red;">Error loading summary: ${response.status} ${errorText}</p>`;
            return;
        }
        const summaryData = await response.json();

        if (!summaryData || summaryData.length === 0) {
            summaryDataEl.innerHTML = '<p>No sales data available for summary.</p>';
            return;
        }

        let summaryHtml = '<ul>';
        summaryData.forEach(monthData => {
            summaryHtml += `<li>
                <strong>Month: ${monthData.sale_month}</strong><br>
                Items Sold: ${monthData.total_items_sold}<br>
                Total Revenue: ₹${parseFloat(monthData.total_revenue || 0).toFixed(2)}<br>
                Total COGS: ₹${parseFloat(monthData.total_cogs || 0).toFixed(2)}<br>
                Total Profit: ₹${parseFloat(monthData.total_profit || 0).toFixed(2)}
            </li>`;
        });
        summaryHtml += '</ul>';
        summaryDataEl.innerHTML = summaryHtml;

    } catch (error) {
        console.error('Failed to load monthly sales summary:', error);
        summaryDataEl.innerHTML = '<p style="color: red;">Failed to load summary. See console for details.</p>';
    }
}