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
    
    for (const tx of block.transactions) {
      try {
        // Parse and save entities based on transaction type
        // Each parsing function is now robust and will return empty arrays on errors
        const suppliers = parseSuppliers(tx, blockData, rpcName);
        const applications = parseApplications(tx, blockData, rpcName);
        const stakingEvents = parseStakingEvents(tx, blockData, rpcName);
        const services = parseServices(tx, blockData, rpcName);
        const nodes = parseNodes(tx, blockData, rpcName);
        const relays = parseRelays(tx, blockData, rpcName);
        const governance = []; // Governance parsing not implemented in v2 yet
        const gateways = parseGateways(tx, blockData, rpcName);

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
    console.log(`[Worker ${workerData.id}] Successfully processed block ${blockData.block?.header?.height || 'unknown'}`);
  } catch (error) {
    console.error(`[Worker ${workerData.id}] Error processing block:`, error);
    throw error;
  }
}

async function syncHistoricalBlocks() {
  log('Starting historical block sync...');
  let currentHeight = await getLastProcessedHeight(rpcName);
  const latestBlock = await fetchLatestBlock(rpcUrl);
  const latestHeight = parseInt(latestBlock.block.header.height, 10);

  while (currentHeight < latestHeight) {
    await processBlock(await fetchBlockByHeight(currentHeight, rpcUrl));
    currentHeight++;
  }
  log('Historical block sync complete.');
}

async function monitorNewBlocks() {
  log('Starting new block monitor...');
  let lastProcessedHeight = await getLastProcessedHeight(rpcName);

  setInterval(async () => {
    try {
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
  await syncHistoricalBlocks(rpcName);
  await monitorNewBlocks(rpcName);
}

run().catch(error => {
  reportError(error.message);
  process.exit(1);
}); 