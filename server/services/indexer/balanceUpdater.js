/**
 * Balance Updater
 * Updates account balances and entity stakes based on Cosmos SDK events
 */

const { connectClients, pgPool } = require('./db');
const { identifyEntityType } = require('./entityIdentifier');

/**
 * Helper to parse uPOKT amount string to numeric
 */
function parseUpokt(upoktString) {
  if (!upoktString) return 0;
  const str = String(upoktString);
  // Handle format like "5214.000658256326821571upokt" or just "5214upokt"
  const match = str.match(/^(\d+(?:\.\d+)?)/);
  return match ? Math.floor(parseFloat(match[1])) : 0;
}

/**
 * Update account balance (works for ALL addresses - regular accounts + entities)
 * @param {string} address - Account address
 * @param {string} chain - Chain identifier
 * @param {number} amountDelta - Amount change (positive for credits, negative for debits)
 * @param {number} blockHeight - Block height
 * @param {string} timestamp - Timestamp
 * @returns {Promise<boolean>} Success status
 */
async function updateAccountBalance(address, chain, amountDelta, blockHeight, timestamp) {
  if (!address || !chain || amountDelta === undefined || amountDelta === null) {
    return false;
  }

  try {
    await connectClients();
    const client = pgPool;

    // Use incremental update with ON CONFLICT
    // For new records, insert the delta as initial balance (clamped to 0)
    // For existing records, add the delta to current balance (clamped to 0)
    await client.query(`
      INSERT INTO account_balances (address, chain, balance, updated_block_height, updated_timestamp)
      VALUES ($1, $2, GREATEST(0, $3), $4, $5)
      ON CONFLICT (address, chain) DO UPDATE SET
        balance = GREATEST(0, account_balances.balance + $3),
        updated_block_height = EXCLUDED.updated_block_height,
        updated_timestamp = EXCLUDED.updated_timestamp
    `, [
      address,
      chain,
      amountDelta, // Delta to add/subtract
      blockHeight,
      timestamp
    ]);

    return true;
  } catch (error) {
    console.error(`Error updating account balance for ${address}:${chain}:`, error);
    return false;
  }
}

/**
 * Update entity stake (only for entities - applications, suppliers, gateways)
 * @param {string} address - Entity address
 * @param {string} chain - Chain identifier
 * @param {number} stakeDelta - Stake change (positive for increases, negative for decreases)
 * @param {string|null} entityType - Entity type ('application', 'supplier', 'gateway') or null to auto-detect
 * @param {number} blockHeight - Block height
 * @param {string} timestamp - Timestamp
 * @returns {Promise<boolean>} Success status
 */
async function updateEntityBalance(address, chain, stakeDelta, entityType = null, blockHeight = null, timestamp = null) {
  if (!address || !chain || stakeDelta === undefined || stakeDelta === null) {
    return false;
  }

  // Identify entity type if not provided
  if (!entityType) {
    entityType = await identifyEntityType(address, chain);
  }

  // Only update stake if this is an actual entity
  if (!entityType) {
    // Regular account - no stake update needed
    return true;
  }

  try {
    await connectClients();
    const client = pgPool;

    // Update stake based on entity type
    switch (entityType) {
      case 'application':
        await client.query(`
          UPDATE applications
          SET staked_amount = GREATEST(0, staked_amount + $1),
              last_seen = COALESCE($2, last_seen)
          WHERE address = $3 AND chain = $4
        `, [stakeDelta, timestamp, address, chain]);
        break;

      case 'supplier':
        await client.query(`
          UPDATE suppliers
          SET staked_amount = GREATEST(0, staked_amount + $1),
              last_seen = COALESCE($2, last_seen)
          WHERE address = $3 AND chain = $4
        `, [stakeDelta, timestamp, address, chain]);
        break;

      case 'gateway':
        await client.query(`
          UPDATE gateways
          SET staked_amount = GREATEST(0, staked_amount + $1),
              last_seen = COALESCE($2, last_seen)
          WHERE address = $3 AND chain = $4
        `, [stakeDelta, timestamp, address, chain]);
        break;

      default:
        console.warn(`Unknown entity type: ${entityType} for address ${address}`);
        return false;
    }

    return true;
  } catch (error) {
    console.error(`Error updating entity stake for ${address}:${chain} (${entityType}):`, error);
    return false;
  }
}

/**
 * Update both account balance and entity stake in one call
 * @param {string} address - Address
 * @param {string} chain - Chain identifier
 * @param {number} amountDelta - Amount change for balance
 * @param {number} stakeDelta - Stake change (only applied if entity)
 * @param {string|null} entityType - Entity type or null to auto-detect
 * @param {number} blockHeight - Block height
 * @param {string} timestamp - Timestamp
 * @returns {Promise<{balanceUpdated: boolean, stakeUpdated: boolean}>}
 */
async function updateBalanceAndStake(address, chain, amountDelta, stakeDelta, entityType = null, blockHeight, timestamp) {
  const balanceUpdated = await updateAccountBalance(address, chain, amountDelta, blockHeight, timestamp);
  
  // Only update stake if stakeDelta is provided and non-zero
  let stakeUpdated = true;
  if (stakeDelta !== undefined && stakeDelta !== null && stakeDelta !== 0) {
    stakeUpdated = await updateEntityBalance(address, chain, stakeDelta, entityType, blockHeight, timestamp);
  }

  return { balanceUpdated, stakeUpdated };
}

module.exports = {
  updateAccountBalance,
  updateEntityBalance,
  updateBalanceAndStake,
  parseUpokt
};

