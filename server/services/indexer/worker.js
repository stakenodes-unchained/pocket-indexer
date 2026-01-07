const { parentPort, workerData } = require('worker_threads');
const {
  saveBlock,
  saveTransaction,
  getLastProcessedHeight,
  upsertSupplier,
  upsertApplication,
  insertStakingEvent,
  upsertService,
  upsertNode,
  saveRelay,
  saveGovernance,
  upsertGateway,
  upsertNetworkService,
  bulkSaveProofSubmissions
} = require('./db');
const { transformBlock } = require('./transformer');
const { fetchBlockByHeight, fetchLatestBlock, fetchBlockResultsByHeight } = require('./rpc');
const {
  classifyTransaction,
  parseSuppliers,
  parseApplications,
  parseStakingEvents,
  parseServices,
  parseNodes,
  parseRelays,
  parseGateways,
  parseProofSubmissions,
  parseClaims
} = require('./entityParser.v2');
const { processBlockEvents, processTransactionEvents } = require('./eventProcessor');
const { enqueueBlockResults } = require('./blockResultsQueue');

const { rpcName, rpcUrl, batchSize, processType, blockResultsRpcUrl, concurrency } = workerData;

function log(message) {
  parentPort.postMessage({ type: 'log', data: message });
}

function reportError(message) {
  parentPort.postMessage({ type: 'error', data: message });
}

