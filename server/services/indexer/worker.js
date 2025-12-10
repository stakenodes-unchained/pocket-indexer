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

const { rpcName, rpcUrl, batchSize, processType, blockResultsRpcUrl } = workerData;

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

    // Save block to database
    // Note: saveBlock now always processes transactions even if block exists
    // This ensures we catch any transactions that might have been missed due to
    // restarts, failures, or partial processing
    let block = await saveBlock(blockData, rpcName, rpcUrl);

    // If block save failed completely, skip processing
    if (!block) {
      console.log(`[Worker ${workerData.id}] Block save failed, skipping processing`);
      return;
    }

    // Buffer claims for bulk upsert per block
    const claimsBuffer = [];
    const proofSubmissionsBuffer = [];
    console.log("block.transactions", block.transactions.length)
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

        // Claims fast-path: only parse claims/relays and proof submissions
        relays = parseRelays(tx, blockData, rpcName);
        const claims = parseClaims(tx, blockData, rpcName);
        if (Array.isArray(claims) && claims.length) {
          claimsBuffer.push(...claims);
        }

        // Parse proof submissions for reward tracking
        const proofSubmissions = parseProofSubmissions(tx, blockData, rpcName);
        console.log("proofSubmissions", proofSubmissions.length)
        if (Array.isArray(proofSubmissions) && proofSubmissions.length) {
          proofSubmissionsBuffer.push(...proofSubmissions);
        }
        
        // Process transaction events (from tx_response.events)
        // These events complement the message parsing and provide actual outcomes
        try {
          // Create tx data structure for event processing
          const txData = {
            tx_response: tx.tx_response || {},
            hash: tx.hash,
            tx: tx.tx || {}
          };
          const eventResults = await processTransactionEvents(txData, blockData);
          if (eventResults.length > 0) {
            const successCount = eventResults.filter(r => r.success).length;
            // Log only if there are events (to reduce noise)
            if (eventResults.length > 0 && successCount < eventResults.length) {
              console.warn(`[Worker ${workerData.id}] Transaction ${tx.hash?.substring(0, 16)}... had ${eventResults.length - successCount} failed events`);
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
        console.error(`[Worker ${workerData.id}] Error processing transaction:`, txError);
        // Continue with next transaction - don't let one bad transaction stop the whole block
      }
    }
    // Flush buffered claims in bulk for this block
    try {
      if (claimsBuffer.length) {
        const { bulkSaveClaims } = require('./db');
        await bulkSaveClaims(claimsBuffer);
      }
    } catch (e) {
      console.error(`[Worker ${workerData.id}] Error bulk saving claims:`, e.message);
    }

    // Flush buffered proof submissions in bulk for this block
    try {
      console.log("proofSubmissionsBuffer", proofSubmissionsBuffer.length)
      if (proofSubmissionsBuffer.length) {
        await bulkSaveProofSubmissions(proofSubmissionsBuffer);
        console.log(`[Worker ${workerData.id}] Saved ${proofSubmissionsBuffer.length} proof submissions for reward tracking`);
      }
    } catch (e) {
      console.error(`[Worker ${workerData.id}] Error bulk saving proof submissions:`, e.message);
    }
    
    // Process block-level events (from finalize_block_events, BeginBlock/EndBlock hooks)
    // These events are critical for claim settlements and other automatic operations
    // Fetch block_results to get finalize_block_events from the Tendermint endpoint
    let blockResultsData = null;
    try {
      const blockHeight = blockData.block?.header?.height || blockData.sdk_block?.header?.height;
      if (blockHeight) {
        // Convert to number if it's a string, block_results API accepts both
        const height = typeof blockHeight === 'string' ? parseInt(blockHeight, 10) : blockHeight;
        if (!isNaN(height)) {
          blockResultsData = await fetchBlockResultsByHeight(height, blockResultsRpcUrl);
        }
      }
    } catch (error) {
      // Log warning but continue - block_results may not be available for all blocks
      console.warn(`[Worker ${workerData.id}] Could not fetch block_results for block ${blockData.block?.header?.height || 'unknown'}: ${error.message}`);
      // Continue with existing event extraction from blockData
    }
    
    try {
      const eventResults = await processBlockEvents(blockData, blockResultsData);
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
    upsertWorkerHeartbeat,
    getLastProcessedHeight,
    getNextGapToFill,
    findGaps
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
      log(`Processing historical block ${nextHeight}...`);
      await processBlock(await fetchBlockByHeight(nextHeight, rpcUrl));
      currentHeight = nextHeight;
      await setHistoricalCheckpoint(rpcName, currentHeight);
      consecutiveErrors = 0; // Reset error counter on success

      // Update heartbeat with progress
      try {
        await upsertWorkerHeartbeat(`${rpcName}-historical`, {
          threadId: workerData.id,
          type: 'historical',
          currentHeight,
          targetHeight: monitoringHeight,
          progress: Math.round((currentHeight / monitoringHeight) * 100),
          status: 'filling_gaps'
        });
      } catch (_) {
        console.error(`[Worker ${workerData.id}] Error upserting worker heartbeat:`, _.message);
      }

      // Small delay to prevent overwhelming the RPC
      if (currentHeight % 10 === 0) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } catch (error) {
      consecutiveErrors++;
      console.error(`[Worker ${workerData.id}] Error processing historical block ${currentHeight + 1} (error ${consecutiveErrors}/${maxConsecutiveErrors}):`, error.message);

      // Update heartbeat with error status
      try {
        await upsertWorkerHeartbeat(`${rpcName}-historical`, {
          threadId: workerData.id,
          type: 'historical',
          currentHeight: currentHeight + 1,
          targetHeight: monitoringHeight,
          status: 'error',
          error: error.message,
          lastError: new Date().toISOString(),
          consecutiveErrors
        });
      } catch (_) { }

      // Skip this block and continue
      currentHeight++;
      await setHistoricalCheckpoint(rpcName, currentHeight);

      // Add delay after errors to prevent rapid retry loops
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  if (consecutiveErrors >= maxConsecutiveErrors) {
    log(`Too many consecutive errors (${consecutiveErrors}), stopping historical sync and entering continuous gap filling mode`);
  } else {
    log(`Historical sync completed successfully. Current height: ${currentHeight}, Monitoring height: ${monitoringHeight}`);
  }

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

      // Update heartbeat
      try {
        await upsertWorkerHeartbeat(`${rpcName}-historical`, {
          threadId: workerData.id,
          type: 'historical',
          currentHeight: nextGap,
          targetHeight: monitoringHeight,
          status: 'filling_remaining_gaps',
          gaps_filled: gapsFilled
        });
      } catch (_) { }

      // Small delay
      await new Promise(resolve => setTimeout(resolve, 50));

      // Get the next gap
      nextGap = await getNextGapToFill(rpcName);
    } catch (error) {
      console.error(`[Worker ${workerData.id}] Error filling gap at height ${nextGap}:`, error.message);

      // Update heartbeat with error status
      try {
        await upsertWorkerHeartbeat(`${rpcName}-historical`, {
          threadId: workerData.id,
          type: 'historical',
          currentHeight: nextGap,
          targetHeight: monitoringHeight,
          status: 'error',
          error: error.message,
          lastError: new Date().toISOString()
        });
      } catch (_) { }

      // Skip this gap and try the next one
      nextGap = await getNextGapToFill(rpcName);
    }
  }

  if (gapsFilled > 0) {
    log(`Filled ${gapsFilled} remaining gaps in this run`);
  }

  log(`Historical block sync complete. Synced up to height ${currentHeight}`);

  // If we're caught up, enter continuous gap-filling mode
  if (currentHeight >= monitoringHeight) {
    log('Entering continuous gap-filling mode...');
    await continuousGapFilling();
  }
}

