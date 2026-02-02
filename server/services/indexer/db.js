const { Pool } = require('pg');
const Redis = require('ioredis');
const { fetchTransactionByHash } = require('./rpc');
const { extractTransactionDetails, hashTx } = require('./transformer');
const { classifyTransaction, parseClaims } = require('./entityParser');
require('dotenv').config();
const configLoader = require('../configLoader');

const PAGE_SIZE = configLoader.get('PAGE_SIZE', 50);
const REDIS_CACHE_TX_DETAIL = (process.env.REDIS_CACHE_TX_DETAIL || 'false') === 'true';
const REDIS_TX_TTL_SEC = parseInt(process.env.REDIS_TX_TTL_SEC || '0', 10); // 0 = no TTL
const REDIS_RECENT_TTL_SEC = parseInt(process.env.REDIS_RECENT_TTL_SEC || '0', 10); // 0 = no TTL
const REDIS_INDEX_TXS = (process.env.REDIS_INDEX_TXS || 'false') === 'true';

// PostgreSQL connection pool (shared across worker thread operations)
// Using pool instead of single client to reduce memory overhead and enable connection reuse
// Calculate adaptive pool size based on number of workers to prevent connection exhaustion
const blockResultsWorkerCount = configLoader.get('BLOCK_RESULTS_WORKER_COUNT', 2);
const basePoolSize = parseInt(process.env.DB_POOL_SIZE || '10', 10);
// When multiple block results workers are used, reduce pool size per worker to prevent exhaustion
// Formula: basePoolSize / (1 + blockResultsWorkerCount / 2) with minimum of 3
// This ensures total connections across all workers stays reasonable
const adaptivePoolSize = blockResultsWorkerCount > 1
  ? Math.max(3, Math.floor(basePoolSize / (1 + blockResultsWorkerCount / 2)))
  : basePoolSize;
const minConnections = blockResultsWorkerCount > 1 ? 1 : 2; // Reduce min connections when multiple workers

const pgPool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  max: adaptivePoolSize, // Adaptive pool size based on worker count
  min: minConnections, // Reduced min connections when multiple workers
  idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
  connectionTimeoutMillis: 60000, // Increased to 60 seconds to handle connection delays
  statement_timeout: 120000, // 120 second query timeout
});

// Log pool configuration for debugging (only in worker threads, not main process)
if (typeof process.env.WORKER_ID !== 'undefined' || process.env.NODE_ENV === 'development') {
  console.log(`[DB Pool] Configured with max=${adaptivePoolSize}, min=${minConnections} (blockResultsWorkerCount=${blockResultsWorkerCount})`);
}

// Handle pool errors
pgPool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client', err);
});

// Redis client
const redis = new Redis(process.env.REDIS_URL);

let redisConnectingPromise = null;

async function connectClients() {
  
  // Redis: guard concurrent connects
  if (!redis.status || redis.status !== 'ready') {
    if (!redisConnectingPromise) {
      redisConnectingPromise = (async () => {
        if (!redis.status || redis.status !== 'ready') {
          try { await redis.connect(); } catch (_) { }
        }
        redisConnectingPromise = null;
      })();
    }
    await redisConnectingPromise;
  }
}

/**
 * Save a block and its transactions to the database and cache
 * @param {any} blockData - The transformed block data
 */
