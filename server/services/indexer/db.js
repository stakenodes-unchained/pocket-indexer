const { Client } = require('pg');
const Redis = require('ioredis');
const { fetchTransactionByHash } = require('./rpc');
const { extractTransactionDetails, hashTx } = require('./transformer');
const { classifyTransaction, parseClaims } = require('./entityParser');
require('dotenv').config();

const PAGE_SIZE = parseInt(process.env.PAGE_SIZE || '50', 10);

// PostgreSQL client
const pgClient = new Client({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
});

// Redis client
const redis = new Redis(process.env.REDIS_URL);

async function connectClients() {
  if (!pgClient._connected) {
    await pgClient.connect();
    pgClient._connected = true;
  }
  if (!redis.status || redis.status !== 'ready') {
    await redis.connect();
  }
}

/**
 * Save a block and its transactions to the database and cache
 * @param {any} blockData - The transformed block data
 */
async function saveBlock(blockData, chain, rpcUrl = process.env.RPC_URL) {
  await connectClients();
  const client = pgClient;

  // Extract block information from the new format
  const blockId = blockData.block_id?.hash || blockData.block?.header?.hash;
  const height = parseInt(blockData.block?.header?.height || blockData.sdk_block?.header?.height, 10);
  const hash = blockData.block?.header?.hash || blockData.sdk_block?.header?.hash;
  const timestamp = blockData.block?.header?.time || blockData.sdk_block?.header?.time;
  const proposer = blockData.block?.header?.proposer_address || blockData.sdk_block?.header?.proposer_address;

  // Extract transactions from the block data
  const rawTxs = blockData.block?.data?.txs || blockData.sdk_block?.data?.txs || [];

  // Save block in DB
  await client.query(
    `INSERT INTO blocks (id, height, hash, timestamp, proposer)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO NOTHING`,
    [blockId, height, hash, timestamp, proposer]
  );

  // Process and save transactions
  const processedTxs = [];
  for (const rawTx of rawTxs) {
    try {
      // Get transaction hash from raw transaction
      const txHash = hashTx(rawTx);

      // Try to fetch full transaction details from RPC
      let tx = {
        hash: txHash,
        sender: '',
        recipient: '',
        amount: '0',
        fee: '0',
        memo: '',
        type: 'unknown',
        status: 'pending',
        timestamp: timestamp,
        messages: []
      };

      try {
        // Get RPC URL for this chain
        if (rpcUrl) {
          const txResponse = await fetchTransactionByHash(txHash, rpcUrl);

          const txType = classifyTransaction(txResponse.tx);

          const rpcDetails = extractTransactionDetails(txResponse, timestamp);
          // Use RPC details to populate transaction info
          tx = {
            hash: rpcDetails.hash || txHash,
            sender: rpcDetails.sender || '',
            recipient: rpcDetails.recipient || '',
            amount: rpcDetails.amount || '0',
            fee: rpcDetails.fee?.amount?.[0]?.amount || '0',
            memo: rpcDetails.memo || '',
            type: rpcDetails.type || 'unknown',
            status: rpcDetails.status || 'pending',
            timestamp: rpcDetails.timestamp || timestamp,
            messages: rpcDetails.messages || [],
            gas_wanted: rpcDetails.gas_wanted || '0',
            gas_used: rpcDetails.gas_used || '0',
            tx_data: JSON.stringify(txResponse)
          };
          // Save transaction with classification
          await saveTransaction({
            ...tx,
            type: txType,
            block_height: blockId,
            timestamp: blockData.block?.header?.time || blockData.timestamp,
            chain: chain
          });

          processedTxs.push({
            ...tx,
            type: txType,
            block_height: blockId,
            timestamp: blockData.block?.header?.time || blockData.timestamp,
            chain: chain
          });

          // Cache transaction in Redis
          await redis.hset(`tx:${chain}:${txHash}`, {
            hash: tx.hash,
            height: height.toString(),
            sender: tx.sender,
            recipient: tx.recipient,
            amount: tx.amount,
            fee: typeof tx.fee === 'object' ? JSON.stringify(tx.fee) : tx.fee,
            memo: tx.memo,
            type: tx.type,
            status: tx.status,
            timestamp: tx.timestamp,
            messages: tx.messages ? JSON.stringify(tx.messages) : '[]',
            gas_wanted: tx.gas_wanted || '0',
            gas_used: tx.gas_used || '0',
            tx_data: tx.tx_data || ''
          });

          // Add to sorted set for pagination
          await redis.zadd(`chain:${chain}:txs`, height, txHash);

          // Parse and save claims if this is a proof transaction
          if (txType === 'proof') {
            const claims = parseClaims(txResponse.tx, blockData);
            for (const claim of claims) {
              await saveClaim(claim);
            }
          }
        }
      } catch (error) {
        console.log("================", error);
        console.warn(`Failed to fetch transaction details for ${txHash}:`, error.message);
      }


    } catch (error) {
      console.error(`Error processing transaction in block ${height}:`, error);
    }
  }

  // Prepare block data for caching
  const blockForCache = {
    height,
    hash,
    timestamp,
    proposer,
    transactions: processedTxs
  };

  // Cache block in Redis (list: recent:blocks)
  await redis.lpush('recent:blocks', JSON.stringify(blockForCache));
  await redis.ltrim('recent:blocks', 0, PAGE_SIZE - 1);

  // Cache transactions in Redis (list: recent:txs)
  for (const tx of processedTxs) {
    await redis.lpush('recent:txs', JSON.stringify(tx));
  }
  await redis.ltrim('recent:txs', 0, PAGE_SIZE - 1);

  // Update latest processed height
  await redis.set(`chain:${chain}:latest_height`, height.toString());
  return blockForCache
}

