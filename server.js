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
    name TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    price REAL NOT NULL
  )`);
});

// Routes
app.get('/api/products', (req, res) => {
  db.all('SELECT * FROM products', (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/add', (req, res) => {
  const { name, quantity, price } = req.body;
  db.run('INSERT INTO products (name, quantity, price) VALUES (?, ?, ?)',
    [name, quantity, price],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID });
    });
});

app.post('/api/update/:id', (req, res) => {
  const { quantity, price } = req.body;
  const id = req.params.id;
  db.run('UPDATE products SET quantity = ?, price = ? WHERE id = ?',
    [quantity, price, id],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ updated: this.changes });
    });
});

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