async function saveBlock(blockData, chain, rpcUrl = process.env.RPC_URL) {
  await connectClients();

  const blockHeight = parseInt(blockData.block?.header?.height, 10);
  const lockKey = `block_lock:${chain}:${blockHeight}`;
  const lockValue = `${process.pid}:${Date.now()}`;
  const lockTimeout = 300; // 5 minutes timeout

  // Try to acquire a distributed lock for this block
  const lockAcquired = await redis.set(lockKey, lockValue, 'EX', lockTimeout, 'NX');

  if (!lockAcquired) {
    console.log(`Block ${blockHeight} for chain ${chain} is already being processed by another worker, skipping...`);
    return null; // Block is being processed by another worker
  }

  try {
    // Use pool instead of single client - pool manages connections automatically
    const client = pgPool;

    // Extract block information from the new format
    const blockId = blockData.block_id?.hash || blockData.block?.header?.hash;
    const height = parseInt(blockData.block?.header?.height || blockData.sdk_block?.header?.height, 10);
    const hash = blockData.block_id?.hash || blockData.block?.header?.hash;
    const timestamp = blockData.block?.header?.time || blockData.sdk_block?.header?.time;
    const proposer = blockData.block?.header?.proposer_address || blockData.sdk_block?.header?.proposer_address;

    // Create a unique block ID per chain to avoid primary key conflicts
    const uniqueBlockId = `${chain}:${blockId}`;

    // Extract transactions from the block data
    const rawTxs = blockData.block?.data?.txs || blockData.sdk_block?.data?.txs || [];

    // Calculate raw block size in bytes (serialized block size as received over the wire)
    // Serialize the block data to JSON once and reuse for both size calculation and storage
    // This avoids double stringification which can cause memory issues with large blocks
    const blockJson = JSON.stringify(blockData);
    const rawBlockSize = Buffer.byteLength(blockJson, 'utf8');

    // Calculate block production time (time difference between current and previous block)
    // Get the previous block's timestamp to calculate the time difference
    let blockProductionTime = null;
    if (height > 1) {
      try {
        const prevBlockRes = await client.query(
          'SELECT timestamp FROM blocks WHERE chain = $1 AND height = $2',
          [chain, height - 1]
        );
        if (prevBlockRes.rows.length > 0) {
          const prevTimestamp = new Date(prevBlockRes.rows[0].timestamp);
          const currentTimestamp = new Date(timestamp);
          // Calculate difference in seconds with millisecond precision
          blockProductionTime = (currentTimestamp.getTime() - prevTimestamp.getTime()) / 1000;
        }
      } catch (error) {
        // If we can't get previous block, that's okay - production time will be null
        console.warn(`Could not calculate block production time for block ${height}:`, error.message);
      }
    }

    // Save block in DB with conflict handling (update metadata on conflict)
    // Always process blocks to ensure all transactions are captured, even if block exists
    // Store complete block data as JSONB for efficient querying without additional RPC calls
    let persistedBlockId = uniqueBlockId;
    try {
      const result = await client.query(
        `INSERT INTO blocks (id, height, hash, timestamp, proposer, chain, raw_block_size, block_production_time, block_data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (chain, height) DO UPDATE SET
         hash = EXCLUDED.hash,
         timestamp = EXCLUDED.timestamp,
         proposer = EXCLUDED.proposer,
         raw_block_size = EXCLUDED.raw_block_size,
         block_production_time = EXCLUDED.block_production_time,
         block_data = EXCLUDED.block_data
       RETURNING id`,
        [uniqueBlockId, height, hash, timestamp, proposer, chain, rawBlockSize, blockProductionTime, blockJson]
      );
      // Use the returned id (inserted or existing)
      persistedBlockId = result.rows[0]?.id || uniqueBlockId;
      
      // Clear blockJson after use to help garbage collection (large string can consume memory)
      // Note: blockJson is a const, but clearing the reference helps GC
      // The string will be garbage collected when no longer referenced
    } catch (error) {
      // Handle unique constraint violations for primary key (different from chain+height)
      if (error.code === '23505') {
        if (error.constraint === 'blocks_pkey') {
          // Block ID conflict - try to get existing block ID
          console.log(`Block ${uniqueBlockId} already exists (primary key conflict), continuing with transaction processing...`);
          const existingRes = await client.query(
            'SELECT id FROM blocks WHERE id = $1',
            [uniqueBlockId]
          );
          if (existingRes.rows.length > 0) {
            persistedBlockId = existingRes.rows[0].id;
          }
        } else if (error.constraint === 'blocks_height_key') {
          // Old unique constraint on height alone (should be removed in favor of chain+height)
          // This can happen if migration hasn't run yet - handle gracefully
          const existingRes = await client.query(
            'SELECT id FROM blocks WHERE chain = $1 AND height = $2',
            [chain, height]
          );
          if (existingRes.rows.length > 0) {
            persistedBlockId = existingRes.rows[0].id;
          } else {
            // Height exists for different chain - query by height and chain
            const heightRes = await client.query(
              'SELECT id FROM blocks WHERE height = $1 ORDER BY chain = $2 DESC LIMIT 1',
              [height, chain]
            );
            if (heightRes.rows.length > 0) {
              persistedBlockId = heightRes.rows[0].id;
            }
          }
        } else if (error.constraint === 'blocks_chain_height_key') {
          // Composite constraint on (chain, height) - ON CONFLICT should have handled this
          // But if we get here, just get the existing block
          const existingRes = await client.query(
            'SELECT id FROM blocks WHERE chain = $1 AND height = $2',
            [chain, height]
          );
          if (existingRes.rows.length > 0) {
            persistedBlockId = existingRes.rows[0].id;
          }
        } else {
          // For other constraint conflicts, log and continue
          console.warn(`Constraint violation: ${error.constraint}, continuing with transaction processing...`);
          const existingRes = await client.query(
            'SELECT id FROM blocks WHERE chain = $1 AND height = $2',
            [chain, height]
          );
          if (existingRes.rows.length > 0) {
            persistedBlockId = existingRes.rows[0].id;
          }
        }
      } else {
        throw error;
      }
    }

    // Process and save transactions
    const processedTxs = [];
    const rawResponseTxs = [];
    for (const rawTx of rawTxs) {
      try {
        // Get transaction hash from raw transaction
        const txHash = hashTx(rawTx);

        // Default transaction object with basic info
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
          messages: [],
          gas_wanted: '0',
          gas_used: '0',
          tx_data: null,
          block_height: height || null
        };

        let txResponse = null;
        let txType = 'unknown';

        try {
          // Get RPC URL for this chain
          if (rpcUrl) {
            // First check if transaction is already cached or in database
            let existingTx = await getTransaction(txHash);

            if (existingTx) {
              // Use existing transaction data
              tx = {
                hash: existingTx.hash,
                sender: existingTx.sender || '',
                recipient: existingTx.recipient || '',
                amount: existingTx.amount || '0',
                fee: existingTx.fee || '0',
                amount_denom: existingTx.amount_denom || null,
                fee_denom: existingTx.fee_denom || null,
                memo: existingTx.memo || '',
                type: existingTx.type || 'unknown',
                status: existingTx.status || 'pending',
                timestamp: existingTx.timestamp || timestamp,
                messages: existingTx.messages || [],
                gas_wanted: existingTx.gas_wanted || '0',
                gas_used: existingTx.gas_used || '0',
                tx_data: existingTx.tx_data || null,
                block_height: existingTx.block_height || height || null
              };
              txType = existingTx.type || 'unknown';
            } else {
              // Check if transaction is currently being fetched by another worker
              const txLockKey = `tx_fetch_lock:${txHash}`;
              const txLockValue = `${process.pid}:${Date.now()}`;
              const txLockAcquired = await redis.set(txLockKey, txLockValue, 'EX', 60, 'NX'); // 1 minute timeout

              if (!txLockAcquired) {
                console.log(`Transaction ${txHash} is already being fetched by another worker, skipping...`);
                // Use default transaction data
                txType = 'unknown';
              } else {
                try {
                  // Fetch from RPC only if not found in cache/database
                  txResponse = await fetchTransactionByHash(txHash, rpcUrl);
                  rawResponseTxs.push(txResponse);
                } finally {
                  // Release the transaction fetch lock
                  try {
                    await redis.del(txLockKey);
                  } catch (lockError) {
                    console.warn(`Failed to release tx fetch lock for ${txHash}:`, lockError.message);
                  }
                }
              }

              // Process transaction response if we have one
              if (txResponse) {
                // Safely classify transaction with error handling
                try {
                  txType = classifyTransaction(txResponse.tx);
                } catch (classificationError) {
                  console.warn(`Failed to classify transaction ${txHash}:`, classificationError.message);
                  txType = 'unknown';
                }

                const rpcDetails = extractTransactionDetails(txResponse, timestamp);
                // Use RPC details to populate transaction info
                tx = {
                  hash: rpcDetails.hash || txHash,
                  sender: rpcDetails.sender || '',
                  recipient: rpcDetails.recipient || '',
                  amount: rpcDetails.amount || '0',
                  fee: rpcDetails.fee_amount || rpcDetails.fee?.amount?.[0]?.amount || '0',
                  amount_denom: rpcDetails.amount_denom || null,
                  fee_denom: rpcDetails.fee_denom || null,
                  memo: rpcDetails.memo || '',
                  type: txType,
                  status: rpcDetails.status || 'pending',
                  timestamp: rpcDetails.timestamp || timestamp,
                  messages: rpcDetails.messages || [],
                  gas_wanted: rpcDetails.gas_wanted || '0',
                  gas_used: rpcDetails.gas_used || '0',
                  tx_data: JSON.stringify(txResponse),
                  block_height: rpcDetails.height || height || txResponse?.tx_response?.height || null
                };
              }
            }
          }
        } catch (rpcError) {
          console.warn(`Failed to fetch transaction details for ${txHash}:`, rpcError.message);
          // Keep the default transaction object - it will still be saved
        }

        // ALWAYS save the transaction, even if RPC failed or classification failed
        try {
          await saveTransaction({
            ...tx,
            type: txType,
            block_id: persistedBlockId,
            block_height: tx.block_height || height || null,
            timestamp: blockData.block?.header?.time || blockData.timestamp,
            chain: chain
          });

          processedTxs.push({
            ...tx,
            type: txType,
            block_id: persistedBlockId,
            timestamp: blockData.block?.header?.time || blockData.timestamp,
            chain: chain
          });

          // Cache transaction in Redis (optional & lightweight)
          try {
            if (REDIS_CACHE_TX_DETAIL) {
              const key = `tx:${chain}:${txHash}`;
              await redis.hset(key, {
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
                gas_wanted: tx.gas_wanted || '0',
                gas_used: tx.gas_used || '0'
              });
              if (REDIS_TX_TTL_SEC > 0) {
                await redis.expire(key, REDIS_TX_TTL_SEC);
              }
            }

            // Optional sorted index for pagination
            if (REDIS_INDEX_TXS) {
              await redis.zadd(`chain:${chain}:txs`, height, txHash);
            }
          } catch (cacheError) {
            console.warn(`Failed to cache transaction ${txHash}:`, cacheError.message);
            // Continue processing - caching failure shouldn't stop the process
          }

          // // Parse and save claims if this is a proof transaction and we have tx data
          // if (txType.includes('proof') && txResponse) {
          //   try {

          //     // Parse proof submissions for reward tracking
          //     const proofSubmissions = parseProofSubmissions(tx, blockData, chain);
          //     if (Array.isArray(proofSubmissions) && proofSubmissions.length) {
          //       proofSubmissionsBuffer.push(...proofSubmissions);
          //     }

          //     const claims = parseClaims(txResponse, blockData);
          //     for (const claim of claims) {
          //       await saveClaim(claim);
          //     }
          //   } catch (claimError) {
          //     console.warn(`Failed to parse claims for transaction ${txHash}:`, claimError.message);
          //     // Continue processing - claim parsing failure shouldn't stop the process
          //   }
          // }
        } catch (saveError) {
          console.error(`Failed to save transaction ${txHash} to database:`, saveError.message);
          // This is a critical error - log it but continue with other transactions
        }

      } catch (error) {
        console.error(`Error processing transaction in block ${height}:`, error);
        // Continue with next transaction - don't let one bad transaction stop the whole block
      }
    }

    // Flush buffered proof submissions in bulk for this block
    // try {
    //   if (proofSubmissionsBuffer.length) {
    //     await bulkSaveProofSubmissions(proofSubmissionsBuffer);
    //   }
    // } catch (e) {
    //   console.error(`Error bulk saving proof submissions:`, e.message);
    // }

    // Prepare lightweight data for caching (avoid huge payloads in Redis)
    const lightweightTxs = processedTxs.map(tx => ({
      hash: tx.hash,
      height: height,
      sender: tx.sender,
      recipient: tx.recipient,
      amount: tx.amount,
      fee: typeof tx.fee === 'object' ? tx.fee?.amount?.[0]?.amount || '0' : tx.fee,
      amount_denom: tx.amount_denom || null,
      fee_denom: tx.fee_denom || null,
      memo: tx.memo,
      type: tx.type,
      status: tx.status,
      timestamp: tx.timestamp,
    }));

    const blockForCache = {
      height,
      hash,
      timestamp,
      proposer,
      chain,
      transactions: lightweightTxs.map(t => ({
        hash: t.hash,
        type: t.type,
        status: t.status,
        timestamp: t.timestamp,
      })),
    };

    // Cache block in Redis (list: recent:blocks) with max len trim on push
    await redis.lpush('recent:blocks', JSON.stringify(blockForCache));
    await redis.ltrim('recent:blocks', 0, PAGE_SIZE - 1);
    if (REDIS_RECENT_TTL_SEC > 0) {
      await redis.expire('recent:blocks', REDIS_RECENT_TTL_SEC);
    }

    // Cache transactions in Redis (list: recent:txs) - lightweight only
    for (const tx of lightweightTxs) {
      await redis.lpush('recent:txs', JSON.stringify(tx));
    }
    await redis.ltrim('recent:txs', 0, PAGE_SIZE - 1);
    if (REDIS_RECENT_TTL_SEC > 0) {
      await redis.expire('recent:txs', REDIS_RECENT_TTL_SEC);
    }

    // Update latest processed height
    await redis.set(`chain:${chain}:latest_height`, height.toString());

    blockForCache.transactions = [...rawResponseTxs];
    return blockForCache;

  } catch (error) {
    console.error(`Error processing block ${blockHeight} for chain ${chain}:`, error.message);
    throw error;
  } finally {
    // Release the lock
    try {
      await redis.del(lockKey);
    } catch (lockError) {
      console.warn(`Failed to release lock for block ${blockHeight}:`, lockError.message);
    }
  }
}

