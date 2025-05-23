async function loadProducts() {
    const res = await fetch('/api/products');
    const products = await res.json();
    const tableBody = document.querySelector('#productTable tbody');
    tableBody.innerHTML = '';
    products.forEach(p => {
        tableBody.innerHTML += `
            <tr>
                <td>${p.id}</td>
                <td>${p.name}</td>
                <td><input type="number" value="${p.quantity}" onchange="updateQuantity(${p.id}, this.value)"></td>
                <td><input type="number" step="0.01" value="${p.price}" onchange="updatePrice(${p.id}, this.value)"></td>
                <td><button onclick="deleteProduct(${p.id})">Delete</button></td>
            </tr>`;
    });
}

async function addProduct() {
    const name = document.getElementById('name').value;
    const quantity = document.getElementById('quantity').value;
    const price = document.getElementById('price').value;

    await fetch('/api/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, quantity, price })
    });

    loadProducts();
}

async function updateQuantity(id, quantity) {
    const row = document.querySelector(`tr td:first-child:contains(${id})`).parentElement;
    const price = row.querySelector('td:nth-child(4) input').value;

    await fetch(`/api/update/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity, price })
    });

    loadProducts();
}

async function updatePrice(id, price) {
    const row = document.querySelector(`tr td:first-child:contains(${id})`).parentElement;
    const quantity = row.querySelector('td:nth-child(3) input').value;

    await fetch(`/api/update/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity, price })
    });

    loadProducts();
}

async function deleteProduct(id) {
    await fetch(`/api/delete/${id}`, { method: 'DELETE' });
    loadProducts();
}

loadProducts();
