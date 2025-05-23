// scripts/importFromSheet.js
const sqlite3 = require('sqlite3').verbose();
const fetch = (...args) => import('node-fetch').then(mod => mod.default(...args));

// IMPORTANT: Store sensitive information like API keys in environment variables
// or a secure configuration management system, not directly in code.
// Example: const API_KEY = process.env.GOOGLE_SHEETS_API_KEY;
const CONFIG = {
  SPREADSHEET_ID: '1Gk8K76m_LpIPgd5nZ-SB5ZWx2mJ4gRCgE3tOyC4Z78o', // Consider making this configurable too
  SHEET_NAME: 'inventory', // And this
  API_KEY: 'AIzaSyCsBBcFZHbFQBD22Rz9ISHwfWHfDm989pM' // <<< CRITICAL SECURITY RISK: Hardcoded API Key. Use environment variables.
};

const DB_PATH = './inventory.db'; // Updated DB path to match server.js

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
        // Ensure key is a string, trim it, convert to lowercase, and replace spaces with underscores
        let processedKey = String(key || '').trim().toLowerCase();
        processedKey = processedKey.replace(/\s+/g, '_'); // e.g., "wholesale price" becomes "wholesale_price"
        if (processedKey) {
          obj[processedKey] = row[i] !== undefined && row[i] !== null ? String(row[i]).trim() : '';
        }
      });
      return obj;
    });
  } catch (error) {
    console.error("❌ Error fetching or parsing sheet data:", error);
    throw error; // Re-throw to be caught by the caller
  }
}

async function importToDB() {
  let db; // Declare db here to be accessible in finally
  try {
    db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) {
        console.error("❌ Could not connect to database:", err.message);
        throw err; // Propagate error
      }
      console.log("🗄️ Connected to the SQLite database.");
    });

    const items = await fetchSheetData();
    if (!items || items.length === 0) {
      console.log("ℹ️ No items to import.");
      return; // Exit if no items
    }
    console.log(`📥 Importing ${items.length} items...`);

    // Promisify db operations for cleaner async/await usage
    const run = (sql, params = []) => new Promise((resolve, reject) => {
      db.run(sql, params, function(err) { // Use function for `this`
        if (err) reject(err);
        else resolve(this);
      });
    });

    const prepare = (sql) => new Promise((resolve, reject) => {
        const stmt = db.prepare(sql, (err) => {
            if (err) reject(err);
            else resolve(stmt);
        });
    });

    await run(`
      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT,
        subcategory TEXT,
        quantity INTEGER NOT NULL,
        wholesale_price REAL NOT NULL,
        retail_price REAL,
        wholesale_total_price REAL,
        retail_total_price REAL
      )
    `);
    console.log("✔️ Table 'products' ensured (schema updated for wholesale/retail).");

    await run("BEGIN TRANSACTION");
    console.log("🔄 Started transaction.");

    await run("DELETE FROM products");
    console.log("🗑️ Cleared existing products from table.");

    const insertStmt = await prepare(`
      INSERT INTO products (category, subcategory, quantity, wholesale_price, retail_price, wholesale_total_price, retail_total_price)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    // Assumes sheet headers: 'category', 'subcategory', 'quantity', 'wholesale_price'
    // Optional sheet header: 'retail_price' (defaults to wholesale_price if missing)
    // total prices are calculated.

    for (const item of items) {
      const category = item.category || null;
      const subcategory = item.subcategory || null;
      
      let quantity = parseInt(item.quantity, 10);
      if (isNaN(quantity) || quantity < 0) {
        console.warn(`⚠️ Invalid quantity '${item.quantity}' for item, defaulting to 0. Item:`, item);
        quantity = 0;
      }

      let wholesale_price = parseFloat(item.wholesale_price);
      if (isNaN(wholesale_price) || wholesale_price < 0) {
        console.warn(`⚠️ Invalid wholesale_price '${item.wholesale_price}' for item, defaulting to 0.0. Item:`, item);
        wholesale_price = 0.0;
      }
      
      let retail_price = parseFloat(item.retail_price);
      if (isNaN(retail_price) || retail_price < 0) {
        // If retail_price is not in sheet or invalid, default to wholesale_price
        retail_price = wholesale_price;
      }

      const wholesale_total_price = quantity * wholesale_price;
      const retail_total_price = quantity * retail_price;

      // Ensure required sheet columns are present
      if (item.quantity === undefined) console.warn(`⚠️ Item missing 'quantity' property:`, item);
      if (item.wholesale_price === undefined) console.warn(`⚠️ Item missing 'wholesale_price' property:`, item);


      await new Promise((resolve, reject) => {
        insertStmt.run(category, subcategory, quantity, wholesale_price, retail_price, wholesale_total_price, retail_total_price, function(err) {
          if (err) reject(err);
          else resolve();
        });
      });
    }
    
    await new Promise((resolve, reject) => {
        insertStmt.finalize((err) => {
            if (err) reject(err);
            else resolve();
        });
    });
    console.log("✔️ Items inserted.");

    await run("COMMIT");
    console.log("✅ Import complete. Transaction committed.");

  } catch (error) {
    console.error("❌ Error during database import process:", error.message);
    if (db) {
      // Attempt to rollback if an error occurred during the transaction
      try {
        await new Promise((resolve, reject) => {
            db.run("ROLLBACK", (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        console.log("↩️ Transaction rolled back due to error.");
      } catch (rollbackError) {
        console.error("❌ Error rolling back transaction:", rollbackError.message);
      }
    }
    throw error; // Re-throw to be caught by the final .catch
  } finally {
    if (db) {
      db.close((err) => {
        if (err) {
          console.error("❌ Error closing database:", err.message);
        } else {
          console.log("🚪 Database connection closed.");
        }
      });
    }
  }
}

importToDB()
  .then(() => console.log("🚀 Script finished successfully."))
  .catch(err => {
    // console.error is already done inside importToDB for specific errors
    // This final catch is for any unhandled promise rejections from importToDB
    console.error("💥 Unrecoverable error in import script:", err.message);
    process.exitCode = 1; // Indicate failure
  });