/**
 * Save a transaction to the database
 */
async function saveTransaction(tx) {
  await connectClients();
  await pgClient.query(
    `INSERT INTO transactions (id, hash, block_id, sender, recipient, amount, fee, memo, type, status, timestamp, tx_data, chain)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (id) DO UPDATE SET
       type=EXCLUDED.type,
       status=EXCLUDED.status,
       tx_data=EXCLUDED.tx_data,
       chain=EXCLUDED.chain`,
    [
      tx.hash,
      tx.hash,
      tx.block_height,
      tx.sender,
      tx.recipient,
      tx.amount,
      tx.fee,
      tx.memo,
      tx.type,
      tx.status,
      tx.timestamp,
      tx.tx_data || null,
      tx.chain || null
    ]
  );
}

/**
 * Save a relay proof
 */
async function saveRelay(relay) {
  await connectClients();
  await pgClient.query(
    `INSERT INTO relays (supplier_address, application_address, session_id, chain, proof, timestamp)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      relay.supplier_address,
      relay.application_address,
      relay.session_id,
      relay.chain,
      relay.proof,
      relay.timestamp,
    ]
  );
}

/**
 * Save a governance action
 */
async function saveGovernance(gov) {
  await connectClients();
  await pgClient.query(
    `INSERT INTO governance (proposer, proposal_id, proposal_type, status, timestamp)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (proposal_id) DO UPDATE SET
       status=EXCLUDED.status`,
    [
      gov.proposer,
      gov.proposal_id,
      gov.proposal_type,
      gov.status,
      gov.timestamp,
    ]
  );
}

/**
 * Save a claim
 */
async function saveClaim(claim) {
  await connectClients();
  await pgClient.query(
    `INSERT INTO claims (supplier_operator_address, application_address, service_id, session_id, session_start_block_height, session_end_block_height, root_hash, proof, status, timestamp)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (supplier_operator_address, session_id, service_id, application_address) DO UPDATE SET
       root_hash=EXCLUDED.root_hash,
       proof=EXCLUDED.proof,
       status=EXCLUDED.status,
       timestamp=EXCLUDED.timestamp`,
    [
      claim.supplier_operator_address,
      claim.application_address,
      claim.service_id,
      claim.session_id,
      claim.session_start_block_height,
      claim.session_end_block_height,
      claim.root_hash,
      claim.proof,
      claim.status,
      claim.timestamp,
    ]
  );
}

/**
 * Get the last processed block height from the database
 * @returns {Promise<number>}
 */
async function getLastProcessedHeight() {
  await connectClients();
  const res = await pgClient.query('SELECT MAX(height) as max FROM blocks');
  return res.rows[0].max ? parseInt(res.rows[0].max, 10) : 0;
}

/**
 * Get a block by height (cache first)
 */
async function getBlock(height) {
  await connectClients();
  // Check Redis cache
  const cachedBlocks = await redis.lrange('recent:blocks', 0, PAGE_SIZE - 1);
  for (const b of cachedBlocks) {
    const block = JSON.parse(b);
    if (block.height === height) return block;
  }
  // Fallback to DB
  const res = await pgClient.query('SELECT * FROM blocks WHERE height = $1', [height]);
  return res.rows[0] || null;
}

/**
 * Get a transaction by hash (cache first)
 */
async function getTransaction(hash) {
  await connectClients();
  // Check Redis cache
  const cachedTxs = await redis.lrange('recent:txs', 0, PAGE_SIZE - 1);
  for (const t of cachedTxs) {
    const tx = JSON.parse(t);
    if (tx.hash === hash) return tx;
  }
  // Fallback to DB
  const res = await pgClient.query('SELECT * FROM transactions WHERE hash = $1', [hash]);
  return res.rows[0] || null;
}

/**
 * Upsert a supplier (node operator)
 */
async function upsertSupplier(supplier) {
  await connectClients();
  await pgClient.query(
    `INSERT INTO suppliers (address, public_key, staked_amount, status, service_url, last_seen, geo)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (address) DO UPDATE SET
       public_key=EXCLUDED.public_key,
       staked_amount=EXCLUDED.staked_amount,
       status=EXCLUDED.status,
       service_url=EXCLUDED.service_url,
       last_seen=EXCLUDED.last_seen,
       geo=EXCLUDED.geo`,
    [
      supplier.address,
      supplier.public_key,
      supplier.staked_amount,
      supplier.status,
      supplier.service_url,
      supplier.last_seen,
      supplier.geo,
    ]
  );
}

/**
 * Upsert an application
 */
async function upsertApplication(app) {
  await connectClients();
  await pgClient.query(
    `INSERT INTO applications (address, public_key, staked_amount, status, chains, last_seen)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (address) DO UPDATE SET
       public_key=EXCLUDED.public_key,
       staked_amount=EXCLUDED.staked_amount,
       status=EXCLUDED.status,
       chains=EXCLUDED.chains,
       last_seen=EXCLUDED.last_seen`,
    [
      app.address,
      app.public_key,
      app.staked_amount,
      app.status,
      app.chains,
      app.last_seen,
    ]
  );
}

/**
 * Insert a staking event
 */
async function insertStakingEvent(event) {
  await connectClients();
  await pgClient.query(
    `INSERT INTO staking (address, type, amount, event, timestamp)
     VALUES ($1,$2,$3,$4,$5)`,
    [
      event.address,
      event.type,
      event.amount,
      event.event,
      event.timestamp,
    ]
  );
}

/**
 * Upsert a service
 */
async function upsertService(service) {
  await connectClients();
  await pgClient.query(
    `INSERT INTO services (supplier_address, chain, service_url, status, last_checked)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (supplier_address, chain) DO UPDATE SET
       service_url=EXCLUDED.service_url,
       status=EXCLUDED.status,
       last_checked=EXCLUDED.last_checked`,
    [
      service.supplier_address,
      service.chain,
      service.service_url,
      service.status,
      service.last_checked,
    ]
  );
}

/**
 * Upsert a node
 */
async function upsertNode(node) {
  await connectClients();
  await pgClient.query(
    `INSERT INTO nodes (address, public_key, status, geo, last_seen, service_url)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (address) DO UPDATE SET
       public_key=EXCLUDED.public_key,
       status=EXCLUDED.status,
       geo=EXCLUDED.geo,
       last_seen=EXCLUDED.last_seen,
       service_url=EXCLUDED.service_url`,
    [
      node.address,
      node.public_key,
      node.status,
      node.geo,
      node.last_seen,
      node.service_url,
    ]
  );
}

module.exports = {
  saveBlock,
  saveTransaction,
  getLastProcessedHeight,
  getBlock,
  getTransaction,
  PAGE_SIZE,
  upsertSupplier,
  upsertApplication,
  insertStakingEvent,
  upsertService,
  upsertNode,
  saveRelay,
  saveGovernance,
  saveClaim,
}; 