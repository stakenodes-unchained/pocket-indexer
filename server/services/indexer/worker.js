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

const { rpcName, rpcUrl, batchSize } = workerData;

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
  const { getHistoricalCheckpoint, setHistoricalCheckpoint, upsertWorkerHeartbeat, getSnapshotProcessedHeight } = require('./db');
  // Prefer metrics snapshot processed_height; fallback to checkpoint
  let currentHeight = await getSnapshotProcessedHeight(rpcName);
  if (!currentHeight || currentHeight <= 0) {
    currentHeight = await getHistoricalCheckpoint(rpcName);
  }
  const latestBlock = await fetchLatestBlock(rpcUrl);
  const latestHeight = parseInt(latestBlock.block.header.height, 10);
  let lastProcessedHeight = await getLastProcessedHeight(rpcName);
  
  currentHeight = currentHeight || lastProcessedHeight;
  while (currentHeight < latestHeight) {
    await processBlock(await fetchBlockByHeight(currentHeight, rpcUrl));
    await setHistoricalCheckpoint(rpcName, currentHeight);
    try {
      await upsertWorkerHeartbeat(rpcName, { threadId: workerData.id, type: 'history', currentHeight });
    } catch (_) {
      console.error(`[Worker ${workerData.id}] Error upserting worker heartbeat:`, _.message);
    }
    currentHeight++;
  }
  log('Historical block sync complete.');
}

async function monitorNewBlocks() {
  log('Starting new block monitor...');
  let lastProcessedHeight = await getLastProcessedHeight(rpcName);
  const { upsertWorkerHeartbeat } = require('./db');

  setInterval(async () => {
    try {
      // Heartbeat once per interval with lightweight meta
      try {
        await upsertWorkerHeartbeat(rpcName, { threadId: workerData.id, type: 'monitor', lastProcessedHeight });
      } catch (_) {
        console.error(`[Worker ${workerData.id}] Error upserting worker heartbeat:`, _.message);
      }

      const latestBlock = await fetchLatestBlock(rpcUrl);
      const latestHeight = parseInt(latestBlock.block.header.height, 10);

      if (latestHeight > lastProcessedHeight) {
        log(`New blocks detected. From ${lastProcessedHeight + 1} to ${latestHeight}`);
        for (let height = lastProcessedHeight + 1; height <= latestHeight; height++) {
          await processBlock(await fetchBlockByHeight(height, rpcUrl));
        }
        lastProcessedHeight = latestHeight;
      }
    } catch (error) {
      reportError(`Error in new block monitor: ${error.message}`);
    }
  }, 10000); // Check every 10 seconds
}

async function run() {
  log(`Worker started for ${rpcName}`);
  // Run historical sync in parallel and keep checkpointing
  syncHistoricalBlocks(rpcName).catch(e => reportError(`Historical sync error: ${e.message}`));
  // Start monitor immediately (independent of historical sync)
  monitorNewBlocks(rpcName);
}

run().catch(error => {
  reportError(error.message);
  process.exit(1);
}); 