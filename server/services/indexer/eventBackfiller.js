/**
 * Event Backfiller
 * Backfills events from genesis to current block height
 */

const { connectClients, pgClient } = require('./db');
const { fetchBlockByHeight } = require('./rpc');
const { processBlockEvents } = require('./eventProcessor');

/**
 * Get the last processed event height
 */
async function getLastProcessedEventHeight(chain) {
  await connectClients();
  try {
    const result = await pgClient.query(`
      SELECT MAX(current_height) as last_height
      FROM event_processing_status
      WHERE status = 'completed'
      AND start_height = 0
    `);
    return result.rows[0]?.last_height || 0;
  } catch (error) {
    console.error('Error getting last processed event height:', error);
    return 0;
  }
}

/**
 * Create or update backfill status
 */
async function updateBackfillStatus(chain, startHeight, endHeight, currentHeight, status, eventsProcessed = 0, errorMessage = null) {
  await connectClients();
  try {
    await pgClient.query(`
      INSERT INTO event_processing_status (
        start_height,
        end_height,
        current_height,
        status,
        events_processed,
        started_at,
        completed_at,
        error_message,
        created_timestamp,
        updated_timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
      ON CONFLICT DO UPDATE SET
        current_height = EXCLUDED.current_height,
        status = EXCLUDED.status,
        events_processed = EXCLUDED.events_processed,
        completed_at = EXCLUDED.completed_at,
        error_message = EXCLUDED.error_message,
        updated_timestamp = NOW()
    `, [
      startHeight,
      endHeight,
      currentHeight,
      status,
      eventsProcessed,
      status === 'processing' ? new Date() : null,
      status === 'completed' ? new Date() : null,
      errorMessage
    ]);
  } catch (error) {
    console.error('Error updating backfill status:', error);
  }
}

/**
 * Backfill events for a range of blocks
 */
async function backfillEvents(chain, rpcUrl, startHeight, endHeight, batchSize = 100) {
  console.log(`Starting event backfill for chain ${chain} from height ${startHeight} to ${endHeight}`);
  
  let currentHeight = startHeight;
  let totalEventsProcessed = 0;
  let consecutiveErrors = 0;
  const maxConsecutiveErrors = 10;
  
  // Update status to processing
  await updateBackfillStatus(chain, startHeight, endHeight, currentHeight, 'processing', 0);
  
  while (currentHeight <= endHeight && consecutiveErrors < maxConsecutiveErrors) {
    const batchEnd = Math.min(currentHeight + batchSize - 1, endHeight);
    
    try {
      console.log(`Processing event backfill batch: ${currentHeight} to ${batchEnd}`);
      
      let batchEventsProcessed = 0;
      
      for (let height = currentHeight; height <= batchEnd; height++) {
        try {
          // Fetch block
          const blockData = await fetchBlockByHeight(height, rpcUrl);
          
          if (!blockData) {
            console.warn(`Block ${height} not found, skipping`);
            continue;
          }
          
          // Process events from block
          const results = await processBlockEvents(blockData, null, chain);
          batchEventsProcessed += results.length;
          
          // Small delay to prevent overwhelming RPC
          if (height % 10 === 0) {
            await new Promise(resolve => setTimeout(resolve, 50));
          }
        } catch (error) {
          console.error(`Error processing events for block ${height}:`, error.message);
          consecutiveErrors++;
          if (consecutiveErrors >= maxConsecutiveErrors) {
            throw new Error(`Too many consecutive errors (${consecutiveErrors})`);
          }
          // Continue with next block
          continue;
        }
      }
      
      totalEventsProcessed += batchEventsProcessed;
      currentHeight = batchEnd + 1;
      consecutiveErrors = 0; // Reset on success
      
      // Update progress
      await updateBackfillStatus(chain, startHeight, endHeight, currentHeight, 'processing', totalEventsProcessed);
      
      console.log(`Processed batch ${currentHeight - batchSize} to ${batchEnd}: ${batchEventsProcessed} events (total: ${totalEventsProcessed})`);
      
      // Small delay between batches
      await new Promise(resolve => setTimeout(resolve, 100));
      
    } catch (error) {
      consecutiveErrors++;
      console.error(`Error processing batch ${currentHeight} to ${batchEnd}:`, error.message);
      
      if (consecutiveErrors >= maxConsecutiveErrors) {
        // Mark as failed
        await updateBackfillStatus(
          chain,
          startHeight,
          endHeight,
          currentHeight,
          'failed',
          totalEventsProcessed,
          error.message
        );
        throw error;
      }
      
      // Skip this batch and continue
      currentHeight = batchEnd + 1;
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait before retry
    }
  }
  
  // Mark as completed
  await updateBackfillStatus(chain, startHeight, endHeight, currentHeight - 1, 'completed', totalEventsProcessed);
  
  console.log(`Event backfill completed: ${totalEventsProcessed} events processed from height ${startHeight} to ${currentHeight - 1}`);
  
  return {
    startHeight,
    endHeight: currentHeight - 1,
    eventsProcessed: totalEventsProcessed
  };
}

/**
 * Resume backfilling from last processed height
 */
async function resumeBackfill(chain, rpcUrl, targetHeight, batchSize = 100) {
  const lastHeight = await getLastProcessedEventHeight(chain);
  const startHeight = lastHeight + 1;
  
  if (startHeight > targetHeight) {
    console.log(`Event backfill already complete up to height ${lastHeight}`);
    return { startHeight: lastHeight, endHeight: lastHeight, eventsProcessed: 0 };
  }
  
  console.log(`Resuming event backfill from height ${startHeight} to ${targetHeight}`);
  return await backfillEvents(chain, rpcUrl, startHeight, targetHeight, batchSize);
}

/**
 * Get backfill progress
 */
async function getBackfillProgress(chain) {
  await connectClients();
  try {
    const result = await pgClient.query(`
      SELECT 
        start_height,
        end_height,
        current_height,
        status,
        events_processed,
        started_at,
        completed_at,
        error_message
      FROM event_processing_status
      WHERE start_height = 0
      ORDER BY created_timestamp DESC
      LIMIT 1
    `);
    
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error getting backfill progress:', error);
    return null;
  }
}

module.exports = {
  backfillEvents,
  resumeBackfill,
  getBackfillProgress,
  getLastProcessedEventHeight
};