async function processBlock(blockData) {
  try {
    const blockHeight = blockData.block?.header?.height || 'unknown';
    console.log(`[Worker ${workerData.id}] Processing block ${blockHeight}`);
    let block = await saveBlock(blockData, rpcName, rpcUrl);

    // If block save failed completely, skip processing
    if (!block) {
      console.log(`[Worker ${workerData.id}] Block save failed, skipping processing`);
      return;
    }

    const claimsBuffer = [];
    const proofSubmissionsBuffer = [];
    
    // Configuration for batched transaction logging
    const TX_LOG_BATCH_SIZE = parseInt(process.env.BLOCK_RESULTS_TX_LOG_BATCH_SIZE || '50', 10);
    let txProcessedCount = 0;
    let txErrorCount = 0;
    let txStartTime = Date.now();
    
    for (const tx of block.transactions) {
      try {
        let suppliers = [];
        let applications = [];
        let stakingEvents = [];
        let services = [];
        let nodes = [];
        let relays = [];
        let gateways = [];
        const governance = [];

        relays = parseRelays(tx, blockData, rpcName);
        const claims = parseClaims(tx, blockData, rpcName);
        if (Array.isArray(claims) && claims.length) {
          claimsBuffer.push(...claims);
        }

        const proofSubmissions = parseProofSubmissions(tx, blockData, rpcName);
        if (Array.isArray(proofSubmissions) && proofSubmissions.length) {
          proofSubmissionsBuffer.push(...proofSubmissions);
        }
        
        try {
          // Extract hash from multiple possible locations
          const txHash = tx.hash || tx.tx_response?.txhash || tx.tx_response?.hash || 'unknown';
          const txData = {
            tx_response: tx.tx_response || {},
            hash: txHash,
            tx: tx.tx || {}
          };
          const eventResults = await processTransactionEvents(txData, blockData, rpcName);
          if (eventResults.length > 0) {
            const successCount = eventResults.filter(r => r.success).length;
            if (eventResults.length > 0 && successCount < eventResults.length) {
              const hashDisplay = txHash !== 'unknown' ? `${txHash.substring(0, 16)}...` : 'unknown';
              const failedEvents = eventResults.filter(r => !r.success);
              const failedDetails = failedEvents.map(r => 
                `${r.event_type || 'unknown'}: ${r.error || 'Unknown error'}`
              ).join('; ');
              console.warn(`[Worker ${workerData.id}] Transaction ${hashDisplay} had ${eventResults.length - successCount} failed events: ${failedDetails}`);
            }
          }
        } catch (e) {
          console.error(`[Worker ${workerData.id}] Error processing transaction events:`, e.message);
          // Don't fail transaction processing if event processing fails
        }

        // Full parsing for non-claim transactions
        suppliers = parseSuppliers(tx, blockData, rpcName);
        applications = parseApplications(tx, blockData, rpcName);
        stakingEvents = parseStakingEvents(tx, blockData, rpcName);
        services = parseServices(tx, blockData, rpcName);
        nodes = parseNodes(tx, blockData, rpcName);
        relays = parseRelays(tx, blockData, rpcName);
        gateways = parseGateways(tx, blockData, rpcName);


        // Save all entities with individual error handling
        // Suppliers
        try {
          for (const supplier of suppliers) {
            // Validate supplier has required address field (either 'address' or 'operator_address')
            const address = supplier.address || supplier.operator_address;
            if (!address || (typeof address === 'string' && address.trim() === '')) {
              console.warn(`[Worker ${workerData.id}] Skipping supplier without valid address:`, {
                hasAddress: !!supplier.address,
                hasOperatorAddress: !!supplier.operator_address,
                chain: supplier.chain
              });
              continue;
            }
            await upsertSupplier(supplier);
          }
        } catch (supplierError) {
          console.error(`[Worker ${workerData.id}] Error saving suppliers for transaction:`, supplierError.message);
        }

        // Applications
        try {
          for (const app of applications) {
            await upsertApplication(app);
          }
        } catch (appError) {
          console.error(`[Worker ${workerData.id}] Error saving applications for transaction:`, appError.message);
        }

        // Staking Events
        try {
          for (const event of stakingEvents) {
            await insertStakingEvent(event);
          }
        } catch (stakingError) {
          console.error(`[Worker ${workerData.id}] Error saving staking events for transaction:`, stakingError.message);
        }

        // Services
        try {
          for (const service of services) {
            // If this is a per-supplier/gateway advertisement, require supplier_address
            if (service.supplier_address) {
              await upsertService(service);
            } else if (service.id) {
              // Network-wide service definition
              await upsertNetworkService(service);
            } else {
              // Skip invalid service records lacking identifiers
              continue;
            }
          }
        } catch (serviceError) {
          console.error(`[Worker ${workerData.id}] Error saving services for transaction:`, serviceError.message);
        }

        // Nodes
        try {
          for (const node of nodes) {
            await upsertNode(node);
          }
        } catch (nodeError) {
          console.error(`[Worker ${workerData.id}] Error saving nodes for transaction:`, nodeError.message);
        }

        // Relays
        try {
          for (const relay of relays) {
            await saveRelay(relay);
          }
        } catch (relayError) {
          console.error(`[Worker ${workerData.id}] Error saving relays for transaction:`, relayError.message);
        }

        // Governance
        try {
          for (const gov of governance) {
            await saveGovernance(gov);
          }
        } catch (govError) {
          console.error(`[Worker ${workerData.id}] Error saving governance for transaction:`, govError.message);
        }

        // Gateways
        try {
          for (const gateway of gateways) {
            await upsertGateway(gateway);
          }
        } catch (gatewayError) {
          console.error(`[Worker ${workerData.id}] Error saving gateways for transaction:`, gatewayError.message);
        }
      } catch (txError) {
        txErrorCount++;
        // Only log individual transaction errors if there are very few transactions
        // Otherwise, batch them
        if (block.transactions.length <= 10) {
          console.error(`[Worker ${workerData.id}] Error processing transaction:`, txError);
        }
        // Continue with next transaction - don't let one bad transaction stop the whole block
      }
      
      txProcessedCount++;
      
      // Log progress in batches to reduce log noise
      if (txProcessedCount % TX_LOG_BATCH_SIZE === 0) {
        const elapsed = Date.now() - txStartTime;
        const rate = (txProcessedCount / elapsed * 1000).toFixed(1);
        console.log(`[Worker ${workerData.id}] Block ${blockHeight}: Processed ${txProcessedCount}/${block.transactions.length} transactions (${rate} tx/s, ${txErrorCount} errors)`);
      }
    }
    
    // Log final transaction processing summary if there were many transactions
    if (block.transactions.length > TX_LOG_BATCH_SIZE) {
      const totalTime = Date.now() - txStartTime;
      const avgRate = (txProcessedCount / totalTime * 1000).toFixed(1);
      console.log(`[Worker ${workerData.id}] Block ${blockHeight}: Completed processing ${txProcessedCount} transactions in ${totalTime}ms (${avgRate} tx/s, ${txErrorCount} errors)`);
    }
    // Flush buffered claims in bulk for this block
    try {
      if (claimsBuffer.length) {
        const { bulkSaveClaims } = require('./db');
        await bulkSaveClaims(claimsBuffer);
        // Clear buffer after save to free memory
        claimsBuffer.length = 0;
      }
    } catch (e) {
      console.error(`[Worker ${workerData.id}] Error bulk saving claims:`, e.message);
      // Clear buffer even on error to prevent memory leak
      claimsBuffer.length = 0;
    }

    // Flush buffered proof submissions in bulk for this block
    try {
      if (proofSubmissionsBuffer.length) {
        await bulkSaveProofSubmissions(proofSubmissionsBuffer);
        console.log(`[Worker ${workerData.id}] Saved ${proofSubmissionsBuffer.length} proof submissions for reward tracking`);
        // Clear buffer after save to free memory
        proofSubmissionsBuffer.length = 0;
      }
    } catch (e) {
      console.error(`[Worker ${workerData.id}] Error bulk saving proof submissions:`, e.message);
      // Clear buffer even on error to prevent memory leak
      proofSubmissionsBuffer.length = 0;
    }
    
    // Process block-level events (from finalize_block_events, BeginBlock/EndBlock hooks)
    // These events are critical for claim settlements and other automatic operations
    // Enqueue block_results for asynchronous processing (non-blocking)
    const blockHeightForResults = blockData.block?.header?.height || blockData.sdk_block?.header?.height;
    if (blockHeightForResults && blockResultsRpcUrl) {
      const height = typeof blockHeightForResults === 'string' ? parseInt(blockHeightForResults, 10) : blockHeightForResults;
      if (!isNaN(height)) {
        // Enqueue for async processing - don't block on this
        enqueueBlockResults(rpcName, height)
          .then(success => {
            if (success) {
              // Only log every 100th block to reduce noise
              if (height % 100 === 0) {
                console.log(`[Worker ${workerData.id}] Enqueued block_results for block ${height}`);
              }
            }
          })
          .catch(error => {
            // Log but don't fail - queue failures shouldn't block block processing
            console.warn(`[Worker ${workerData.id}] Failed to enqueue block_results for block ${height}: ${error.message}`);
          });
      }
    } else if (blockHeightForResults && !blockResultsRpcUrl) {
      // Log when blockResultsRpcUrl is not configured (only once per worker to avoid spam)
      if (!workerData._loggedMissingBlockResultsUrl) {
        console.warn(`[Worker ${workerData.id}] blockResultsRpcUrl not configured - blocks will not be enqueued for block_results processing`);
        workerData._loggedMissingBlockResultsUrl = true;
      }
    }
    
    // Process block events immediately without waiting for block_results
    // block_results will be processed asynchronously by blockResultsWorker
    try {
      const eventResults = await processBlockEvents(blockData, null, rpcName);
      if (eventResults.length > 0) {
        const successCount = eventResults.filter(r => r.success).length;
        console.log(`[Worker ${workerData.id}] Processed ${eventResults.length} block events (${successCount} successful)`);
      }
    } catch (e) {
      console.error(`[Worker ${workerData.id}] Error processing block events:`, e.message);
      // Don't fail block processing if event processing fails
    }
    
    console.log(`[Worker ${workerData.id}] Successfully processed block ${blockData.block?.header?.height || 'unknown'}`);
  } catch (error) {
    console.error(`[Worker ${workerData.id}] Error processing block:`, error);
    throw error;
  }
}