/**
 * Save a transaction to the database
 */
async function saveTransaction(tx) {
  await connectClients();

  try {
    // Extract addresses from transaction data
    const { extractAllAddresses } = require('./addressExtractor');
    let addresses = null;
    
    try {
      if (tx.tx_data) {
        addresses = extractAllAddresses(tx, tx.tx_data);
        // Convert to array format for PostgreSQL (empty array if no addresses)
        addresses = addresses && addresses.length > 0 ? addresses : null;
      }
    } catch (extractError) {
      // Log but don't fail - addresses extraction is best effort
      console.warn(`Failed to extract addresses for transaction ${tx.hash}:`, extractError.message);
    }

    // Extract block_height from tx_data as fallback if not provided
    let blockHeight = tx.block_height;
    if (!blockHeight && tx.tx_data) {
      try {
        const txData = typeof tx.tx_data === 'string' ? JSON.parse(tx.tx_data) : tx.tx_data;
        if (txData?.tx_response?.height) {
          blockHeight = parseInt(txData.tx_response.height, 10);
        }
      } catch (parseError) {
        // Silently fail - block_height extraction from tx_data is best effort
      }
    }

    // Primary insert that expects a valid block_id referencing blocks(id)
    await pgPool.query(
      `INSERT INTO transactions (id, hash, block_id, block_height, sender, recipient, amount, fee, memo, type, status, timestamp, tx_data, chain, amount_denom, fee_denom, addresses)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       ON CONFLICT (id) DO UPDATE SET
         type=EXCLUDED.type,
         status=EXCLUDED.status,
         tx_data=EXCLUDED.tx_data,
         chain=EXCLUDED.chain,
         amount=EXCLUDED.amount,
         fee=EXCLUDED.fee,
         amount_denom=EXCLUDED.amount_denom,
         fee_denom=EXCLUDED.fee_denom,
         addresses=EXCLUDED.addresses,
         block_height=COALESCE(EXCLUDED.block_height, transactions.block_height)`,
      [
        tx.hash,
        tx.hash,
        tx.block_id || null,
        blockHeight || null,
        tx.sender,
        tx.recipient,
        parseFloat(tx.amount) || 0,
        parseFloat(tx.fee) || 0,
        tx.memo,
        tx.type,
        tx.status,
        tx.timestamp,
        tx.tx_data || null,
        tx.chain || null,
        tx.amount_denom || null,
        tx.fee_denom || null,
        addresses // PostgreSQL array parameter
      ]
    );
  } catch (error) {
    // If the only problem is a missing block row (foreign key violation),
    // fall back to saving the transaction with a NULL block_id so we don't lose data.
    if (error.code === '23503' && error.constraint === 'transactions_block_id_fkey') {
      console.warn(
        `Foreign key violation for transaction ${tx.hash} (block_id=${tx.block_id}). ` +
        'Block row is missing; saving transaction with NULL block_id instead.'
      );
      try {
        await pgPool.query(
          `INSERT INTO transactions (id, hash, block_id, block_height, sender, recipient, amount, fee, memo, type, status, timestamp, tx_data, chain, amount_denom, fee_denom, addresses)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
           ON CONFLICT (id) DO UPDATE SET
             type=EXCLUDED.type,
             status=EXCLUDED.status,
             tx_data=EXCLUDED.tx_data,
             chain=EXCLUDED.chain,
             amount=EXCLUDED.amount,
             fee=EXCLUDED.fee,
             amount_denom=EXCLUDED.amount_denom,
             fee_denom=EXCLUDED.fee_denom,
             addresses=EXCLUDED.addresses,
             block_height=COALESCE(EXCLUDED.block_height, transactions.block_height)`,
          [
            tx.hash,
            tx.hash,
            null, // drop the foreign-key reference if the block row is missing
            blockHeight || null,
            tx.sender,
            tx.recipient,
            parseFloat(tx.amount) || 0,
            parseFloat(tx.fee) || 0,
            tx.memo,
            tx.type,
            tx.status,
            tx.timestamp,
            tx.tx_data || null,
            tx.chain || null,
            tx.amount_denom || null,
            tx.fee_denom || null,
            addresses
          ]
        );
        return;
      } catch (fallbackError) {
        console.error('Fallback saveTransaction (NULL block_id) also failed:', {
          error: fallbackError.message,
          stack: fallbackError.stack,
          transaction_hash: tx.hash
        });
        // Re-throw the original error so upstream logs stay consistent
        throw error;
      }
    }

    console.error('Error in saveTransaction:', {
      error: error.message,
      stack: error.stack,
      transaction: {
        hash: tx.hash,
        amount: tx.amount,
        fee: tx.fee,
        amount_type: typeof tx.amount,
        fee_type: typeof tx.fee,
        block_id: tx.block_id,
        block_height: tx.block_height
      }
    });
    throw error;
  }
}

