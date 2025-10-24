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
  upsertNetworkService
} = require('./db');
const { transformBlock } = require('./transformer');
const { fetchBlockByHeight, fetchLatestBlock } = require('./rpc');
const {
  classifyTransaction,
  parseSuppliers,
  parseApplications,
  parseStakingEvents,
  parseServices,
  parseNodes,
  parseRelays,
  parseGateways,
} = require('./entityParser.v2');

const { rpcName, rpcUrl, batchSize, processType } = workerData;

function log(message) {
  parentPort.postMessage({ type: 'log', data: message });
}

function reportError(message) {
  parentPort.postMessage({ type: 'error', data: message });
}

async function processBlock(blockData) {
  try {
    console.log(`[Worker ${workerData.id}] Processing block ${blockData.block?.header?.height || 'unknown'}`);

    // Save block to database
    let block = await saveBlock(blockData, rpcName, rpcUrl);
    
    // If block already exists, skip processing to avoid null 'block' usage
    if (!block) {
      console.log(`[Worker ${workerData.id}] Block already exists, skipping processing`);
      return;
    }
    
    // Buffer claims for bulk upsert per block
    const claimsBuffer = [];
    for (const tx of block.transactions) {
      try {
        // Light message-type check to short-circuit non-relevant parsers
        const msgs = (tx && tx.tx && tx.tx.body && Array.isArray(tx.tx.body.messages)) ? tx.tx.body.messages : [];
        const hasProofOrClaim = msgs.some(m => {
          const t = m && (m['@type'] || m.type_url || '');
          return typeof t === 'string' && (t.includes('pocket.proof.MsgCreateClaim') || t.includes('pocket.proof.MsgSubmitProof'));
        });

        let suppliers = [];
        let applications = [];
        let stakingEvents = [];
        let services = [];
        let nodes = [];
        let relays = [];
        let gateways = [];
        const governance = [];

        if (hasProofOrClaim) {
          // Claims fast-path: only parse claims/relays
          relays = parseRelays(tx, blockData, rpcName);
          const claims = require('./entityParser.v2').parseClaims(tx, blockData, rpcName);
          if (Array.isArray(claims) && claims.length) {
            claimsBuffer.push(...claims);
          }
        } else {
          // Full parsing for non-claim transactions
          suppliers = parseSuppliers(tx, blockData, rpcName);
          applications = parseApplications(tx, blockData, rpcName);
          stakingEvents = parseStakingEvents(tx, blockData, rpcName);
          services = parseServices(tx, blockData, rpcName);
          nodes = parseNodes(tx, blockData, rpcName);
          relays = parseRelays(tx, blockData, rpcName);
          gateways = parseGateways(tx, blockData, rpcName);
        }

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
    findGaps,
    blockExists
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
  while (currentHeight < monitoringHeight) {
    try {
      // Check if the next block already exists
      const nextHeight = currentHeight + 1;
      const exists = await blockExists(rpcName, nextHeight);
      
      if (exists) {
        log(`Block ${nextHeight} already exists, skipping...`);
        currentHeight = nextHeight;
        await setHistoricalCheckpoint(rpcName, currentHeight);
        continue;
      }
      
      // Process the missing block
      await processBlock(await fetchBlockByHeight(nextHeight, rpcUrl));
      currentHeight = nextHeight;
      await setHistoricalCheckpoint(rpcName, currentHeight);
      
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
      console.error(`[Worker ${workerData.id}] Error processing historical block ${currentHeight + 1}:`, error.message);
      // Skip this block and continue
      currentHeight++;
      await setHistoricalCheckpoint(rpcName, currentHeight);
    }
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
      } catch (_) {}
      
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
          
          // Update heartbeat
          try {
            await upsertWorkerHeartbeat(`${rpcName}-historical`, { 
              threadId: workerData.id, 
              type: 'historical', 
              currentHeight: gapHeight,
              targetHeight: monitoringHeight,
              status: 'continuous_gap_filling'
            });
          } catch (_) {}
        } catch (error) {
          console.error(`[Worker ${workerData.id}] Error filling gap at height ${gapHeight}:`, error.message);
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
        } catch (_) {}
      }
    } catch (error) {
      console.error(`[Worker ${workerData.id}] Error in continuous gap filling:`, error.message);
    }
  }, gapCheckInterval);
}

async function monitorNewBlocks() {
  log('Starting new block monitor...');
  let lastProcessedHeight = await getLastProcessedHeight(rpcName);
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
            } catch (_) {}
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
    // Only run historical sync
    await syncHistoricalBlocks();
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