'use strict';

/**
 * Backfill script to update staked_amount for applications and suppliers from RPC
 * 
 * This script:
 * 1. Fetches all applications and suppliers from the database
 * 2. For each, queries the RPC endpoint to get current stake amount
 * 3. Updates the database with the correct stake amount
 * 
 * Usage:
 *   node server/scripts/backfill_stake_amounts.js [--chain=chain_name] [--type=applications|suppliers|both] [--batch-size=100] [--concurrency=50] [--dry-run]
 * 
 * Options:
 *   --chain: Process only a specific chain (default: all chains)
 *   --type: Process only applications, suppliers, or both (default: both)
 *   --batch-size: Number of records to process in each batch (default: 100)
 *   --concurrency: Number of concurrent RPC/DB operations per batch (default: 50)
 *   --dry-run: Show what would be updated without making changes
 */

const dotenv = require('dotenv');
dotenv.config();

const { Pool } = require('pg');
const { getAllChainConfigs } = require('../services/chainConfig');
const transactionService = require('../services/transactionService');

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    chain: null,
    type: 'both', // 'applications', 'suppliers', or 'both'
    batchSize: 20,
    concurrency: 10,
    dryRun: false
  };

  for (const arg of args) {
    if (arg.startsWith('--chain=')) {
      options.chain = arg.split('=')[1];
    } else if (arg.startsWith('--type=')) {
      options.type = arg.split('=')[1];
    } else if (arg.startsWith('--batch-size=')) {
      options.batchSize = parseInt(arg.split('=')[1], 10) || 100;
    } else if (arg.startsWith('--concurrency=')) {
      const parsed = parseInt(arg.split('=')[1], 10);
      if (!isNaN(parsed) && parsed > 0) {
        options.concurrency = parsed;
      }
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    }
  }

  return options;
}

/**
 * Fetch application data from RPC with retry logic for 503 errors
 */
async function fetchApplicationFromRpc(rpcUrl, address, retries = 3) {
  const endpoint = `${rpcUrl}/pokt-network/poktroll/application/application/${address}`;
  
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await fetch(endpoint, { timeout: 30000 });
      
      if (response.status === 404) {
        return null; // Application not found
      }
      
      // Handle 503 Service Unavailable - wait 30s and retry
      if (response.status === 503) {
        if (attempt < retries - 1) {
          console.log(`  [Retry ${attempt + 1}/${retries - 1}] Got 503 for ${address}, waiting 30s before retry...`);
          await new Promise(resolve => setTimeout(resolve, 30000)); // Wait 30 seconds
          continue; // Retry
        } else {
          throw new Error(`HTTP 503: Service Unavailable (after ${retries} attempts)`);
        }
      }
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      return data?.application || null;
    } catch (error) {
      // Handle 404 errors (from network errors that mention 404)
      if (error.message.includes('404')) {
        return null;
      }
      
      // For 503 errors caught in the catch block (network-level), retry
      if (error.message.includes('503') && attempt < retries - 1) {
        console.log(`  [Retry ${attempt + 1}/${retries - 1}] Got 503 error for ${address}, waiting 30s before retry...`);
        await new Promise(resolve => setTimeout(resolve, 30000)); // Wait 30 seconds
        continue; // Retry
      }
      
      // For other errors or last attempt, throw
      throw error;
    }
  }
  
  return null; // Should never reach here, but just in case
}

/**
 * Fetch supplier data from RPC with retry logic for 503 errors
 */
