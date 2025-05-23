let currentProductForSale = null;

document.addEventListener('DOMContentLoaded', () => {
    // Set active navigation link
    const currentPage = window.location.pathname.split("/").pop();
    if (currentPage === 'sales.html') {
        document.getElementById('nav-sales')?.classList.add('active');
    }

    // Barcode scanner button logic
    document.getElementById('start-scanner-btn').addEventListener('click', () => {
        const scannerDiv = document.getElementById('barcode-scanner');
        scannerDiv.style.display = 'block';
        const html5QrCode = new Html5Qrcode("barcode-scanner");
        html5QrCode.start(
            { facingMode: "environment" },
            { fps: 10, qrbox: 250 },
            (decodedText, decodedResult) => {
                html5QrCode.stop();
                scannerDiv.style.display = 'none';
                document.getElementById('productId').value = decodedText;
                fetchProductForSale();
            },
            (errorMessage) => {
                // Optionally handle scan errors
            }
        ).catch(err => {
            alert("Unable to start barcode scanner: " + err);
        });
    });
});

async function fetchProductForSale() {
    const productId = document.getElementById('productId').value;
    const messageEl = document.getElementById('sales-message');
    const detailsSection = document.getElementById('product-details-for-sale');

    messageEl.textContent = '';
    detailsSection.style.display = 'none';
    currentProductForSale = null;

    if (!productId) {
        messageEl.textContent = 'Please enter a Product ID.';
        messageEl.style.color = 'red';
        return;
    }

    try {
        const response = await fetch(`/api/product/${productId}`);
        if (!response.ok) {
            if (response.status === 404) {
                messageEl.textContent = `Product with ID ${productId} not found.`;
            } else {
                const errorData = await response.json();
                messageEl.textContent = `Error: ${errorData.error || response.statusText}`;
            }
            messageEl.style.color = 'red';
            return;
        }
        currentProductForSale = await response.json();

        document.getElementById('sale-product-id').textContent = currentProductForSale.product_code || currentProductForSale.id; // Display product_code
        document.getElementById('sale-product-category').textContent = currentProductForSale.category || 'N/A';
        document.getElementById('sale-product-subcategory').textContent = currentProductForSale.subcategory || 'N/A';
        // Display current_quantity as the available stock for sale
        document.getElementById('sale-product-current-quantity').textContent = currentProductForSale.current_quantity;
        
        const wholesalePrice = parseFloat(currentProductForSale.wholesale_price || 0);
        const retailPrice = parseFloat(currentProductForSale.retail_price || wholesalePrice);

        // The element 'sale-product-current-price' was removed from HTML, so this line is no longer needed.

        document.getElementById('quantitySold').value = '1';
        document.getElementById('quantitySold').max = currentProductForSale.current_quantity; // Max is current_quantity
        document.getElementById('salePrice').value = retailPrice.toFixed(2); // Input field for sale price, no symbol here

        // Generate barcode for the fetched product
        const saleBarcodeEl = document.getElementById('sale-product-barcode');
        const valueForSaleBarcode = currentProductForSale.product_code || String(currentProductForSale.id); // Use product_code
        if (valueForSaleBarcode && saleBarcodeEl) {
            try {
                JsBarcode(saleBarcodeEl, valueForSaleBarcode, {
                    format: "CODE128",
                    lineColor: "#000",
                    width: 2,
                    height: 50,
                    displayValue: true,
                    fontSize: 16
                });
            } catch (e) {
                console.error("Error generating barcode on sales page:", e);
                saleBarcodeEl.innerHTML = "Error";
            }
        } else if (saleBarcodeEl) {
            saleBarcodeEl.innerHTML = "N/A";
        }

        detailsSection.style.display = 'block';
        messageEl.textContent = 'Product details loaded.';
        messageEl.style.color = 'green';

    } catch (error) {
        console.error('Error fetching product:', error);
        messageEl.textContent = 'Failed to fetch product. See console for details.';
        messageEl.style.color = 'red';
    }
}

async function markAsSale() {
    const messageEl = document.getElementById('sales-message');
    if (!currentProductForSale) {
        messageEl.textContent = 'No product fetched. Please fetch a product first.';
        messageEl.style.color = 'red';
        return;
    }

    const quantitySold = parseInt(document.getElementById('quantitySold').value, 10);
    const salePrice = parseFloat(document.getElementById('salePrice').value);

    if (isNaN(quantitySold) || quantitySold <= 0) {
        messageEl.textContent = 'Please enter a valid quantity sold (must be > 0).';
        messageEl.style.color = 'red';
        return;
    }

    if (isNaN(salePrice) || salePrice < 0) {
        messageEl.textContent = 'Please enter a valid sale price (must be >= 0).';
        messageEl.style.color = 'red';
        return;
    }

    // Check against current_quantity
    if (quantitySold > currentProductForSale.current_quantity) {
        messageEl.textContent = `Cannot sell ${quantitySold} items. Only ${currentProductForSale.current_quantity} available.`;
        messageEl.style.color = 'red';
        return;
    }

    const new_current_quantity = currentProductForSale.current_quantity - quantitySold;
    
    const updatePayload = {
        quantity: new_current_quantity, // This is the new current_quantity
        retail_price: salePrice,
        // original_quantity is not sent, so server keeps it as is.
        // wholesale_price is not changed by a sale.
    };

    try {
        const response = await fetch(`/api/update/${currentProductForSale.id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updatePayload)
        });

        if (!response.ok) {
            const errorData = await response.json();
            messageEl.textContent = `Error updating product: ${errorData.error || response.statusText}`;
            messageEl.style.color = 'red';
            return;
        }

        const result = await response.json();
        if (result.updated > 0) {
            messageEl.textContent = `Sale successful! Product ID ${currentProductForSale.id} updated. New quantity: ${new_current_quantity}.`;
            messageEl.style.color = 'green';
            // Clear fields and hide details section after successful sale
            document.getElementById('product-details-for-sale').style.display = 'none';
            document.getElementById('productId').value = '';
            currentProductForSale = null;
        } else {
            messageEl.textContent = 'Sale processed, but no changes were made in the database.';
            messageEl.style.color = 'orange';
        }

    } catch (error) {
        console.error('Error marking as sale:', error);
        messageEl.textContent = 'Failed to mark as sale. See console for details.';
        messageEl.style.color = 'red';
    }
}