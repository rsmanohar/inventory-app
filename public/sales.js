let currentProductForSale = null;
let lastSaleReceiptData = null; // To store data for WhatsApp/Print

const businessDetails = {
    logoUrl: 'images/logo.jpg', // Assuming logo is in public/images/logo.png
    name: 'Navyata Boutique', // Extracted from logo, can be customized
    address: 'MIG45, Sector 5, MVP Colony, Visakhapatnam, Andhra Pradesh 530017',
    phone: '+91-7416610168',
    tagline: 'Specialist in Designing & Stitching' // From logo
};

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
                html5QrCode.stop().then(() => {
                    scannerDiv.style.display = 'none';
                    document.getElementById('productId').value = decodedText;
                    fetchProductForSale();
                }).catch(err => console.error("Error stopping scanner:", err));
            },
            (errorMessage) => {
                // Optionally handle scan errors
            }
        ).catch(err => {
            alert("Unable to start barcode scanner: " + err);
            scannerDiv.style.display = 'none'; // Hide if error on start
        });
    });

    // Receipt button event listeners
    document.getElementById('print-receipt-btn').addEventListener('click', printReceipt);
    document.getElementById('whatsapp-receipt-btn').addEventListener('click', shareReceiptToWhatsApp);
    document.getElementById('close-receipt-btn').addEventListener('click', () => {
        document.getElementById('receipt-section').style.display = 'none';
    });
});

