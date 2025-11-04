'use strict';

// One-time backfill script to populate validators table for all configured chains

const dotenv = require('dotenv');
dotenv.config();

const validatorService = require('../services/validatorService');
const { getAllChainConfigs } = require('../services/chainConfig');
const transactionService = require('../services/transactionService');

async function backfillValidatorsForAllChains() {
  await transactionService.connectDB();
  validatorService.setExternalPool(transactionService.pgClient);

  const chainConfigs = getAllChainConfigs();
  if (!chainConfigs || chainConfigs.length === 0) {
    console.error('No chains configured in RPC_ENDPOINTS. Aborting.');
    process.exit(1);
  }

  console.log(`Starting validators backfill for ${chainConfigs.length} chains...`);

  const results = {};
  for (const { name: chain, url } of chainConfigs) {
    try {
      console.log(`\n=== Chain: ${chain} (${url}) ===`);
      const count = await validatorService.fetchAndCacheValidators({ chain });
      results[chain] = { fetched: count };
      console.log(`Fetched and upserted ${count} validators for ${chain}`);
    } catch (err) {
      console.error(`Failed to backfill validators for ${chain}:`, err.message);
      results[chain] = { fetched: 0, error: err.message };
    }
  }

  // Report per-chain counts from DB
  try {
    const { rows } = await transactionService.pgClient.query(
      `SELECT chain, COUNT(*) AS validator_count, COUNT(website_domain) FILTER (WHERE website_domain IS NOT NULL AND website_domain != '') AS with_domain
       FROM validators
       GROUP BY chain
       ORDER BY validator_count DESC`
    );
    console.log('\n=== Validators table summary ===');
    for (const r of rows) {
      console.log(`- ${r.chain}: ${r.validator_count} total, ${r.with_domain} with domain`);
    }
  } catch (e) {
    console.warn('Could not fetch summary from validators table:', e.message);
  }

  console.log('\nBackfill complete.');
  console.log(JSON.stringify(results, null, 2));

  // Close pool gracefully
  if (transactionService.pgPool) await transactionService.pgPool.end();
}

backfillValidatorsForAllChains().catch(async (err) => {
  console.error('Fatal error during validators backfill:', err);
  if (transactionService.pgPool) await transactionService.pgPool.end();
  process.exit(1);
});


