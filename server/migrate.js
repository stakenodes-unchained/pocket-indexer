const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
require('dotenv').config();

const migrationsDir = path.join(__dirname, 'migrations');

const client = new Client({
  host: process.env.DB_HOST || '127.0.0.1',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASS || 'somestringpassword',
  database: process.env.DB_NAME || 'pocket_indexer',
});

async function runMigrations() {
  try {
    await client.connect();
    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();
    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      console.log(`Running migration: ${file}`);
      await client.query(sql);
      console.log(`Migration ${file} complete.`);
    }
    console.log('All migrations complete.');
  } catch (err) {
    console.error('Migration error:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigrations(); 