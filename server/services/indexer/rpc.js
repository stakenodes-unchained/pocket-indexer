const { Readable } = require('stream');
const { chain } = require('stream-chain');
const { parser } = require('stream-json');
const { streamValues } = require('stream-json/streamers/StreamValues');

// RPC retry configuration
const RPC_RETRY_CONFIG = {
  maxRetries: 5,
  retryDelay: 5000, // 5 seconds
  finalWaitTime: 30000, // 30 seconds after max retries
  timeout: 300000, // 5 minutes timeout for each request
};

// Node.js maximum string length (approximately 536MB)
const MAX_STRING_LENGTH = 0x1fffffe8;
const LARGE_RESPONSE_THRESHOLD_MB = 400; // Warn if response exceeds this size

/**
 * Parse JSON from response using streaming parser to handle large responses
 * This avoids Node.js string length limit errors for responses > 536MB
 * @param {Response} response - Fetch response object
 * @returns {Promise<any>} - Parsed JSON object
 */
async function parseJsonStreaming(response) {
  const startTime = Date.now();
  let responseSize = 0;
  
  // Check Content-Length header if available
  const contentLength = response.headers.get('content-length');
  if (contentLength) {
    const sizeBytes = parseInt(contentLength, 10);
    const sizeMB = sizeBytes / 1024 / 1024;
    
    if (sizeMB > LARGE_RESPONSE_THRESHOLD_MB) {
      console.warn(`Large response detected: ${sizeMB.toFixed(2)}MB (using streaming parser)`);
    }
    
    if (sizeBytes > MAX_STRING_LENGTH) {
      throw new Error(
        `Response size (${sizeMB.toFixed(2)}MB) exceeds Node.js maximum string length ` +
        `(${(MAX_STRING_LENGTH / 1024 / 1024).toFixed(2)}MB). Cannot safely parse this response.`
      );
    }
  }
  
  try {
    // Convert response body to a readable stream
    // In Node.js, response.body is a ReadableStream (web streams API)
    const reader = response.body.getReader();
    
    // Create a Node.js Readable stream from the fetch response
    const readableStream = new Readable({
      objectMode: false, // Binary mode
      async read() {
        try {
          const { done, value } = await reader.read();
          if (done) {
            this.push(null); // End of stream
          } else {
            // value is a Uint8Array, convert to Buffer for Node.js streams
            responseSize += value.length;
            this.push(Buffer.from(value));
          }
        } catch (error) {
          this.destroy(error);
        }
      }
    });
    
    // Parse JSON using stream-json
    // Use streamValues which works for both objects and arrays
    // For a single JSON object, it will emit the entire object as one value
    let parsedData = null;
    let parseError = null;
    
    const pipeline = chain([
      readableStream,
      parser(),
      streamValues()
    ]);
    
    // Collect the parsed JSON object/array
    await new Promise((resolve, reject) => {
      pipeline.on('data', (data) => {
        // streamValues emits {key, value} for objects or {value} for arrays
        // For a single object at root, we get one data event with the full object
        if (data && data.value !== undefined) {
          parsedData = data.value;
        } else if (data && typeof data === 'object' && !parsedData) {
          // Fallback: if we get the object directly
          parsedData = data;
        }
      });
      
      pipeline.on('end', () => {
        resolve();
      });
      
      pipeline.on('error', (error) => {
        parseError = error;
        reject(error);
      });
    });
    
    if (parseError) {
      throw parseError;
    }
    
    if (!parsedData) {
      throw new Error('Failed to parse JSON - no data received');
    }
    
    const parseTime = Date.now() - startTime;
    if (contentLength) {
      const sizeMB = (responseSize / 1024 / 1024).toFixed(2);
      console.log(`Streaming parser: parsed ${sizeMB}MB in ${parseTime}ms`);
    }
    
    return parsedData;
    
  } catch (error) {
    // If it's the string length error, provide a clearer message
    if (error.message.includes('Cannot create a string longer than') || 
        error.message.includes('0x1fffffe8')) {
      throw new Error(
        `Response too large to process: exceeds Node.js maximum string length. ` +
        `Consider using a streaming parser or processing the response in chunks. ` +
        `Original error: ${error.message}`
      );
    }
    // Re-throw other errors
    throw error;
  }
}

/**
 * Retry mechanism for RPC requests with exponential backoff
 * @param {Function} requestFn - The request function to retry
 * @param {string} operationName - Name of the operation for logging
 * @param {Object} options - Optional configuration
 * @param {boolean} options.useStreaming - Use streaming JSON parser (default: false)
 * @returns {Promise<any>} - The response from the request
 */
async function retryRequest(requestFn, operationName, options = {}) {
  const { maxRetries, retryDelay, finalWaitTime, timeout } = RPC_RETRY_CONFIG;
  const { useStreaming = false } = options;
  
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      console.log(`${operationName}: Attempt ${attempt}/${maxRetries + 1}${useStreaming ? ' (streaming)' : ''}`);
      
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
      
      // Success - parse JSON response (streaming or regular)
      console.log(`${operationName}: Success on attempt ${attempt}`);
      return useStreaming ? await parseJsonStreaming(response) : response.json();
      
    } catch (error) {
      // Handle string length errors specifically - don't retry, these will always fail
      if (error.message.includes('Cannot create a string longer than') || 
          error.message.includes('0x1fffffe8') ||
          error.message.includes('exceeds Node.js maximum string length') ||
          error.message.includes('Response too large')) {
        console.error(`${operationName}: Response too large to process: ${error.message}`);
        // Don't retry for size errors - they will always fail
        throw error;
      }
      
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
      `Fetch block results ${height}`,
      { useStreaming: true } // Enable streaming parser for block results to handle large responses
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