const { Pool } = require('pg');
const { registerPoolIdleErrorHandler } = require('./pgPoolIdleError');

function poolConfig(prefix) {
  return {
    host: process.env[`${prefix}_HOST`] || process.env.DB_HOST,
    port: process.env[`${prefix}_PORT`] || process.env.DB_PORT,
    user: process.env[`${prefix}_USER`] || process.env.DB_USER,
    password: process.env[`${prefix}_PASS`] || process.env.DB_PASS,
    database: process.env[`${prefix}_NAME`] || process.env.DB_NAME,
    max: parseInt(process.env.DB_POOL_SIZE || '10', 10),
    min: parseInt(process.env.DB_POOL_MIN || '2', 10),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    statement_timeout: 120000,
  };
}

const readPool = new Pool(poolConfig('DB_READ'));
const writePool = new Pool(poolConfig('DB_WRITE'));

registerPoolIdleErrorHandler(readPool, 'read');
registerPoolIdleErrorHandler(writePool, 'write');

async function getReadClient() {
  return readPool.connect();
}

async function getWriteClient() {
  return writePool.connect();
}

module.exports = {
  getReadPool: () => readPool,
  getWritePool: () => writePool,
  getReadClient,
  getWriteClient,
};