async function fetchSupplierFromRpc(rpcUrl, operatorAddress, retries = 3) {
  const endpoint = `${rpcUrl}/pokt-network/poktroll/supplier/supplier/${operatorAddress}`;
  
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await fetch(endpoint, { timeout: 30000 });
      
      if (response.status === 404) {
        return null; // Supplier not found
      }
      
      // Handle 503 Service Unavailable - wait 30s and retry
      if (response.status === 503) {
        if (attempt < retries - 1) {
          console.log(`  [Retry ${attempt + 1}/${retries - 1}] Got 503 for ${operatorAddress}, waiting 30s before retry...`);
          await new Promise(resolve => setTimeout(resolve, 30000)); // Wait 30 seconds
          continue; // Retry
        } else {
          throw new Error(`HTTP 503: Service Unavailable (after ${retries} attempts)`);
        }
      }
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      return data?.supplier || null;
    } catch (error) {
      // Handle 404 errors (from network errors that mention 404)
      if (error.message.includes('404')) {
        return null;
      }
      
      // For 503 errors caught in the catch block (network-level), retry
      if (error.message.includes('503') && attempt < retries - 1) {
        console.log(`  [Retry ${attempt + 1}/${retries - 1}] Got 503 error for ${operatorAddress}, waiting 30s before retry...`);
        await new Promise(resolve => setTimeout(resolve, 30000)); // Wait 30 seconds
        continue; // Retry
      }
      
      // For other errors or last attempt, throw
      throw error;
    }
  }
  
  return null; // Should never reach here, but just in case
}

/**
 * Extract stake amount from application or supplier data
 */
function extractStakeAmount(entityData) {
  if (!entityData) return null;
  
  // Try different possible field names for stake amount
  const stakeAmount = entityData.stake?.amount || 
                     entityData.staked_amount || 
                     entityData.stake_amount ||
                     entityData.amount;
  
  if (!stakeAmount) return null;
  
  // Convert string to number if needed
  const amount = typeof stakeAmount === 'string' ? parseFloat(stakeAmount) : stakeAmount;
  return isNaN(amount) ? null : amount;
}

/**
 * Extract stake denom from application or supplier data
 */
function extractStakeDenom(entityData) {
  if (!entityData) return null;
  
  return entityData.stake?.denom || 
         entityData.stake_denom || 
         entityData.denom ||
         'upokt'; // Default denom
}

/**
 * Process an array of items with a concurrency limit.
 */
async function runWithConcurrency(items, worker, concurrency) {
  if (!items || items.length === 0) return;

  const limit = Math.max(1, concurrency || 1);
  let index = 0;

  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (true) {
        const currentIndex = index++;
        if (currentIndex >= items.length) break;
        const item = items[currentIndex];
        // eslint-disable-next-line no-await-in-loop
        await worker(item, currentIndex);
      }
    }
  );

  await Promise.all(workers);
}

/**
 * Backfill applications for a specific chain
 */