async function continuousGapFilling() {
  const { getNextGapToFill, upsertWorkerHeartbeat, getLastProcessedHeight } = require('./db');
  const gapCheckInterval = parseInt(process.env.GAP_CHECK_INTERVAL_MS || '30000', 10); // Default 30s

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

          // Update heartbeat with success
          try {
            await upsertWorkerHeartbeat(`${rpcName}-historical`, {
              threadId: workerData.id,
              type: 'historical',
              currentHeight: gapHeight,
              targetHeight: monitoringHeight,
              status: 'continuous_gap_filling'
            });
          } catch (_) { }
        } catch (error) {
          console.error(`[Worker ${workerData.id}] Error filling gap at height ${gapHeight}:`, error.message);

          // Update heartbeat with error status
          try {
            await upsertWorkerHeartbeat(`${rpcName}-historical`, {
              threadId: workerData.id,
              type: 'historical',
              currentHeight: gapHeight,
              targetHeight: monitoringHeight,
              status: 'error',
              error: error.message,
              lastError: new Date().toISOString()
            });
          } catch (_) { }
        }
      } else {
        // No gaps found, update heartbeat to show we're monitoring
        try {
          await upsertWorkerHeartbeat(`${rpcName}-historical`, {
            threadId: workerData.id,
            type: 'historical',
            currentHeight: monitoringHeight,
            targetHeight: monitoringHeight,
            status: 'monitoring_for_gaps'
          });
        } catch (_) { }
      }
    } catch (error) {
      console.error(`[Worker ${workerData.id}] Error in continuous gap filling:`, error.message);

      // Update heartbeat with error status for the main function error
      try {
        await upsertWorkerHeartbeat(`${rpcName}-historical`, {
          threadId: workerData.id,
          type: 'historical',
          currentHeight: 0,
          targetHeight: 0,
          status: 'error',
          error: error.message,
          lastError: new Date().toISOString()
        });
      } catch (_) { }
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
    // Run historical sync with periodic restart
    const restartInterval = parseInt(process.env.HISTORICAL_RESTART_INTERVAL_MS || '300000', 10); // Default 5 minutes

    const runHistoricalSync = async () => {
      try {
        await syncHistoricalBlocks();
      } catch (error) {
        console.error(`[Worker ${workerData.id}] Historical sync failed:`, error.message);
        // Update heartbeat with error
        try {
          const { upsertWorkerHeartbeat } = require('./db');
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

    // Set up periodic restart
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