async function syncHistoricalBlocks() {
  log('Starting historical block sync...');
  const {
    getHistoricalCheckpoint,
    setHistoricalCheckpoint,
    getLastProcessedHeight,
    getNextGapToFill
  } = require('./db');

  // Get the highest processed height from monitoring (this is our target)
  const monitoringHeight = parseInt(await getLastProcessedHeight(rpcName), 10) || 0;

  // Get the current historical sync checkpoint
  let currentHeight = parseInt(await getHistoricalCheckpoint(rpcName), 10) || 0;

  // If no checkpoint exists, start from the beginning
  if (!currentHeight || currentHeight <= 0) {
    currentHeight = 0;
  }

  log(`Historical sync: current=${currentHeight}, monitoring=${monitoringHeight}`);

  // Fill gaps between historical sync and monitoring
  let consecutiveErrors = 0;
  const maxConsecutiveErrors = 10;

  while (currentHeight < monitoringHeight && consecutiveErrors < maxConsecutiveErrors) {
    try {
      // Always process blocks to ensure all transactions are captured
      // This handles cases where blocks exist but transactions might have been missed
      // due to restarts, failures, or partial processing
      const nextHeight = currentHeight + 1;
      const targetHeight = Math.min(
        nextHeight + (Number.isFinite(concurrency) && concurrency > 0 ? concurrency - 1 : 0),
        monitoringHeight
      );

      log(`Processing historical blocks ${nextHeight} to ${targetHeight}...`);

      for (let height = nextHeight; height <= targetHeight; height++) {
        await processBlock(await fetchBlockByHeight(height, rpcUrl));
        currentHeight = height;
        await setHistoricalCheckpoint(rpcName, currentHeight);
      }

      consecutiveErrors = 0; // Reset error counter on success

      // Small delay to prevent overwhelming the RPC
      if (currentHeight % 10 === 0) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } catch (error) {
      consecutiveErrors++;
      console.error(`[Worker ${workerData.id}] Error processing historical block ${currentHeight + 1} (error ${consecutiveErrors}/${maxConsecutiveErrors}):`, error.message);

      // Skip this block and continue
      currentHeight++;
      await setHistoricalCheckpoint(rpcName, currentHeight);

      // Add delay after errors to prevent rapid retry loops
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  if (consecutiveErrors >= maxConsecutiveErrors) {
    log(`Too many consecutive errors (${consecutiveErrors}), stopping historical sync`);
    return { caughtUp: false, currentHeight, monitoringHeight, hasErrors: true };
  }

  log(`Historical sync completed successfully. Current height: ${currentHeight}, Monitoring height: ${monitoringHeight}`);

  // After filling sequential gaps, check for any remaining gaps using getNextGapToFill
  log('Checking for remaining gaps...');
  let nextGap = await getNextGapToFill(rpcName);
  let gapsFilled = 0;
  const maxGapsPerRun = 50; // Limit gaps filled per run to prevent infinite loops

  while (nextGap && gapsFilled < maxGapsPerRun) {
    try {
      await processBlock(await fetchBlockByHeight(nextGap, rpcUrl));
      log(`Filled gap at height ${nextGap}`);
      gapsFilled++;

      // Small delay
      await new Promise(resolve => setTimeout(resolve, 50));

      // Get the next gap
      nextGap = await getNextGapToFill(rpcName);
    } catch (error) {
      console.error(`[Worker ${workerData.id}] Error filling gap at height ${nextGap}:`, error.message);

      // Skip this gap and try the next one
      nextGap = await getNextGapToFill(rpcName);
    }
  }

  if (gapsFilled > 0) {
    log(`Filled ${gapsFilled} remaining gaps in this run`);
  }

  log(`Historical block sync complete. Synced up to height ${currentHeight}`);

  // Return status indicating if caught up
  const caughtUp = currentHeight >= monitoringHeight;
  return { caughtUp, currentHeight, monitoringHeight, gapsFilled, hasErrors: false };
}

function startContinuousGapFilling() {
  const { getNextGapToFill, getLastProcessedHeight } = require('./db');
  const gapCheckInterval = parseInt(process.env.GAP_CHECK_INTERVAL_MS || '30000', 10); // Default 30s

  // Use a flag to ensure this only sets up the interval once
  if (startContinuousGapFilling.intervalSet) {
    log('Continuous gap filling already started, skipping duplicate setup');
    return;
  }
  startContinuousGapFilling.intervalSet = true;

  log('Starting continuous gap filling...');

  setInterval(async () => {
    try {
      const monitoringHeight = parseInt(await getLastProcessedHeight(rpcName), 10) || 0;
      let nextGap = await getNextGapToFill(rpcName);

      if (nextGap) {
        const gapHeight = parseInt(nextGap, 10);
        log(`Found gap at height ${gapHeight}, filling...`);
        try {
          await processBlock(await fetchBlockByHeight(gapHeight, rpcUrl));
          log(`Filled gap at height ${gapHeight}`);
        } catch (error) {
          console.error(`[Worker ${workerData.id}] Error filling gap at height ${gapHeight}:`, error.message);
        }
      }
    } catch (error) {
      console.error(`[Worker ${workerData.id}] Error in continuous gap filling:`, error.message);
    }
  }, gapCheckInterval);
}

async function monitorNewBlocks() {
  log('Starting new block monitor...');

  // In monitoring mode, start from the current block height on the node
  // The lag monitor will fill in any missing blocks later
  const initialBlock = await fetchLatestBlock(rpcUrl);
  let lastProcessedHeight = parseInt(initialBlock.block.header.height, 10);

  log(`Monitoring mode: Starting from current block height ${lastProcessedHeight} on node`);

  const { upsertWorkerHeartbeat } = require('./db');
  const monitorIntervalMs = parseInt(process.env.MONITOR_INTERVAL_MS || '30000', 10);

  setInterval(async () => {
    try {
      // Heartbeat once per interval with lightweight meta
      try {
        await upsertWorkerHeartbeat(`${rpcName}-monitor`, {
          threadId: workerData.id,
          type: 'monitor',
          lastProcessedHeight,
          status: 'active'
        });
      } catch (_) {
        console.error(`[Worker ${workerData.id}] Error upserting worker heartbeat:`, _.message);
      }

      const latestBlock = await fetchLatestBlock(rpcUrl);
      const latestHeight = parseInt(latestBlock.block.header.height, 10);

      if (latestHeight > lastProcessedHeight) {
        log(`New blocks detected. From ${lastProcessedHeight + 1} to ${latestHeight}`);
        for (let height = lastProcessedHeight + 1; height <= latestHeight; height++) {
          try {
            await processBlock(await fetchBlockByHeight(height, rpcUrl));
            // Emit heartbeat on each processed block so monitorProcessed stays fresh under heavy load
            try {
              await upsertWorkerHeartbeat(`${rpcName}-monitor`, {
                threadId: workerData.id,
                type: 'monitor',
                lastProcessedHeight: height,
                status: 'active',
                latestHeight
              });
            } catch (_) { }
          } catch (error) {
            console.error(`[Worker ${workerData.id}] Error processing new block ${height}:`, error.message);
            // Continue with next block
          }
        }
        lastProcessedHeight = latestHeight;
      }
    } catch (error) {
      reportError(`Error in new block monitor: ${error.message}`);
    }
  }, monitorIntervalMs); // Default 10s; configurable via MONITOR_INTERVAL_MS
}

async function run() {
  log(`Worker started for ${rpcName} (process type: ${processType})`);

  if (processType === 'historical') {
    const {
      getHistoricalCheckpoint,
      getLastProcessedHeight,
      upsertWorkerHeartbeat
    } = require('./db');

    // Set up continuous heartbeat updates (similar to monitor workers)
    const heartbeatInterval = parseInt(process.env.HISTORICAL_HEARTBEAT_INTERVAL_MS || '30000', 10); // Default 30s
    setInterval(async () => {
      try {
        const currentHeight = parseInt(await getHistoricalCheckpoint(rpcName), 10) || 0;
        const monitoringHeight = parseInt(await getLastProcessedHeight(rpcName), 10) || 0;
        const status = currentHeight >= monitoringHeight ? 'synced' : 'catching_up';
        
        await upsertWorkerHeartbeat(`${rpcName}-historical`, {
          threadId: workerData.id,
          type: 'historical',
          currentHeight,
          targetHeight: monitoringHeight,
          progress: monitoringHeight > 0 ? Math.round((currentHeight / monitoringHeight) * 100) : 0,
          status
        });
      } catch (error) {
        console.error(`[Worker ${workerData.id}] Error updating heartbeat:`, error.message);
      }
    }, heartbeatInterval);

    // Set up continuous gap filling (once, persistent)
    startContinuousGapFilling();

    // Run historical sync with periodic restart
    const restartInterval = parseInt(process.env.HISTORICAL_RESTART_INTERVAL_MS || '300000', 10); // Default 5 minutes

    const runHistoricalSync = async () => {
      try {
        const result = await syncHistoricalBlocks();
        if (result && result.hasErrors) {
          // Update heartbeat with error status
          try {
            await upsertWorkerHeartbeat(`${rpcName}-historical`, {
              threadId: workerData.id,
              type: 'historical',
              currentHeight: result.currentHeight,
              targetHeight: result.monitoringHeight,
              status: 'error',
              error: 'Too many consecutive errors',
              lastError: new Date().toISOString()
            });
          } catch (_) { }
        }
      } catch (error) {
        console.error(`[Worker ${workerData.id}] Historical sync failed:`, error.message);
        // Update heartbeat with error
        try {
          await upsertWorkerHeartbeat(`${rpcName}-historical`, {
            threadId: workerData.id,
            type: 'historical',
            status: 'error',
            error: error.message,
            lastError: new Date().toISOString()
          });
        } catch (_) { }
      }
    };

    // Run initial sync
    await runHistoricalSync();

    // Set up periodic restart (non-blocking, doesn't recreate intervals)
    setInterval(async () => {
      log(`Restarting historical sync for ${rpcName}...`);
      await runHistoricalSync();
    }, restartInterval);

  } else if (processType === 'monitor') {
    // Only run monitoring
    monitorNewBlocks();
  } else {
    // Default behavior: run both (for backward compatibility)
    log('Running both historical sync and monitoring (legacy mode)');
    syncHistoricalBlocks().catch(e => reportError(`Historical sync error: ${e.message}`));
    monitorNewBlocks();
  }
}

run().catch(error => {
  reportError(error.message);
  process.exit(1);
}); 