async function backfillApplications(client, chain, rpcUrl, batchSize, dryRun, concurrency) {
  console.log(`\n=== Backfilling Applications for ${chain} ===`);
  
  let offset = 0;
  let totalProcessed = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalFailed = 0;
  let totalNotFound = 0;

  while (true) {
    // Fetch batch of applications
    const result = await client.query(
      `SELECT address, chain, staked_amount, stake_denom 
       FROM applications 
       WHERE chain = $1 
       ORDER BY address 
       LIMIT $2 OFFSET $3`,
      [chain, batchSize, offset]
    );

    if (result.rows.length === 0) {
      break; // No more applications
    }

    console.log(`Processing batch: ${result.rows.length} applications (offset: ${offset})`);

    await runWithConcurrency(
      result.rows,
      async (app) => {
        const recordNumber = ++totalProcessed;

        try {
          // Fetch from RPC
          const appData = await fetchApplicationFromRpc(rpcUrl, app.address);
          
          if (!appData) {
            totalNotFound++;
            console.log(`  [${recordNumber}] ${app.address}: Not found on chain`);
            return;
          }

          const rpcStakeAmount = extractStakeAmount(appData);
          const rpcStakeDenom = extractStakeDenom(appData);

          if (rpcStakeAmount === null) {
            totalSkipped++;
            console.log(`  [${recordNumber}] ${app.address}: No stake amount in RPC response`);
            return;
          }

          // Check if update is needed
          const currentAmount = parseFloat(app.staked_amount) || 0;
          const needsUpdate = Math.abs(currentAmount - rpcStakeAmount) > 0.0001; // Allow small floating point differences

          if (needsUpdate) {
            if (dryRun) {
              console.log(`  [${recordNumber}] ${app.address}: Would update ${currentAmount} -> ${rpcStakeAmount} ${rpcStakeDenom || app.stake_denom}`);
              totalUpdated++;
            } else {
              // Update database
              await client.query(
                `UPDATE applications 
                 SET staked_amount = $1, stake_denom = COALESCE($2, stake_denom, 'upokt')
                 WHERE address = $3 AND chain = $4`,
                [rpcStakeAmount, rpcStakeDenom, app.address, chain]
              );
              console.log(`  [${recordNumber}] ${app.address}: Updated ${currentAmount} -> ${rpcStakeAmount} ${rpcStakeDenom || app.stake_denom}`);
              totalUpdated++;
            }
          } else {
            totalSkipped++;
            // Only log if verbose
            if (recordNumber % 10 === 0) {
              console.log(`  [${recordNumber}] ${app.address}: Already up to date (${rpcStakeAmount})`);
            }
          }
        } catch (error) {
          totalFailed++;
          console.error(`  [${recordNumber}] ${app.address}: Error - ${error.message}`);
          // Continue with next application
        }
      },
      concurrency
    );

    offset += batchSize;

    // If we got fewer results than batch size, we're done
    if (result.rows.length < batchSize) {
      break;
    }
  }

  return {
    processed: totalProcessed,
    updated: totalUpdated,
    skipped: totalSkipped,
    failed: totalFailed,
    notFound: totalNotFound
  };
}

/**
 * Backfill suppliers for a specific chain
 */
async function backfillSuppliers(client, chain, rpcUrl, batchSize, dryRun, concurrency) {
  console.log(`\n=== Backfilling Suppliers for ${chain} ===`);
  
  let offset = 0;
  let totalProcessed = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalFailed = 0;
  let totalNotFound = 0;

  while (true) {
    // Fetch batch of suppliers
    const result = await client.query(
      `SELECT address, chain, staked_amount, stake_denom 
       FROM suppliers 
       WHERE chain = $1 
       ORDER BY address 
       LIMIT $2 OFFSET $3`,
      [chain, batchSize, offset]
    );

    if (result.rows.length === 0) {
      break; // No more suppliers
    }

    console.log(`Processing batch: ${result.rows.length} suppliers (offset: ${offset})`);

    await runWithConcurrency(
      result.rows,
      async (supplier) => {
        const recordNumber = ++totalProcessed;

        try {
          // Fetch from RPC
          const supplierData = await fetchSupplierFromRpc(rpcUrl, supplier.address);
          
          if (!supplierData) {
            totalNotFound++;
            console.log(`  [${recordNumber}] ${supplier.address}: Not found on chain`);
            return;
          }

          const rpcStakeAmount = extractStakeAmount(supplierData);
          const rpcStakeDenom = extractStakeDenom(supplierData);

          if (rpcStakeAmount === null) {
            totalSkipped++;
            console.log(`  [${recordNumber}] ${supplier.address}: No stake amount in RPC response`);
            return;
          }

          // Check if update is needed
          const currentAmount = parseFloat(supplier.staked_amount) || 0;
          const needsUpdate = Math.abs(currentAmount - rpcStakeAmount) > 0.0001; // Allow small floating point differences

          if (needsUpdate) {
            if (dryRun) {
              console.log(`  [${recordNumber}] ${supplier.address}: Would update ${currentAmount} -> ${rpcStakeAmount} ${rpcStakeDenom || supplier.stake_denom}`);
              totalUpdated++;
            } else {
              // Update database
              await client.query(
                `UPDATE suppliers 
                 SET staked_amount = $1, stake_denom = COALESCE($2, stake_denom, 'upokt')
                 WHERE address = $3 AND chain = $4`,
                [rpcStakeAmount, rpcStakeDenom, supplier.address, chain]
              );
              console.log(`  [${recordNumber}] ${supplier.address}: Updated ${currentAmount} -> ${rpcStakeAmount} ${rpcStakeDenom || supplier.stake_denom}`);
              totalUpdated++;
            }
          } else {
            totalSkipped++;
            // Only log if verbose
            if (recordNumber % 10 === 0) {
              console.log(`  [${recordNumber}] ${supplier.address}: Already up to date (${rpcStakeAmount})`);
            }
          }
        } catch (error) {
          totalFailed++;
          console.error(`  [${recordNumber}] ${supplier.address}: Error - ${error.message}`);
          // Continue with next supplier
        }
      },
      concurrency
    );

    offset += batchSize;

    // If we got fewer results than batch size, we're done
    if (result.rows.length < batchSize) {
      break;
    }
  }

  return {
    processed: totalProcessed,
    updated: totalUpdated,
    skipped: totalSkipped,
    failed: totalFailed,
    notFound: totalNotFound
  };
}

