'use strict';

// One-time script to backfill account_address for existing validators
// Converts poktvaloper... addresses to pokt... addresses

const dotenv = require('dotenv');
dotenv.config();

const { fromBech32, toBech32 } = require('@cosmjs/encoding');
const transactionService = require('../services/transactionService');
const validatorService = require('../services/validatorService');

function operatorAddressToAccount(operatorAddress) {
  if (!operatorAddress || typeof operatorAddress !== 'string') return null;
  try {
    const { prefix, data } = fromBech32(operatorAddress);
    // Handle special cases
    if (prefix === 'iva') {
      return toBech32('iaa', data);
    }
    if (prefix === 'crocncl') {
      return toBech32('cro', data);
    }
    // Replace 'valoper' with empty string (poktvaloper -> pokt)
    const accountPrefix = prefix.replace('valoper', '');
    return toBech32(accountPrefix, data);
  } catch (error) {
    console.warn(`Failed to convert operator address ${operatorAddress}:`, error.message);
    return null;
  }
}

async function backfillAccountAddresses() {
  await transactionService.connectDB();
  const client = transactionService.pgClient;

  console.log('Fetching validators without account_address...');
  const { rows } = await client.query(
    `SELECT operator_address, chain, account_address 
     FROM validators 
     WHERE account_address IS NULL OR account_address = ''`
  );

  console.log(`Found ${rows.length} validators to backfill`);

  let updated = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      const accountAddress = operatorAddressToAccount(row.operator_address);
      if (!accountAddress) {
        console.warn(`Skipping ${row.operator_address} - conversion failed`);
        failed++;
        continue;
      }

      await client.query(
        `UPDATE validators 
         SET account_address = $1 
         WHERE operator_address = $2 AND chain = $3`,
        [accountAddress, row.operator_address, row.chain]
      );
      updated++;
    } catch (error) {
      console.error(`Failed to update ${row.operator_address} on ${row.chain}:`, error.message);
      failed++;
    }
  }

  console.log(`\n✅ Backfill complete:`);
  console.log(`   Updated: ${updated}`);
  console.log(`   Failed: ${failed}`);

  // Show summary
  const summary = await client.query(
    `SELECT chain, COUNT(*) as total, COUNT(account_address) FILTER (WHERE account_address IS NOT NULL) as with_account
     FROM validators
     GROUP BY chain
     ORDER BY chain`
  );
  console.log('\n📊 Summary by chain:');
  summary.rows.forEach(row => {
    console.log(`   ${row.chain}: ${row.with_account}/${row.total} with account_address`);
  });

  if (transactionService.pgPool) await transactionService.pgPool.end();
}

backfillAccountAddresses().catch(async (err) => {
  console.error('Fatal error during account address backfill:', err);
  if (transactionService.pgPool) await transactionService.pgPool.end();
  process.exit(1);
});

