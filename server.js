const express = require('express');
const Database = require('better-sqlite3');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const db = new Database('inventory.db', { verbose: console.log }); // Correct initialization for better-sqlite3

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize DB tables
try {
  db.exec(`CREATE TABLE IF NOT EXISTS products (
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

  db.exec(`CREATE TABLE IF NOT EXISTS sales_log (
    log_id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER,
    quantity_sold INTEGER NOT NULL,
    sale_price_per_item REAL NOT NULL,
    wholesale_price_per_item_at_sale REAL NOT NULL,
    sale_timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id)
  )`);
  console.log("Database tables checked/created successfully.");
} catch (err) {
  console.error("Error initializing database tables:", err.message);
  process.exit(1); // Exit if DB setup fails
}

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
  } else if (subcategory) {
    sql += ' WHERE subcategory = ?';
    params.push(subcategory);
  }

  try {
    const stmt = db.prepare(sql);
    const rows = stmt.all(...params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all unique categories
app.get('/api/categories', (req, res) => {
  try {
    const stmt = db.prepare('SELECT DISTINCT category FROM products WHERE category IS NOT NULL ORDER BY category');
    const rows = stmt.all();
    const categories = rows.map(row => row.category).filter(cat => cat);
    res.json(categories);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get a single product by ID or product_code
app.get('/api/product/:identifier', (req, res) => {
  const identifier = req.params.identifier;
  let stmt;
  let row;
  try {
    // Try to interpret the identifier as a number (ID) first
    if (!isNaN(identifier) && Number.isInteger(parseFloat(identifier))) {
      stmt = db.prepare('SELECT * FROM products WHERE id = ?');
      row = stmt.get(parseInt(identifier, 10));
    }

    // If not found by ID or if identifier is not a simple integer, try by product_code (case-insensitive and trim identifier)
    if (!row) {
      stmt = db.prepare('SELECT * FROM products WHERE product_code = ? COLLATE NOCASE');
      row = stmt.get(String(identifier).trim()); // Trim identifier just in case
    }

    if (!row) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.json(row);
  } catch (err) {
    console.error(`Error fetching product by identifier ${identifier}:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// This is the active POST /api/add route
app.post('/api/add', (req, res) => {
  let { category, subcategory, quantity, wholesale_price, retail_price } = req.body;

  if (!category || !subcategory || quantity === undefined || wholesale_price === undefined) {
    return res.status(400).json({ error: "Category, subcategory, initial quantity and wholesale_price are required." });
  }

  // Trim category and subcategory
  const trimmedCategory = String(category).trim();
  const trimmedSubcategory = String(subcategory).trim();

  if (!trimmedCategory || !trimmedSubcategory) {
    return res.status(400).json({ error: "Category and subcategory names cannot be empty after trimming." });
  }

  const catPrefix = trimmedCategory.substring(0, 2).toUpperCase();
  const subcatPrefix = trimmedSubcategory.substring(0, 3).toUpperCase();
  const idPrefix = `${catPrefix}-${subcatPrefix}-`;

  const initial_quantity = parseInt(quantity, 10);
  wholesale_price = parseFloat(wholesale_price);
  retail_price = retail_price !== undefined ? parseFloat(retail_price) : wholesale_price;

  if (catPrefix.length < 2 || subcatPrefix.length < 1) {
    return res.status(400).json({ error: "Category must be at least 2 chars, Subcategory at least 1 char."});
  }

  if (isNaN(initial_quantity) || initial_quantity < 0 || isNaN(wholesale_price) || wholesale_price < 0 || isNaN(retail_price) || retail_price < 0) {
    return res.status(400).json({ error: "Invalid number format for quantity or prices." });
  }

  const wholesale_total_price = initial_quantity * wholesale_price;
  const retail_total_price = initial_quantity * retail_price;

  try {
    // Find the highest current sequence for this prefix
    const getProductStmt = db.prepare("SELECT product_code FROM products WHERE product_code LIKE ? ORDER BY product_code DESC LIMIT 1");
    const row = getProductStmt.get(`${idPrefix}%`);

    let nextSeq = 1;
    if (row && row.product_code) {
      const lastSeqStr = row.product_code.substring(idPrefix.length);
      const lastSeq = parseInt(lastSeqStr, 10);
      if (!isNaN(lastSeq)) {
        nextSeq = lastSeq + 1;
      }
    }
    const product_code = `${idPrefix}${String(nextSeq).padStart(3, '0')}`;
    const barcode_value = product_code;

    // Insert the new product
    const insertStmt = db.prepare(
      'INSERT INTO products (category, subcategory, original_quantity, current_quantity, wholesale_price, retail_price, wholesale_total_price, retail_total_price, product_code, barcode_value) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    const info = insertStmt.run(trimmedCategory, trimmedSubcategory, initial_quantity, initial_quantity, wholesale_price, retail_price, wholesale_total_price, retail_total_price, product_code, barcode_value);
    
    res.json({ id: info.lastInsertRowid, product_code: product_code });

  } catch (err) {
    console.error("Error generating product code or inserting product:", err.message);
    return res.status(500).json({ error: "Failed to add product: " + err.message });
  }
});

// This is the active POST /api/update/:id route
app.post('/api/update/:id', (req, res) => {
  const id = req.params.id;
  const { category, subcategory, quantity, wholesale_price, retail_price, original_quantity: new_original_quantity } = req.body;

  try {
    const getProductStmt = db.prepare('SELECT * FROM products WHERE id = ?');
    const currentRow = getProductStmt.get(id);

    if (!currentRow) return res.status(404).json({ error: "Product not found for update." });

    const updatedFields = {};
    
    updatedFields.category = category !== undefined ? category : currentRow.category;
    updatedFields.subcategory = subcategory !== undefined ? subcategory : currentRow.subcategory;
    updatedFields.wholesale_price = wholesale_price !== undefined ? parseFloat(wholesale_price) : currentRow.wholesale_price;
    updatedFields.retail_price = retail_price !== undefined ? parseFloat(retail_price) : currentRow.retail_price;

    if (new_original_quantity !== undefined) {
        updatedFields.original_quantity = parseInt(new_original_quantity, 10);
        updatedFields.current_quantity = parseInt(new_original_quantity, 10);
    } else if (quantity !== undefined) {
        updatedFields.current_quantity = parseInt(quantity, 10);
        updatedFields.original_quantity = currentRow.original_quantity; 
    } else {
        updatedFields.current_quantity = currentRow.current_quantity;
        updatedFields.original_quantity = currentRow.original_quantity;
    }

    if (isNaN(updatedFields.current_quantity) || updatedFields.current_quantity < 0 ||
        (updatedFields.original_quantity !== undefined && (isNaN(updatedFields.original_quantity) || updatedFields.original_quantity < 0)) ||
        isNaN(updatedFields.wholesale_price) || updatedFields.wholesale_price < 0 ||
        (updatedFields.retail_price !== null && (isNaN(updatedFields.retail_price) || updatedFields.retail_price < 0))) {
      return res.status(400).json({ error: "Invalid number format for quantity or prices in update." });
    }
    
    if (updatedFields.retail_price === null && retail_price === undefined) { // if retail_price was explicitly set to null or not provided
        updatedFields.retail_price = updatedFields.wholesale_price; // Default to wholesale if not set or cleared
    }


    updatedFields.wholesale_total_price = updatedFields.current_quantity * updatedFields.wholesale_price;
    updatedFields.retail_total_price = updatedFields.current_quantity * (updatedFields.retail_price || updatedFields.wholesale_price);

    const sqlFields = [];
    const sqlParams = [];

    if (category !== undefined) { sqlFields.push('category = ?'); sqlParams.push(updatedFields.category); }
    if (subcategory !== undefined) { sqlFields.push('subcategory = ?'); sqlParams.push(updatedFields.subcategory); }
    if (new_original_quantity !== undefined) {
        sqlFields.push('original_quantity = ?'); sqlParams.push(updatedFields.original_quantity);
        sqlFields.push('current_quantity = ?'); sqlParams.push(updatedFields.current_quantity);
    } else if (quantity !== undefined) {
        sqlFields.push('current_quantity = ?'); sqlParams.push(updatedFields.current_quantity);
    }
    if (wholesale_price !== undefined) { sqlFields.push('wholesale_price = ?'); sqlParams.push(updatedFields.wholesale_price); }
    if (retail_price !== undefined) { sqlFields.push('retail_price = ?'); sqlParams.push(updatedFields.retail_price); }
    
    sqlFields.push('wholesale_total_price = ?'); sqlParams.push(updatedFields.wholesale_total_price);
    sqlFields.push('retail_total_price = ?'); sqlParams.push(updatedFields.retail_total_price);
    
    if (sqlParams.length === 0) { // Check if any actual update parameters were generated besides totals
        let noActualChange = true;
        if (category !== undefined || subcategory !== undefined || new_original_quantity !== undefined || quantity !== undefined || wholesale_price !== undefined || retail_price !== undefined) {
            noActualChange = false;
        }
        if(noActualChange && (updatedFields.wholesale_total_price === currentRow.wholesale_total_price && updatedFields.retail_total_price === currentRow.retail_total_price)){
             return res.status(400).json({ error: "No valid fields to update."});
        }
    }
    
    sqlParams.push(id);

    const updateStmt = db.prepare(`UPDATE products SET ${sqlFields.join(', ')} WHERE id = ?`);
    const info = updateStmt.run(...sqlParams);
        
    if (new_original_quantity === undefined && quantity !== undefined && currentRow.current_quantity > updatedFields.current_quantity) {
      const quantity_sold_in_transaction = currentRow.current_quantity - updatedFields.current_quantity;
      const sale_price_for_log = retail_price !== undefined ? parseFloat(retail_price) : currentRow.retail_price;
      const wholesale_price_at_sale = currentRow.wholesale_price;

      try {
        const logSaleStmt = db.prepare(
          'INSERT INTO sales_log (product_id, quantity_sold, sale_price_per_item, wholesale_price_per_item_at_sale) VALUES (?, ?, ?, ?)'
        );
        logSaleStmt.run(id, quantity_sold_in_transaction, sale_price_for_log, wholesale_price_at_sale);
      } catch (logErr) {
        console.error("Error logging sale:", logErr.message); // Log error but don't fail update
      }
    }
    res.json({ updated: info.changes });

  } catch (err) {
    console.error("Error updating product:", err.message);
    return res.status(500).json({ error: "Error updating product: " + err.message });
  }
});

app.get('/api/subcategories', (req, res) => {
  const { category } = req.query;
  if (!category) return res.json([]);
  try {
    const stmt = db.prepare('SELECT DISTINCT subcategory FROM products WHERE category = ? AND subcategory IS NOT NULL ORDER BY subcategory');
    const rows = stmt.all(category);
    const subcategories = rows.map(row => row.subcategory).filter(sub => sub);
    res.json(subcategories);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/delete/:id', (req, res) => {
  const id = req.params.id;
  try {
    const stmt = db.prepare('DELETE FROM products WHERE id = ?');
    const info = stmt.run(id);
    res.json({ deleted: info.changes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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
  try {
    const stmt = db.prepare(sql);
    const rows = stmt.all();
    res.json(rows);
  } catch (err) {
    console.error("Error fetching monthly sales summary:", err.message);
    res.status(500).json({ error: "Error fetching monthly sales summary: " + err.message });
  }
});

app.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});
