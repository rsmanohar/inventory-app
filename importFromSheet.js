// scripts/importFromSheet.js
const Database = require('better-sqlite3'); // Changed to better-sqlite3
const fetch = (...args) => import('node-fetch').then(mod => mod.default(...args));

// IMPORTANT: Store sensitive information like API keys in environment variables
// or a secure configuration management system, not directly in code.
// Example: const API_KEY = process.env.GOOGLE_SHEETS_API_KEY;
const CONFIG = {
  SPREADSHEET_ID: '1Gk8K76m_LpIPgd5nZ-SB5ZWx2mJ4gRCgE3tOyC4Z78o', // Consider making this configurable too
  SHEET_NAME: 'inventory', // And this
  API_KEY: 'AIzaSyCsBBcFZHbFQBD22Rz9ISHwfWHfDm989pM' // <<< CRITICAL SECURITY RISK: Hardcoded API Key. Use environment variables.
};

const DB_PATH = './inventory.db';

async function fetchSheetData() {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SPREADSHEET_ID}/values/${CONFIG.SHEET_NAME}?key=${CONFIG.API_KEY}`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Google Sheets API request failed with status ${res.status}: ${errorText}`);
    }
    const json = await res.json();

    if (!json.values || json.values.length < 1) {
      console.warn("⚠️ No data found in the sheet or sheet is empty.");
      return [];
    }

    const [headers, ...rows] = json.values;
    return rows.map(row => {
      const obj = {};
      headers.forEach((key, i) => {
        let processedKey = String(key || '').trim().toLowerCase();
        processedKey = processedKey.replace(/\s+/g, '_');
        if (processedKey) {
          obj[processedKey] = row[i] !== undefined && row[i] !== null ? String(row[i]).trim() : '';
        }
      });
      return obj;
    });
  } catch (error) {
    console.error("❌ Error fetching or parsing sheet data:", error);
    throw error;
  }
}

async function importToDB() {
  let db;
  try {
    db = new Database(DB_PATH, { verbose: console.log }); // Use better-sqlite3
    console.log("🗄️ Connected to the SQLite database.");

    const items = await fetchSheetData();
    if (!items || items.length === 0) {
      console.log("ℹ️ No items to import.");
      return;
    }
    console.log(`📥 Importing ${items.length} items...`);

    // Ensure table schema matches server.js, including product_code and barcode_value
    db.exec(`
      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT,
        subcategory TEXT,
        original_quantity INTEGER,
        current_quantity INTEGER NOT NULL,
        wholesale_price REAL NOT NULL,
        retail_price REAL,
        wholesale_total_price REAL,
        retail_total_price REAL,
        barcode_value TEXT,          -- Added
        product_code TEXT UNIQUE     -- Added
      )
    `);
    console.log("✔️ Table 'products' ensured (schema updated).");

    db.exec("BEGIN TRANSACTION");
    console.log("🔄 Started transaction.");

    // Clear existing products before import.
    // Consider if this is always desired. Maybe an update/insert (upsert) strategy is better for some use cases.
    db.exec("DELETE FROM products");
    console.log("🗑️ Cleared existing products from table.");

    const insertStmt = db.prepare(`
      INSERT INTO products (
        category, subcategory, original_quantity, current_quantity, 
        wholesale_price, retail_price, wholesale_total_price, retail_total_price,
        product_code, barcode_value 
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const item of items) {
      const category = item.category || null;
      const subcategory = item.subcategory || null;
      
      let initial_quantity = parseInt(item.original_quantity, 10);
      if (isNaN(initial_quantity) || initial_quantity < 0) {
        console.warn(`⚠️ Invalid quantity '${item.original_quantity}' for item, defaulting to 0. Item:`, item);
        initial_quantity = 0;
      }

      let wholesale_price = parseFloat(item.wholesale_price);
      if (isNaN(wholesale_price) || wholesale_price < 0) {
        console.warn(`⚠️ Invalid wholesale_price '${item.wholesale_price}' for item, defaulting to 0.0. Item:`, item);
        wholesale_price = 0.0;
      }
      
      let retail_price = parseFloat(item.retail_price);
      if (isNaN(retail_price) || retail_price < 0 || item.retail_price === undefined || String(item.retail_price).trim() === '') {
        retail_price = wholesale_price;
      }

      const wholesale_total_price = initial_quantity * wholesale_price;
      const retail_total_price = initial_quantity * retail_price;

      // Generate product_code and barcode_value similarly to server.js or leave them null/empty if not in sheet
      // For simplicity, this example will set them to null if not directly in the sheet.
      // A more robust solution would involve the same ID generation logic as in server.js if needed.
      const product_code_from_sheet = item.product_code || null; 
      const barcode_value_from_sheet = item.barcode_value || product_code_from_sheet; // Default barcode to product_code if not specified

      if (item.original_quantity === undefined) console.warn(`⚠️ Item missing 'original_quantity' property:`, item);
      if (item.wholesale_price === undefined) console.warn(`⚠️ Item missing 'wholesale_price' property:`, item);

      insertStmt.run(
        category, subcategory, initial_quantity, initial_quantity, 
        wholesale_price, retail_price, wholesale_total_price, retail_total_price,
        product_code_from_sheet, barcode_value_from_sheet
      );
    }
    
    console.log("✔️ Items inserted.");

    db.exec("COMMIT");
    console.log("✅ Import complete. Transaction committed.");

  } catch (error) {
    console.error("❌ Error during database import process:", error.message);
    if (db) {
      try {
        db.exec("ROLLBACK");
        console.log("↩️ Transaction rolled back due to error.");
      } catch (rollbackError) {
        console.error("❌ Error rolling back transaction:", rollbackError.message);
      }
    }
    throw error; 
  } finally {
    if (db) {
      db.close();
      console.log("🚪 Database connection closed.");
    }
  }
}

importToDB()
  .then(() => console.log("🚀 Script finished successfully."))
  .catch(err => {
    console.error("💥 Unrecoverable error in import script:", err.message);
    process.exitCode = 1;
  });