async function fetchProductForSale() {
    const productId = document.getElementById('productId').value;
    const messageEl = document.getElementById('sales-message');
    const detailsSection = document.getElementById('product-details-for-sale');
    const receiptSection = document.getElementById('receipt-section');

    messageEl.textContent = '';
    detailsSection.style.display = 'none';
    receiptSection.style.display = 'none'; // Hide receipt when fetching new product
    currentProductForSale = null;
    lastSaleReceiptData = null;

    if (!productId) {
        messageEl.textContent = 'Please enter a Product ID.';
        messageEl.style.color = 'red';
        return;
    }

    try {
        const response = await fetch(`/api/product/${productId}`);
        if (!response.ok) {
            if (response.status === 404) {
                messageEl.textContent = `Product with ID/Code ${productId} not found.`;
            } else {
                const errorData = await response.json();
                messageEl.textContent = `Error: ${errorData.error || response.statusText}`;
            }
            messageEl.style.color = 'red';
            return;
        }
        currentProductForSale = await response.json();

        document.getElementById('sale-product-id').textContent = currentProductForSale.product_code || currentProductForSale.id;
        document.getElementById('sale-product-category').textContent = currentProductForSale.category || 'N/A';
        document.getElementById('sale-product-subcategory').textContent = currentProductForSale.subcategory || 'N/A';
        document.getElementById('sale-product-current-quantity').textContent = currentProductForSale.current_quantity;
        
        const wholesalePrice = parseFloat(currentProductForSale.wholesale_price || 0);
        const retailPrice = parseFloat(currentProductForSale.retail_price || wholesalePrice);

        document.getElementById('quantitySold').value = '1';
        document.getElementById('quantitySold').max = currentProductForSale.current_quantity;
        document.getElementById('salePrice').value = retailPrice.toFixed(2);

        const saleBarcodeEl = document.getElementById('sale-product-barcode');
        const valueForSaleBarcode = currentProductForSale.product_code || String(currentProductForSale.id);
        if (valueForSaleBarcode && saleBarcodeEl) {
            try {
                JsBarcode(saleBarcodeEl, valueForSaleBarcode, {
                    format: "CODE128", lineColor: "#000", width: 2, height: 50, displayValue: true, fontSize: 16
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
    const salePricePerItem = parseFloat(document.getElementById('salePrice').value);

    if (isNaN(quantitySold) || quantitySold <= 0) {
        messageEl.textContent = 'Please enter a valid quantity sold (must be > 0).';
        messageEl.style.color = 'red';
        return;
    }

    if (isNaN(salePricePerItem) || salePricePerItem < 0) {
        messageEl.textContent = 'Please enter a valid sale price (must be >= 0).';
        messageEl.style.color = 'red';
        return;
    }

    if (quantitySold > currentProductForSale.current_quantity) {
        messageEl.textContent = `Cannot sell ${quantitySold} items. Only ${currentProductForSale.current_quantity} available.`;
        messageEl.style.color = 'red';
        return;
    }

    const new_current_quantity = currentProductForSale.current_quantity - quantitySold;
    
    const updatePayload = {
        quantity: new_current_quantity,
        retail_price: salePricePerItem,
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
            const successMsg = `Sale successful! Product ID ${currentProductForSale.product_code || currentProductForSale.id} updated. New quantity: ${new_current_quantity}.`;
            messageEl.textContent = successMsg;
            messageEl.style.color = 'green';
            
            lastSaleReceiptData = {
                productIdentifier: currentProductForSale.product_code || currentProductForSale.id,
                category: currentProductForSale.category,
                subcategory: currentProductForSale.subcategory,
                quantitySold: quantitySold,
                salePricePerItem: salePricePerItem,
                totalSaleAmount: quantitySold * salePricePerItem,
                timestamp: new Date()
            };
            generateAndShowReceipt(lastSaleReceiptData);

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

function generateAndShowReceipt(data) {
    const receiptContentEl = document.getElementById('receipt-content');
    const receiptSectionEl = document.getElementById('receipt-section');

    const totalPrice = data.totalSaleAmount.toFixed(2);

    receiptContentEl.innerHTML = `
        <div class="receipt-header">
            <img src="${businessDetails.logoUrl}" alt="Logo" class="receipt-logo">
            <h2>${businessDetails.name}</h2>
            <p>${businessDetails.tagline}</p>
            <p>${businessDetails.address}</p>
            <p>Phone: ${businessDetails.phone}</p>
        </div>
        <hr class="receipt-hr">
        <p><strong>Date:</strong> ${data.timestamp.toLocaleString()}</p>
        <p><strong>Receipt No:</strong> SALE-${Date.now()}</p> <!-- Simple unique ID -->
        <hr class="receipt-hr">
        <div class="receipt-item">
            <span><strong>Product:</strong> ${data.productIdentifier}</span>
            <span>(${data.category || 'N/A'} - ${data.subcategory || 'N/A'})</span>
        </div>
        <div class="receipt-item">
            <span><strong>Quantity:</strong> ${data.quantitySold}</span>
            <span>@ $${data.salePricePerItem.toFixed(2)}/item</span>
        </div>
        <hr class="receipt-hr">
        <p class="receipt-total"><strong>Total Amount: $${totalPrice}</strong></p>
        <hr class="receipt-hr">
        <p class="receipt-footer">Thank you for your purchase!</p>
    `;
    receiptSectionEl.style.display = 'block';
}

function printReceipt() {
    const receiptSection = document.getElementById('receipt-section');
    if (receiptSection.style.display === 'none' || !lastSaleReceiptData) {
        alert("No receipt to print.");
        return;
    }
    
    const originalBodyDisplay = [];
    document.body.childNodes.forEach(node => {
        if (node.style && node !== receiptSection && node.tagName !== 'SCRIPT' && node.tagName !== 'LINK' && node.tagName !== 'HEAD' && node.tagName !== 'TITLE' && node.tagName !== 'META') {
            originalBodyDisplay.push({node: node, display: node.style.display});
            node.style.display = 'none';
        }
    });
    
    // Add a temporary class to body for print-specific styles
    document.body.classList.add('printing-receipt');
    window.print();
    document.body.classList.remove('printing-receipt');


    originalBodyDisplay.forEach(item => {
        item.node.style.display = item.display;
    });
}

function shareReceiptToWhatsApp() {
    if (!lastSaleReceiptData) {
        alert("No receipt data to share.");
        return;
    }
    const totalPrice = lastSaleReceiptData.totalSaleAmount.toFixed(2);
    let message = `*${businessDetails.name} - Sale Receipt*\n\n`;
    message += `Address: ${businessDetails.address}\n`;
    message += `Phone: ${businessDetails.phone}\n\n`;
    message += `Date: ${lastSaleReceiptData.timestamp.toLocaleString()}\n`;
    message += `Product: ${lastSaleReceiptData.productIdentifier}\n`;
    message += `Quantity: ${lastSaleReceiptData.quantitySold}\n`;
    message += `Price/Item: $${lastSaleReceiptData.salePricePerItem.toFixed(2)}\n`;
    message += `*Total: $${totalPrice}*\n\n`;
    message += `Thank you for your purchase!`;

    const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(message)}`;
    window.open(whatsappUrl, '_blank');
}