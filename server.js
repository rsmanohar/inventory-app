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
    quantity INTEGER NOT NULL,
    wholesale_price REAL NOT NULL,
    retail_price REAL,
    wholesale_total_price REAL,
    retail_total_price REAL
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
app.post('/api/add', (req, res) => {
  let { category, subcategory, quantity, wholesale_price, retail_price } = req.body;

  if (quantity === undefined || wholesale_price === undefined) {
    return res.status(400).json({ error: "Quantity and wholesale_price are required." });
  }
  quantity = parseInt(quantity, 10);
  wholesale_price = parseFloat(wholesale_price);
  retail_price = retail_price !== undefined ? parseFloat(retail_price) : wholesale_price; // Default retail to wholesale if not provided

  if (isNaN(quantity) || quantity < 0 || isNaN(wholesale_price) || wholesale_price < 0 || isNaN(retail_price) || retail_price < 0) {
    return res.status(400).json({ error: "Invalid number format for quantity or prices." });
  }

  const wholesale_total_price = quantity * wholesale_price;
  const retail_total_price = quantity * retail_price;

  db.run(
    'INSERT INTO products (category, subcategory, quantity, wholesale_price, retail_price, wholesale_total_price, retail_total_price) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [category || null, subcategory || null, quantity, wholesale_price, retail_price, wholesale_total_price, retail_total_price],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID });
    }
  );
});

// This is the active POST /api/update/:id route
app.post('/api/update/:id', (req, res) => {
  const id = req.params.id;
  const { category, subcategory, quantity, wholesale_price, retail_price } = req.body;

  // Fetch current product to correctly calculate new totals if only partial data is sent
  db.get('SELECT * FROM products WHERE id = ?', [id], (err, currentRow) => {
    if (err) return res.status(500).json({ error: "Error fetching product: " + err.message });
    if (!currentRow) return res.status(404).json({ error: "Product not found for update." });

    const updatedFields = {};
    
    // Use current values as defaults if not provided in request
    updatedFields.category = category !== undefined ? category : currentRow.category;
    updatedFields.subcategory = subcategory !== undefined ? subcategory : currentRow.subcategory;
    updatedFields.quantity = quantity !== undefined ? parseInt(quantity, 10) : currentRow.quantity;
    updatedFields.wholesale_price = wholesale_price !== undefined ? parseFloat(wholesale_price) : currentRow.wholesale_price;
    updatedFields.retail_price = retail_price !== undefined ? parseFloat(retail_price) : currentRow.retail_price;

    // Validate numeric fields
    if (isNaN(updatedFields.quantity) || updatedFields.quantity < 0 ||
        isNaN(updatedFields.wholesale_price) || updatedFields.wholesale_price < 0 ||
        (updatedFields.retail_price !== null && (isNaN(updatedFields.retail_price) || updatedFields.retail_price < 0))) {
      return res.status(400).json({ error: "Invalid number format for quantity or prices in update." });
    }
    
    // If retail_price is not set (e.g. during initial add it might default to wholesale), and it's not in payload, keep it as is or default.
    // For sales, retail_price will be explicitly set from the sales page.
    if (updatedFields.retail_price === null && retail_price === undefined) { // if it was null and not being updated
        updatedFields.retail_price = updatedFields.wholesale_price; // Default it if it was null
    }


    updatedFields.wholesale_total_price = updatedFields.quantity * updatedFields.wholesale_price;
    updatedFields.retail_total_price = updatedFields.quantity * (updatedFields.retail_price || updatedFields.wholesale_price); // Use wholesale if retail is null

    const sqlFields = [];
    const sqlParams = [];

    if (category !== undefined) { sqlFields.push('category = ?'); sqlParams.push(updatedFields.category); }
    if (subcategory !== undefined) { sqlFields.push('subcategory = ?'); sqlParams.push(updatedFields.subcategory); }
    if (quantity !== undefined) { sqlFields.push('quantity = ?'); sqlParams.push(updatedFields.quantity); }
    if (wholesale_price !== undefined) { sqlFields.push('wholesale_price = ?'); sqlParams.push(updatedFields.wholesale_price); }
    if (retail_price !== undefined) { sqlFields.push('retail_price = ?'); sqlParams.push(updatedFields.retail_price); }
    
    // Always update calculated totals
    sqlFields.push('wholesale_total_price = ?'); sqlParams.push(updatedFields.wholesale_total_price);
    sqlFields.push('retail_total_price = ?'); sqlParams.push(updatedFields.retail_total_price);

    if (sqlFields.length === 2 && sqlFields.includes('wholesale_total_price = ?') && sqlFields.includes('retail_total_price = ?') && quantity === undefined && wholesale_price === undefined && retail_price === undefined && category === undefined && subcategory === undefined) {
        // This case means only totals were pushed, likely no actual data fields were sent for update.
        // However, our logic above defaults to current values, so an update will still occur.
        // If no actual data fields (qty, prices, cat, subcat) are in req.body, this means we are just re-saving.
        // This check can be refined if we want to prevent updates if only calculated fields would change due to no input.
        // For now, we proceed as the logic ensures values are present.
    }
    
    if (sqlParams.length === 0) { // Should not happen due to total price updates
        return res.status(400).json({ error: "No valid fields to update."});
    }

    sqlParams.push(id);

    db.run(`UPDATE products SET ${sqlFields.join(', ')} WHERE id = ?`,
      sqlParams,
      function(err) {
        if (err) return res.status(500).json({ error: "Error updating product: " + err.message });
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

app.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});
