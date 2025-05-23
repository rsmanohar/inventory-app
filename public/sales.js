let currentProductForSale = null;

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

        document.getElementById('sale-product-id').textContent = currentProductForSale.id;
        document.getElementById('sale-product-category').textContent = currentProductForSale.category || 'N/A';
        document.getElementById('sale-product-subcategory').textContent = currentProductForSale.subcategory || 'N/A';
        document.getElementById('sale-product-current-quantity').textContent = currentProductForSale.quantity;
        
        const wholesalePrice = parseFloat(currentProductForSale.wholesale_price || 0);
        const retailPrice = parseFloat(currentProductForSale.retail_price || wholesalePrice); // Default to wholesale if retail is not set

        document.getElementById('sale-product-current-price').innerHTML = `Wholesale: $${wholesalePrice.toFixed(2)} / Retail: $${retailPrice.toFixed(2)}`; // Changed to show both
        // Total prices are not directly shown here anymore, but could be if needed. The main display is per-item price.

        document.getElementById('quantitySold').value = '1'; // Default to 1
        document.getElementById('quantitySold').max = currentProductForSale.quantity; // Max is current stock
        document.getElementById('salePrice').value = retailPrice.toFixed(2); // Default salePrice input to current retail_price

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

    if (quantitySold > currentProductForSale.quantity) {
        messageEl.textContent = `Cannot sell ${quantitySold} items. Only ${currentProductForSale.quantity} available.`;
        messageEl.style.color = 'red';
        return;
    }

    const newQuantity = currentProductForSale.quantity - quantitySold;
    // When a sale is made, the product's retail_price is updated to the salePrice.
    // The wholesale_price of the product itself does not change due to a sale.
    // The server will recalculate wholesale_total_price and retail_total_price.
    const updatePayload = {
        quantity: newQuantity,
        retail_price: salePrice, // This sale's price becomes the new retail_price for the remaining stock
        // wholesale_price is not changed by a sale action on this page.
        // category and subcategory also remain unchanged.
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
            messageEl.textContent = `Sale successful! Product ID ${currentProductForSale.id} updated. New quantity: ${newQuantity}.`;
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