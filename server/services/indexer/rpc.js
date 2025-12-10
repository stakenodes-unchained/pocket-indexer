// RPC retry configuration
const RPC_RETRY_CONFIG = {
  maxRetries: 5,
  retryDelay: 5000, // 5 seconds
  finalWaitTime: 30000, // 30 seconds after max retries
  timeout: 30000, // 30 seconds timeout for each request
};

/**
 * Retry mechanism for RPC requests with exponential backoff
 * @param {Function} requestFn - The request function to retry
 * @param {string} operationName - Name of the operation for logging
 * @returns {Promise<any>} - The response from the request
 */
async function retryRequest(requestFn, operationName) {
  const { maxRetries, retryDelay, finalWaitTime, timeout } = RPC_RETRY_CONFIG;
  
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      console.log(`${operationName}: Attempt ${attempt}/${maxRetries + 1}`);
      
      const response = await Promise.race([
        requestFn(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Request timeout')), timeout)
        )
      ]);
      
      // If we get a 503, we need to retry
      if (response.status === 503) {
        if (attempt <= maxRetries) {
          console.warn(`${operationName}: Got 503 error, retrying in ${retryDelay/1000} seconds (attempt ${attempt}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          continue;
        } else {
          console.error(`${operationName}: Max retries (${maxRetries}) reached for 503 error, waiting ${finalWaitTime/1000} seconds before next attempt`);
          await new Promise(resolve => setTimeout(resolve, finalWaitTime));
          // Reset attempt counter to try again after the wait
          attempt = 0;
          continue;
        }
      }
      
      // For any other error status, throw immediately
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      // Success - return the JSON response
      console.log(`${operationName}: Success on attempt ${attempt}`);
      return response.json();
      
    } catch (error) {
      // If it's a 503 error and we haven't exceeded max retries
      if (error.message.includes('503') && attempt <= maxRetries) {
        console.warn(`${operationName}: Got 503 error, retrying in ${retryDelay/1000} seconds (attempt ${attempt}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
        continue;
      }
      
      // If we've exceeded max retries for 503, wait 30 seconds and reset
      if (error.message.includes('503') && attempt > maxRetries) {
        console.error(`${operationName}: Max retries (${maxRetries}) reached for 503 error, waiting ${finalWaitTime/1000} seconds before next attempt`);
        await new Promise(resolve => setTimeout(resolve, finalWaitTime));
        // Reset attempt counter to try again after the wait
        attempt = 0;
        continue;
      }
      
      // For timeout errors, retry with exponential backoff
      if (error.message.includes('timeout') && attempt <= maxRetries) {
        const timeoutDelay = retryDelay * Math.pow(2, attempt - 1); // Exponential backoff
        console.warn(`${operationName}: Request timeout, retrying in ${timeoutDelay/1000} seconds (attempt ${attempt}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, timeoutDelay));
        continue;
      }
      
      // For network errors (ECONNREFUSED, ENOTFOUND, etc.), retry
      if ((error.code === 'ECONNREFUSED' || 
           error.code === 'ENOTFOUND' || 
           error.code === 'ECONNRESET' ||
           error.code === 'ETIMEDOUT' ||
           error.message.includes('fetch')) && attempt <= maxRetries) {
        const networkDelay = retryDelay * Math.pow(2, attempt - 1); // Exponential backoff
        console.warn(`${operationName}: Network error (${error.code || 'unknown'}), retrying in ${networkDelay/1000} seconds (attempt ${attempt}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, networkDelay));
        continue;
      }
      
      // For any other error, throw immediately
      console.error(`${operationName}: Failed after ${attempt} attempts:`, error.message);
      throw error;
    }
  }
}

async function fetchBlockByHeight(height, rpcUrl) {
  try {
    return await retryRequest(
      () => fetch(`${rpcUrl}/cosmos/base/tendermint/v1beta1/blocks/${height}`),
      `Fetch block ${height}`
    );
  } catch (error) {
    throw new Error(`Error fetching block ${height}: ${error.message}`);
  }
}

async function fetchLatestBlock(rpcUrl) {
  try {
    return await retryRequest(
      () => fetch(`${rpcUrl}/cosmos/base/tendermint/v1beta1/blocks/latest`),
      'Fetch latest block'
    );
  } catch (error) {
    throw new Error(`Error fetching latest block: ${error.message}`);
  }
}

async function fetchTransactionByHash(txHash, rpcUrl) {
  try {
    return await retryRequest(
      () => fetch(`${rpcUrl}/cosmos/tx/v1beta1/txs/${txHash}`),
      `Fetch transaction ${txHash}`
    );
  } catch (error) {
    throw new Error(`Error fetching transaction ${txHash}: ${error.message}`);
  }
}

async function fetchBlockResultsByHeight(height, rpcUrl) {
  try {
    return await retryRequest(
      () => fetch(`${rpcUrl}/block_results?height=${height}`),
      `Fetch block results ${height}`
    );
  } catch (error) {
    throw new Error(`Error fetching block results ${height}: ${error.message}`);
  }
}

module.exports = {
  fetchBlockByHeight,
  fetchLatestBlock,
  fetchTransactionByHash,
  fetchBlockResultsByHeight,
  RPC_RETRY_CONFIG,
}; 