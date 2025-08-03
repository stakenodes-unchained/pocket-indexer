const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
  host: process.env.DB_HOST || '127.0.0.1',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASS || 'somestringpassword',
  database: process.env.DB_NAME || 'pocket_indexer',
});

async function resetDatabaseOnly() {
  try {
    console.log('Connecting to database...');
    await client.connect();
    
    console.log('Dropping all tables...');
    
    // Drop all tables in the correct order (respecting foreign key constraints)
    const dropTables = [
      'DROP TABLE IF EXISTS claims CASCADE',
      'DROP TABLE IF EXISTS governance CASCADE',
      'DROP TABLE IF EXISTS relays CASCADE',
      'DROP TABLE IF EXISTS staking CASCADE',
      'DROP TABLE IF EXISTS services CASCADE',
      'DROP TABLE IF EXISTS nodes CASCADE',
      'DROP TABLE IF EXISTS applications CASCADE',
      'DROP TABLE IF EXISTS suppliers CASCADE',
      'DROP TABLE IF EXISTS transactions CASCADE',
      'DROP TABLE IF EXISTS blocks CASCADE',
    ];

    for (const dropQuery of dropTables) {
      console.log(`Executing: ${dropQuery}`);
      await client.query(dropQuery);
    }

    console.log('All tables dropped successfully.');
    
    console.log('Running migrations to recreate tables...');
    
    // Run the migration script to recreate all tables
    const fs = require('fs');
    const path = require('path');
    const migrationsDir = path.join(__dirname, 'migrations');
    
    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();
      
    for (const file of files) {
      console.log(`Running migration: ${file}`);
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      await client.query(sql);
      console.log(`Migration ${file} complete.`);
    }

    console.log('✅ Database reset complete!');
    console.log('All database tables have been dropped and recreated.');
    console.log('Redis data was not touched.');
    
  } catch (err) {
    console.error('Database reset error:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

// Run the reset if this script is executed directly
if (require.main === module) {
  resetDatabaseOnly();
}

module.exports = {
  resetDatabaseOnly
}; 