/**
 * Main backfill function
 */
async function backfillStakeAmounts() {
  const options = parseArgs();
  
  console.log('=== Stake Amount Backfill Script ===');
  console.log('Options:', JSON.stringify(options, null, 2));
  
  if (options.dryRun) {
    console.log('\n⚠️  DRY RUN MODE - No changes will be made to the database\n');
  }

  await transactionService.connectDB();
  const client = transactionService.pgClient;

  // Get chain configs
  const chainConfigs = getAllChainConfigs();
  if (!chainConfigs || chainConfigs.length === 0) {
    console.error('No chains configured in RPC_ENDPOINTS. Aborting.');
    process.exit(1);
  }

  // Filter chains if specified
  const chainsToProcess = options.chain 
    ? chainConfigs.filter(c => c.name === options.chain)
    : chainConfigs;

  if (chainsToProcess.length === 0) {
    console.error(`Chain '${options.chain}' not found in configuration.`);
    process.exit(1);
  }

  console.log(`\nProcessing ${chainsToProcess.length} chain(s): ${chainsToProcess.map(c => c.name).join(', ')}`);

  const allResults = {};

  for (const { name: chain, url: rpcUrl } of chainsToProcess) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Chain: ${chain} (${rpcUrl})`);
    console.log('='.repeat(60));

    const chainResults = {};

    try {
      // Backfill applications
      if (options.type === 'applications' || options.type === 'both') {
        const appResults = await backfillApplications(client, chain, rpcUrl, options.batchSize, options.dryRun);
        chainResults.applications = appResults;
        console.log(`\nApplications Summary:`, appResults);
      }

      // Backfill suppliers
      if (options.type === 'suppliers' || options.type === 'both') {
        const supplierResults = await backfillSuppliers(client, chain, rpcUrl, options.batchSize, options.dryRun);
        chainResults.suppliers = supplierResults;
        console.log(`\nSuppliers Summary:`, supplierResults);
      }

      allResults[chain] = chainResults;
    } catch (error) {
      console.error(`\n❌ Error processing chain ${chain}:`, error.message);
      allResults[chain] = { error: error.message };
    }
  }

  // Print final summary
  console.log('\n' + '='.repeat(60));
  console.log('FINAL SUMMARY');
  console.log('='.repeat(60));
  console.log(JSON.stringify(allResults, null, 2));

  if (options.dryRun) {
    console.log('\n⚠️  This was a DRY RUN - No changes were made');
    console.log('Run without --dry-run to apply changes');
  } else {
    console.log('\n✅ Backfill complete!');
  }

  // Close pool gracefully
  if (transactionService.pgPool) {
    await transactionService.pgPool.end();
  }
}

// Run the script
backfillStakeAmounts().catch(async (err) => {
  console.error('\n❌ Fatal error during backfill:', err);
  if (transactionService.pgPool) {
    await transactionService.pgPool.end();
  }
  process.exit(1);
});