/**
 * Save a relay proof
 */
async function saveRelay(relay) {
  await connectClients();
  await pgPool.query(
    `INSERT INTO relays (supplier_address, application_address, session_id, chain, proof, timestamp)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (supplier_address, application_address, session_id, chain, timestamp) DO UPDATE SET
       proof = EXCLUDED.proof,
       timestamp = EXCLUDED.timestamp`,
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
  await pgPool.query(
    `INSERT INTO governance (proposer, proposal_id, proposal_type, status, timestamp)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (proposal_id, proposer, timestamp) DO UPDATE SET
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
  await pgPool.query(
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
      parseInt(claim.session_start_block_height) || 0,
      parseInt(claim.session_end_block_height) || 0,
      claim.root_hash,
      claim.proof,
      claim.status,
      claim.timestamp,
    ]
  );
}

/**
 * Bulk save claims with one statement per chunk for throughput
 */
async function bulkSaveClaims(claims) {
  await connectClients();
  if (!Array.isArray(claims) || claims.length === 0) return;
  const chunkSize = 500;
  for (let i = 0; i < claims.length; i += chunkSize) {
    const chunk = claims.slice(i, i + chunkSize);
    const values = [];
    const params = [];
    let p = 1;
    for (const c of chunk) {
      values.push(`($${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++})`);
      params.push(
        c.supplier_operator_address,
        c.application_address,
        c.service_id,
        c.session_id,
        parseInt(c.session_start_block_height) || 0,
        parseInt(c.session_end_block_height) || 0,
        c.root_hash,
        c.proof || null,
        c.status || 'claimed',
        c.timestamp || new Date().toISOString(),
        c.chain || null,
        c.claim_proof_status_int !== undefined ? c.claim_proof_status_int : null,
        c.claimed_upokt || null,
        c.num_claimed_compute_units !== undefined ? c.num_claimed_compute_units : null,
        c.num_estimated_compute_units !== undefined ? c.num_estimated_compute_units : null,
        c.num_relays !== undefined ? c.num_relays : null
      );
    }
    const sql = `INSERT INTO claims (supplier_operator_address, application_address, service_id, session_id, session_start_block_height, session_end_block_height, root_hash, proof, status, timestamp, chain, claim_proof_status_int, claimed_upokt, num_claimed_compute_units, num_estimated_compute_units, num_relays)
                 VALUES ${values.join(',')}
                 ON CONFLICT (supplier_operator_address, session_id, service_id, application_address) DO UPDATE SET
                   root_hash=EXCLUDED.root_hash,
                   proof=EXCLUDED.proof,
                   status=EXCLUDED.status,
                   timestamp=EXCLUDED.timestamp,
                   chain=EXCLUDED.chain,
                   claim_proof_status_int=EXCLUDED.claim_proof_status_int,
                   claimed_upokt=EXCLUDED.claimed_upokt,
                   num_claimed_compute_units=EXCLUDED.num_claimed_compute_units,
                   num_estimated_compute_units=EXCLUDED.num_estimated_compute_units,
                   num_relays=EXCLUDED.num_relays`;
    await pgPool.query(sql, params);
  }
}

/**
 * Save a proof submission
 */
async function saveProofSubmission(submission) {
  await connectClients();
  await pgPool.query(
    `INSERT INTO proof_submissions (
      transaction_hash, block_height, timestamp, chain, supplier_operator_address, 
      application_address, service_id, session_id, session_end_block_height,
      claim_proof_status_int, claimed_upokt, num_claimed_compute_units,
      num_estimated_compute_units, num_relays, msg_index
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
    ON CONFLICT (chain, transaction_hash, supplier_operator_address, application_address, service_id, session_id, msg_index) 
    DO UPDATE SET
      block_height=EXCLUDED.block_height,
      timestamp=EXCLUDED.timestamp,
      session_end_block_height=EXCLUDED.session_end_block_height,
      claim_proof_status_int=EXCLUDED.claim_proof_status_int,
      claimed_upokt=EXCLUDED.claimed_upokt,
      num_claimed_compute_units=EXCLUDED.num_claimed_compute_units,
      num_estimated_compute_units=EXCLUDED.num_estimated_compute_units,
      num_relays=EXCLUDED.num_relays`,
    [
      submission.transaction_hash,
      submission.block_height,
      submission.timestamp,
      submission.chain,
      submission.supplier_operator_address,
      submission.application_address,
      submission.service_id,
      submission.session_id,
      submission.session_end_block_height,
      submission.claim_proof_status_int,
      submission.claimed_upokt,
      submission.num_claimed_compute_units,
      submission.num_estimated_compute_units,
      submission.num_relays,
      submission.msg_index
    ]
  );
}

/**
 * Bulk save proof submissions with one statement per chunk for throughput
 */
async function bulkSaveProofSubmissions(submissions) {
  await connectClients();
  if (!Array.isArray(submissions) || submissions.length === 0) return;

  const chunkSize = 500;
  for (let i = 0; i < submissions.length; i += chunkSize) {
    const chunk = submissions.slice(i, i + chunkSize);
    const values = [];
    const params = [];
    let p = 1;

    for (const s of chunk) {
      values.push(`($${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++})`);
      params.push(
        s.transaction_hash,
        s.block_height,
        s.timestamp,
        s.chain,
        s.supplier_operator_address,
        s.application_address,
        s.service_id,
        s.session_id,
        s.session_end_block_height,
        s.claim_proof_status_int,
        s.claimed_upokt,
        s.num_claimed_compute_units,
        s.num_estimated_compute_units,
        s.num_relays,
        s.msg_index
      );
    }

    const sql = `INSERT INTO proof_submissions (
      transaction_hash, block_height, timestamp, chain, supplier_operator_address, 
      application_address, service_id, session_id, session_end_block_height,
      claim_proof_status_int, claimed_upokt, num_claimed_compute_units,
      num_estimated_compute_units, num_relays, msg_index
    )
    VALUES ${values.join(',')}
    ON CONFLICT (chain, transaction_hash, supplier_operator_address, application_address, service_id, session_id, msg_index)
    DO UPDATE SET
      block_height=EXCLUDED.block_height,
      timestamp=EXCLUDED.timestamp,
      session_end_block_height=EXCLUDED.session_end_block_height,
      claim_proof_status_int=EXCLUDED.claim_proof_status_int,
      claimed_upokt=EXCLUDED.claimed_upokt,
      num_claimed_compute_units=EXCLUDED.num_claimed_compute_units,
      num_estimated_compute_units=EXCLUDED.num_estimated_compute_units,
      num_relays=EXCLUDED.num_relays`;

    await pgPool.query(sql, params);
  }
}

/**
 * Get the last processed block height from the database for a specific chain
 * @param {string} chain Chain name
 * @returns {Promise<number>}
 */
async function getLastProcessedHeight(chain) {
  await connectClients();
  const res = await pgPool.query(
    'SELECT MAX(height) as max FROM blocks WHERE chain = $1',
    [chain]
  );
  return res.rows[0].max ? parseInt(res.rows[0].max, 10) : 0;
}

/**
 * Historical sync checkpoint helpers
 */
async function getHistoricalCheckpoint(chain) {
  await connectClients();
  const res = await pgPool.query('SELECT last_height FROM historical_sync WHERE chain = $1', [chain]);
  return res.rows[0]?.last_height ? parseInt(res.rows[0].last_height, 10) : 0;
}

async function setHistoricalCheckpoint(chain, height) {
  await connectClients();
  await pgPool.query(
    `INSERT INTO historical_sync (chain, last_height, updated_at)
     VALUES ($1,$2,NOW())
     ON CONFLICT (chain) DO UPDATE SET last_height = EXCLUDED.last_height, updated_at = NOW()`,
    [chain, height]
  );
}

/**
 * Upsert worker heartbeat (per-chain worker)
 */
async function upsertWorkerHeartbeat(workerId, meta) {
  await connectClients();
  await pgPool.query(
    `INSERT INTO worker_heartbeats (worker_id, last_seen, meta)
     VALUES ($1, NOW(), $2)
     ON CONFLICT (worker_id) DO UPDATE SET last_seen = NOW(), meta = $2`,
    [workerId, meta || {}]
  );
}

/**
 * Get latest processed_height from metrics_snapshots for a chain
 */
async function getSnapshotProcessedHeight(chain) {
  await connectClients();
  const res = await pgPool.query(
    `SELECT processed_height FROM metrics_snapshots
     WHERE chain = $1
     ORDER BY ts DESC
     LIMIT 1`,
    [chain]
  );
  const v = res.rows[0]?.processed_height;
  return v ? parseInt(v, 10) : 0;
}

/**
 * Find gaps in block sequence for a chain
 */
async function findGaps(chain, startHeight, endHeight, limit = 100) {
  await connectClients();

  // Ensure we have valid integer parameters
  const start = parseInt(startHeight, 10);
  const end = parseInt(endHeight, 10);

  // If no valid range, return empty array
  if (isNaN(start) || isNaN(end) || start > end) {
    return [];
  }

  const res = await pgPool.query(
    `WITH RECURSIVE height_sequence AS (
       SELECT $1::integer as height
       UNION ALL
       SELECT height + 1 FROM height_sequence WHERE height < $2::integer
     ),
     existing_heights AS (
       SELECT height FROM blocks WHERE chain = $3 AND height BETWEEN $1::integer AND $2::integer
     )
     SELECT hs.height as missing_height
     FROM height_sequence hs
     LEFT JOIN existing_heights eh ON hs.height = eh.height
     WHERE eh.height IS NULL
     ORDER BY hs.height
     LIMIT $4`,
    [start, end, chain, limit]
  );
  return res.rows.map(r => parseInt(r.missing_height, 10));
}

/**
 * Get the next gap to fill for historical sync
 */
async function getNextGapToFill(chain) {
  await connectClients();

  // Get historical checkpoint
  const histRes = await pgPool.query('SELECT last_height FROM historical_sync WHERE chain = $1', [chain]);
  const historical_checkpoint = histRes.rows[0]?.last_height ? parseInt(histRes.rows[0].last_height, 10) : 0;

  // Get monitoring height (highest processed block)
  const monitorRes = await pgPool.query('SELECT MAX(height) as max_height FROM blocks WHERE chain = $1', [chain]);
  const monitoring_height = monitorRes.rows[0]?.max_height ? parseInt(monitorRes.rows[0].max_height, 10) : 0;

  // If no blocks exist yet, return null (no gaps to fill)
  if (monitoring_height === 0) {
    return null;
  }

  // If historical checkpoint is at or beyond monitoring height, no gaps to fill
  if (historical_checkpoint >= monitoring_height) {
    return null;
  }

  // Find the first gap
  const gaps = await findGaps(chain, historical_checkpoint + 1, monitoring_height, 1);
  return gaps.length > 0 ? gaps[0] : null;
}

/**
 * Check if a specific height exists for a chain
 */
async function blockExists(chain, height) {
  await connectClients();
  const res = await pgPool.query('SELECT 1 FROM blocks WHERE chain = $1 AND height = $2 LIMIT 1', [chain, height]);
  return res.rows.length > 0;
}

/**
 * Get a block by height and chain (cache first)
 */
async function getBlock(height, chain) {
  await connectClients();
  // Check Redis cache - parse only what we need to find the matching block
  // This avoids parsing all blocks if we find the match early
  const cachedBlocks = await redis.lrange('recent:blocks', 0, PAGE_SIZE - 1);
  for (const b of cachedBlocks) {
    // Try to parse only the height/chain fields first to avoid full parse if not needed
    // For efficiency, we'll do a quick check on the JSON string before parsing
    // If the block data is very large, this helps avoid unnecessary parsing
    try {
      const block = JSON.parse(b);
      if (block.height === height && block.chain === chain) return block;
    } catch (parseError) {
      // Skip malformed cache entries
      console.warn('Error parsing cached block:', parseError.message);
      continue;
    }
  }
  // Fallback to DB
  const res = await pgPool.query('SELECT * FROM blocks WHERE height = $1 AND chain = $2', [height, chain]);
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
  const res = await pgPool.query('SELECT * FROM transactions WHERE hash = $1', [hash]);
  return res.rows[0] || null;
}

/**
 * Upsert a supplier (node operator)
 */
async function upsertSupplier(supplier) {
  await connectClients();

  // Validate required fields - address is mandatory
  // Handle both 'address' and 'operator_address' field names for compatibility
  const address = supplier.address || supplier.operator_address;
  if (!address || address.trim() === '') {
    console.warn('Skipping supplier upsert: missing address', {
      supplier: JSON.stringify(supplier),
      hasAddress: !!supplier.address,
      hasOperatorAddress: !!supplier.operator_address
    });
    return;
  }

  // Normalize supplier object to use 'address' field
  const normalizedSupplier = {
    ...supplier,
    address: address,
    chain: supplier.chain || 'unknown',
    public_key: supplier.public_key || null,
    staked_amount: supplier.staked_amount || '0',
    stake_change: supplier.stake_change,
    status: supplier.status || 'unknown',
    service_url: supplier.service_url || null,
    owner_address: supplier.owner_address || null,
    last_seen: supplier.last_seen || new Date().toISOString(),
    geo: supplier.geo || null
  };

  try {
    // Handle incremental staking/unstaking
    if (normalizedSupplier.stake_change) {
      const stakeChange = parseFloat(normalizedSupplier.stake_change) || 0;
      await pgPool.query(
        `INSERT INTO suppliers (address, chain, public_key, staked_amount, status, service_url, owner_address, last_seen, geo)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (address, chain) DO UPDATE SET
           public_key=EXCLUDED.public_key,
           staked_amount=GREATEST(0, suppliers.staked_amount + $10),
           status=CASE 
             WHEN suppliers.staked_amount + $10 <= 0 THEN 'unstaked'
             ELSE COALESCE(EXCLUDED.status, suppliers.status)
           END,
           service_url=COALESCE(EXCLUDED.service_url, suppliers.service_url),
           owner_address=COALESCE(EXCLUDED.owner_address, suppliers.owner_address),
           last_seen=EXCLUDED.last_seen,
           geo=COALESCE(EXCLUDED.geo, suppliers.geo)`,
        [
          normalizedSupplier.address,
          normalizedSupplier.chain,
          normalizedSupplier.public_key,
          parseFloat(normalizedSupplier.staked_amount) || 0,
          normalizedSupplier.status,
          normalizedSupplier.service_url,
          normalizedSupplier.owner_address,
          normalizedSupplier.last_seen,
          normalizedSupplier.geo,
          stakeChange, // This is the incremental change
        ]
      );
    } else {
      // Original behavior for non-staking operations
      await pgPool.query(
        `INSERT INTO suppliers (address, chain, public_key, staked_amount, status, service_url, owner_address, last_seen, geo)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (address, chain) DO UPDATE SET
           public_key=EXCLUDED.public_key,
           staked_amount=EXCLUDED.staked_amount,
           status=EXCLUDED.status,
           service_url=EXCLUDED.service_url,
           owner_address=COALESCE(EXCLUDED.owner_address, suppliers.owner_address),
           last_seen=EXCLUDED.last_seen,
           geo=EXCLUDED.geo`,
        [
          normalizedSupplier.address,
          normalizedSupplier.chain,
          normalizedSupplier.public_key,
          parseFloat(normalizedSupplier.staked_amount) || 0,
          normalizedSupplier.status,
          normalizedSupplier.service_url,
          normalizedSupplier.owner_address,
          normalizedSupplier.last_seen,
          normalizedSupplier.geo,
        ]
      );
    }

    // Insert service configs if provided
    if (Array.isArray(supplier.service_configs) && supplier.service_configs.length > 0) {
      for (const sc of supplier.service_configs) {
        if (sc.service_id) {
          await pgPool.query(
            `INSERT INTO supplier_service_configs (supplier_address, chain, service_id, endpoints, config_options, last_seen)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (supplier_address, chain, service_id) DO UPDATE SET
               endpoints = EXCLUDED.endpoints,
               config_options = EXCLUDED.config_options,
               last_seen = EXCLUDED.last_seen`,
            [
              normalizedSupplier.address,
              normalizedSupplier.chain,
              sc.service_id,
              Array.isArray(sc.endpoints) ? sc.endpoints : [],
              sc.config_options || {},
              normalizedSupplier.last_seen
            ]
          );
        }
      }
    }
  } catch (error) {
    console.error('Error in upsertSupplier:', {
      error: error.message,
      stack: error.stack,
      supplier: {
        address: supplier.address,
        chain: supplier.chain,
        staked_amount: supplier.staked_amount,
        stake_change: supplier.stake_change,
        staked_amount_type: typeof supplier.staked_amount,
        stake_change_type: typeof supplier.stake_change
      }
    });
    throw error;
  }
}

/**
 * Upsert an application
 */
async function upsertApplication(app) {
  await connectClients();

  try {
    // Handle incremental staking/unstaking
    if (app.stake_change) {
      const stakeChange = parseFloat(app.stake_change) || 0;
      await pgPool.query(
        `INSERT INTO applications (address, chain, public_key, staked_amount, status, chains, last_seen)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (address, chain) DO UPDATE SET
           public_key=EXCLUDED.public_key,
           staked_amount=GREATEST(0, applications.staked_amount + $8),
           status=CASE 
             WHEN applications.staked_amount + $8 <= 0 THEN 'unstaked'
             ELSE COALESCE(EXCLUDED.status, applications.status)
           END,
           chains=COALESCE(EXCLUDED.chains, applications.chains),
           last_seen=EXCLUDED.last_seen`,
        [
          app.address,
          app.chain,
          app.public_key,
          parseFloat(app.staked_amount) || 0,
          app.status,
          app.chains,
          app.last_seen,
          stakeChange, // This is the incremental change
        ]
      );
    } else {
      // Original behavior for non-staking operations
      await pgPool.query(
        `INSERT INTO applications (address, chain, public_key, staked_amount, status, chains, last_seen)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (address, chain) DO UPDATE SET
           public_key=EXCLUDED.public_key,
           staked_amount=EXCLUDED.staked_amount,
           status=EXCLUDED.status,
           chains=EXCLUDED.chains,
           last_seen=EXCLUDED.last_seen`,
        [
          app.address,
          app.chain,
          app.public_key,
          parseFloat(app.staked_amount) || 0,
          app.status,
          app.chains,
          app.last_seen,
        ]
      );
    }

    // Insert service configs if provided
    if (Array.isArray(app.service_configs) && app.service_configs.length > 0) {
      for (const sc of app.service_configs) {
        if (sc.service_id) {
          await pgPool.query(
            `INSERT INTO application_service_configs (application_address, chain, service_id, endpoints, config_options, last_seen)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (application_address, chain, service_id) DO UPDATE SET
               endpoints = EXCLUDED.endpoints,
               config_options = EXCLUDED.config_options,
               last_seen = EXCLUDED.last_seen`,
            [
              app.address,
              app.chain,
              sc.service_id,
              Array.isArray(sc.endpoints) ? sc.endpoints : [],
              sc.config_options || {},
              app.last_seen
            ]
          );
        }
      }
    }
  } catch (error) {
    console.error('Error in upsertApplication:', {
      error: error.message,
      stack: error.stack,
      application: {
        address: app.address,
        chain: app.chain,
        staked_amount: app.staked_amount,
        stake_change: app.stake_change,
        staked_amount_type: typeof app.staked_amount,
        stake_change_type: typeof app.stake_change
      }
    });
    throw error;
  }
}

/**
 * Insert a staking event
 */
async function insertStakingEvent(event) {
  await connectClients();

  try {
    await pgPool.query(
      `INSERT INTO staking (address, chain, type, amount, event, timestamp)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        event.address,
        event.chain || null,
        event.type,
        parseFloat(event.amount) || 0,
        event.event,
        event.timestamp,
      ]
    );
  } catch (error) {
    console.error('Error in insertStakingEvent:', {
      error: error.message,
      stack: error.stack,
      event: {
        address: event.address,
        chain: event.chain,
        type: event.type,
        amount: event.amount,
        amount_type: typeof event.amount,
        event: event.event,
        timestamp: event.timestamp
      }
    });
    throw error;
  }
}

