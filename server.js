const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const db = new sqlite3.Database('./inventory.db');

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize DB table
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT,
    subcategory TEXT,
    original_quantity INTEGER,
    current_quantity INTEGER NOT NULL,
    wholesale_price REAL NOT NULL,
    retail_price REAL,
    wholesale_total_price REAL,
    retail_total_price REAL,
    barcode_value TEXT,
    product_code TEXT UNIQUE
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS sales_log (
    log_id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER,
    quantity_sold INTEGER NOT NULL,
    sale_price_per_item REAL NOT NULL,
    wholesale_price_per_item_at_sale REAL NOT NULL,
    sale_timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id)
  )`);
});

// Routes
app.get('/api/products', (req, res) => {
  const { category, subcategory } = req.query;
  let sql = 'SELECT * FROM products';
  const params = [];

  if (category && subcategory) {
    sql += ' WHERE category = ? AND subcategory = ?';
    params.push(category, subcategory);
  } else if (category) {
    sql += ' WHERE category = ?';
    params.push(category);
  } else if (subcategory) { // Though typically subcategory is dependent on category
    sql += ' WHERE subcategory = ?';
    params.push(subcategory);
  }

  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Get all unique categories
app.get('/api/categories', (req, res) => {
  db.all('SELECT DISTINCT category FROM products WHERE category IS NOT NULL ORDER BY category', (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const categories = rows.map(row => row.category).filter(cat => cat); // Filter out nulls if any
    res.json(categories);
  });
});

// Get a single product by ID
app.get('/api/product/:id', (req, res) => {
  const id = req.params.id;
  db.get('SELECT * FROM products WHERE id = ?', [id], (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!row) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.json(row);
  });
});

// This is the active POST /api/add route
app.post('/api/add', async (req, res) => { // Made async to handle DB queries for ID generation
  let { category, subcategory, quantity, wholesale_price, retail_price } = req.body;

  if (!category || !subcategory || quantity === undefined || wholesale_price === undefined) {
    return res.status(400).json({ error: "Category, subcategory, initial quantity and wholesale_price are required." });
  }

  const catPrefix = String(category).substring(0, 2).toUpperCase();
  const subcatPrefix = String(subcategory).substring(0, 3).toUpperCase();
  const idPrefix = `${catPrefix}-${subcatPrefix}-`;

  const initial_quantity = parseInt(quantity, 10);
  wholesale_price = parseFloat(wholesale_price);
  retail_price = retail_price !== undefined ? parseFloat(retail_price) : wholesale_price;

  if (catPrefix.length < 2 || subcatPrefix.length < 1) { // Basic validation for prefixes
      return res.status(400).json({ error: "Category must be at least 2 chars, Subcategory at least 1 char."});
  }

  if (isNaN(initial_quantity) || initial_quantity < 0 || isNaN(wholesale_price) || wholesale_price < 0 || isNaN(retail_price) || retail_price < 0) {
    return res.status(400).json({ error: "Invalid number format for quantity or prices." });
  }

  const wholesale_total_price = initial_quantity * wholesale_price;
  const retail_total_price = initial_quantity * retail_price;

  try {
    // Find the highest current sequence for this prefix
    const row = await new Promise((resolve, reject) => {
      db.get(
        "SELECT product_code FROM products WHERE product_code LIKE ? ORDER BY product_code DESC LIMIT 1",
        [`${idPrefix}%`],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });

    let nextSeq = 1;
    if (row && row.product_code) {
      const lastSeqStr = row.product_code.substring(idPrefix.length);
      const lastSeq = parseInt(lastSeqStr, 10);
      if (!isNaN(lastSeq)) {
        nextSeq = lastSeq + 1;
      }
    }
    const product_code = `${idPrefix}${String(nextSeq).padStart(3, '0')}`;
    const barcode_value = product_code; // Barcode will use the new product_code

    // Insert the new product
    const result = await new Promise((resolve, reject) => {
      db.run(
        'INSERT INTO products (category, subcategory, original_quantity, current_quantity, wholesale_price, retail_price, wholesale_total_price, retail_total_price, product_code, barcode_value) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [category, subcategory, initial_quantity, initial_quantity, wholesale_price, retail_price, wholesale_total_price, retail_total_price, product_code, barcode_value],
        function(err) {
          if (err) reject(err);
          else resolve({ id: this.lastID, product_code: product_code }); // Return internal ID and new product_code
        }
      );
    });
    res.json(result);

  } catch (err) {
    console.error("Error generating product code or inserting product:", err.message);
    return res.status(500).json({ error: "Failed to add product: " + err.message });
  }
});

// This is the active POST /api/update/:id route
app.post('/api/update/:id', (req, res) => {
  const id = req.params.id;
  // 'quantity' in req.body for this route refers to the new current_quantity after a sale,
  // or a new stock level if it's a full inventory update.
  // 'isSale' flag can help differentiate, or we infer from which fields are present.
  // For now, if 'original_quantity' is in payload, it's a full stock update.
  // Otherwise, if 'quantity' (meaning current_quantity) is present, it's likely a sale or manual adjustment of current stock.
  const { category, subcategory, quantity, wholesale_price, retail_price, original_quantity: new_original_quantity } = req.body;

  db.get('SELECT * FROM products WHERE id = ?', [id], (err, currentRow) => {
    if (err) return res.status(500).json({ error: "Error fetching product: " + err.message });
    if (!currentRow) return res.status(404).json({ error: "Product not found for update." });

    const updatedFields = {};
    
    updatedFields.category = category !== undefined ? category : currentRow.category;
    updatedFields.subcategory = subcategory !== undefined ? subcategory : currentRow.subcategory;
    updatedFields.wholesale_price = wholesale_price !== undefined ? parseFloat(wholesale_price) : currentRow.wholesale_price;
    updatedFields.retail_price = retail_price !== undefined ? parseFloat(retail_price) : currentRow.retail_price;

    // Handle quantity updates:
    // If new_original_quantity is provided, it's a full restock/edit. Both original and current are set.
    // Otherwise, if quantity (for current_quantity) is provided, only current_quantity is updated (e.g., a sale).
    if (new_original_quantity !== undefined) {
        updatedFields.original_quantity = parseInt(new_original_quantity, 10);
        updatedFields.current_quantity = parseInt(new_original_quantity, 10); // On full restock, current matches original
    } else if (quantity !== undefined) {
        updatedFields.current_quantity = parseInt(quantity, 10);
        updatedFields.original_quantity = currentRow.original_quantity; // Keep original_quantity as is
    } else {
        updatedFields.current_quantity = currentRow.current_quantity;
        updatedFields.original_quantity = currentRow.original_quantity;
    }

    // Validate numeric fields
    if (isNaN(updatedFields.current_quantity) || updatedFields.current_quantity < 0 ||
        (updatedFields.original_quantity !== undefined && (isNaN(updatedFields.original_quantity) || updatedFields.original_quantity < 0)) ||
        isNaN(updatedFields.wholesale_price) || updatedFields.wholesale_price < 0 ||
        (updatedFields.retail_price !== null && (isNaN(updatedFields.retail_price) || updatedFields.retail_price < 0))) {
      return res.status(400).json({ error: "Invalid number format for quantity or prices in update." });
    }
    
    if (updatedFields.retail_price === null && retail_price === undefined) {
        updatedFields.retail_price = updatedFields.wholesale_price;
    }

    // Calculate totals based on current_quantity for display and valuation of current stock
    updatedFields.wholesale_total_price = updatedFields.current_quantity * updatedFields.wholesale_price;
    updatedFields.retail_total_price = updatedFields.current_quantity * (updatedFields.retail_price || updatedFields.wholesale_price);

    const sqlFields = [];
    const sqlParams = [];

    if (category !== undefined) { sqlFields.push('category = ?'); sqlParams.push(updatedFields.category); }
    if (subcategory !== undefined) { sqlFields.push('subcategory = ?'); sqlParams.push(updatedFields.subcategory); }
    if (new_original_quantity !== undefined) { // If it's a restock/full edit of quantity
        sqlFields.push('original_quantity = ?'); sqlParams.push(updatedFields.original_quantity);
        sqlFields.push('current_quantity = ?'); sqlParams.push(updatedFields.current_quantity);
    } else if (quantity !== undefined) { // If only current_quantity is being updated (e.g. sale)
        sqlFields.push('current_quantity = ?'); sqlParams.push(updatedFields.current_quantity);
    }
    if (wholesale_price !== undefined) { sqlFields.push('wholesale_price = ?'); sqlParams.push(updatedFields.wholesale_price); }
    if (retail_price !== undefined) { sqlFields.push('retail_price = ?'); sqlParams.push(updatedFields.retail_price); }
    
    sqlFields.push('wholesale_total_price = ?'); sqlParams.push(updatedFields.wholesale_total_price);
    sqlFields.push('retail_total_price = ?'); sqlParams.push(updatedFields.retail_total_price);
    
    if (sqlParams.length === 0) {
        return res.status(400).json({ error: "No valid fields to update."});
    }

    sqlParams.push(id);

    db.run(`UPDATE products SET ${sqlFields.join(', ')} WHERE id = ?`,
      sqlParams,
      function(err) {
        if (err) {
          console.error("Error updating product:", err.message);
          return res.status(500).json({ error: "Error updating product: " + err.message });
        }
        
        // Log the sale if it was a quantity reduction (sale) and not a full original_quantity update
        if (new_original_quantity === undefined && quantity !== undefined && currentRow.current_quantity > updatedFields.current_quantity) {
          const quantity_sold_in_transaction = currentRow.current_quantity - updatedFields.current_quantity;
          const sale_price_for_log = retail_price !== undefined ? parseFloat(retail_price) : currentRow.retail_price; // Price at which it was sold
          const wholesale_price_at_sale = currentRow.wholesale_price; // Wholesale price at the time of sale

          db.run(
            'INSERT INTO sales_log (product_id, quantity_sold, sale_price_per_item, wholesale_price_per_item_at_sale) VALUES (?, ?, ?, ?)',
            [id, quantity_sold_in_transaction, sale_price_for_log, wholesale_price_at_sale],
            (logErr) => {
              if (logErr) {
                // Log the error but don't fail the main update response
                console.error("Error logging sale:", logErr.message);
              }
            }
          );
        }
        res.json({ updated: this.changes });
      });
  });
});

app.get('/api/subcategories', (req, res) => {
  const { category } = req.query;
  if (!category) return res.json([]); // Return empty array if no category is provided
  db.all(
    'SELECT DISTINCT subcategory FROM products WHERE category = ? AND subcategory IS NOT NULL ORDER BY subcategory',
    [category],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      const subcategories = rows.map(row => row.subcategory).filter(sub => sub); // Filter out nulls
      res.json(subcategories);
    }
  );
});

// Keep DELETE route as is, it was fine.
app.delete('/api/delete/:id', (req, res) => {
  const id = req.params.id;
  db.run('DELETE FROM products WHERE id = ?', id, function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ deleted: this.changes });
  });
});

// Endpoint for monthly sales summary
app.get('/api/sales-summary/monthly', (req, res) => {
  const sql = `
    SELECT
      strftime('%Y-%m', sale_timestamp) AS sale_month,
      SUM(quantity_sold) AS total_items_sold,
      SUM(quantity_sold * sale_price_per_item) AS total_revenue,
      SUM(quantity_sold * wholesale_price_per_item_at_sale) AS total_cogs,
      SUM(quantity_sold * sale_price_per_item) - SUM(quantity_sold * wholesale_price_per_item_at_sale) AS total_profit
    FROM sales_log
    GROUP BY sale_month
    ORDER BY sale_month DESC;
  `;

  db.all(sql, [], (err, rows) => {
    if (err) {
      console.error("Error fetching monthly sales summary:", err.message);
      return res.status(500).json({ error: "Error fetching monthly sales summary: " + err.message });
    }
    res.json(rows);
  });
});


app.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});