/**
 * Upsert a service
 */
async function upsertService(service) {
  await connectClients();
  await pgPool.query(
    `INSERT INTO services (supplier_address, chain, service_url, status, last_checked)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (supplier_address, chain, service_url) DO UPDATE SET
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
 * Upsert a network-wide service definition (from MsgAddService)
 */
async function upsertNetworkService(service) {
  await connectClients();
  await pgPool.query(
    `INSERT INTO network_services (id, name, description, compute_units_per_relay, owner_address, last_seen)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (id) DO UPDATE SET
       name=COALESCE(EXCLUDED.name, network_services.name),
       description=COALESCE(EXCLUDED.description, network_services.description),
       compute_units_per_relay=COALESCE(EXCLUDED.compute_units_per_relay, network_services.compute_units_per_relay),
       owner_address=COALESCE(EXCLUDED.owner_address, network_services.owner_address),
       last_seen=EXCLUDED.last_seen`,
    [
      service.id,
      service.name || null,
      service.description || null,
      service.compute_units_per_relay || null,
      service.owner_address || null,
      service.last_seen || null,
    ]
  );
}

/**
 * Upsert a node
 */
async function upsertNode(node) {
  await connectClients();

  try {
    // Handle incremental staking/unstaking
    if (node.stake_change) {
      const stakeChange = parseFloat(node.stake_change) || 0;
      await pgPool.query(
        `INSERT INTO nodes (address, chain, public_key, staked_amount, status, geo, last_seen, service_url)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (address, chain) DO UPDATE SET
           public_key=EXCLUDED.public_key,
           staked_amount=GREATEST(0, nodes.staked_amount + $9),
           status=CASE 
             WHEN nodes.staked_amount + $9 <= 0 THEN 'unstaked'
             ELSE COALESCE(EXCLUDED.status, nodes.status)
           END,
           geo=COALESCE(EXCLUDED.geo, nodes.geo),
           last_seen=EXCLUDED.last_seen,
           service_url=COALESCE(EXCLUDED.service_url, nodes.service_url)`,
        [
          node.address,
          node.chain,
          node.public_key,
          parseFloat(node.staked_amount) || 0,
          node.status,
          node.geo,
          node.last_seen,
          node.service_url,
          stakeChange, // This is the incremental change
        ]
      );
    } else {
      // Original behavior for non-staking operations
      await pgPool.query(
        `INSERT INTO nodes (address, chain, public_key, staked_amount, status, geo, last_seen, service_url)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (address, chain) DO UPDATE SET
           public_key=EXCLUDED.public_key,
           staked_amount=EXCLUDED.staked_amount,
           status=EXCLUDED.status,
           geo=EXCLUDED.geo,
           last_seen=EXCLUDED.last_seen,
           service_url=EXCLUDED.service_url`,
        [
          node.address,
          node.chain,
          node.public_key,
          parseFloat(node.staked_amount) || 0,
          node.status,
          node.geo,
          node.last_seen,
          node.service_url,
        ]
      );
    }
  } catch (error) {
    console.error('Error in upsertNode:', {
      error: error.message,
      stack: error.stack,
      node: {
        address: node.address,
        chain: node.chain,
        staked_amount: node.staked_amount,
        stake_change: node.stake_change,
        staked_amount_type: typeof node.staked_amount,
        stake_change_type: typeof node.stake_change
      }
    });
    throw error;
  }
}

/**
 * Upsert a gateway
 */
async function upsertGateway(gateway) {
  await connectClients();

  try {
    // Handle incremental staking/unstaking
    if (gateway.stake_change) {
      const stakeChange = parseFloat(gateway.stake_change) || 0;
      await pgPool.query(
        `INSERT INTO gateways (address, chain, public_key, staked_amount, status, service_url, last_seen, geo)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (address, chain) DO UPDATE SET
           public_key=EXCLUDED.public_key,
           staked_amount=GREATEST(0, gateways.staked_amount + $9),
           status=CASE 
             WHEN gateways.staked_amount + $9 <= 0 THEN 'unstaked'
             ELSE COALESCE(EXCLUDED.status, gateways.status)
           END,
           service_url=COALESCE(EXCLUDED.service_url, gateways.service_url),
           last_seen=EXCLUDED.last_seen,
           geo=COALESCE(EXCLUDED.geo, gateways.geo)`,
        [
          gateway.address,
          gateway.chain,
          gateway.public_key,
          parseFloat(gateway.staked_amount) || 0,
          gateway.status,
          gateway.service_url,
          gateway.last_seen,
          gateway.geo,
          stakeChange, // This is the incremental change
        ]
      );
    } else {
      // Original behavior for non-staking operations
      await pgPool.query(
        `INSERT INTO gateways (address, chain, public_key, staked_amount, status, service_url, last_seen, geo)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (address, chain) DO UPDATE SET
           public_key=EXCLUDED.public_key,
           staked_amount=EXCLUDED.staked_amount,
           status=EXCLUDED.status,
           service_url=EXCLUDED.service_url,
           last_seen=EXCLUDED.last_seen,
           geo=EXCLUDED.geo`,
        [
          gateway.address,
          gateway.chain,
          gateway.public_key,
          parseFloat(gateway.staked_amount) || 0,
          gateway.status,
          gateway.service_url,
          gateway.last_seen,
          gateway.geo,
        ]
      );
    }
  } catch (error) {
    console.error('Error in upsertGateway:', {
      error: error.message,
      stack: error.stack,
      gateway: {
        address: gateway.address,
        chain: gateway.chain,
        staked_amount: gateway.staked_amount,
        stake_change: gateway.stake_change,
        staked_amount_type: typeof gateway.staked_amount,
        stake_change_type: typeof gateway.stake_change
      }
    });
    throw error;
  }
}

module.exports = {
  connectClients,
  pgClient: pgPool, // Export pool as pgClient for backward compatibility
  pgPool, // Also export as pgPool for clarity
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
  bulkSaveClaims,
  saveProofSubmission,
  bulkSaveProofSubmissions,
  upsertGateway,
  getHistoricalCheckpoint,
  setHistoricalCheckpoint,
  upsertWorkerHeartbeat,
  getSnapshotProcessedHeight,
  findGaps,
  getNextGapToFill,
  blockExists,
  // Cleanup function for graceful shutdown
  async closePool() {
    await pgPool.end();
  }
}; 