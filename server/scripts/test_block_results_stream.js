#!/usr/bin/env node
'use strict';

/**
 * Test script for processing large block results using stream-json
 * This script tests whether we can parse block results that exceed Node.js string length limits
 * 
 * Usage:
 *   node test_block_results_stream.js --height 609273
 *   node test_block_results_stream.js --height 609273 --rpc-url https://pocket-mainnet-rpc.pn.stakenodes.org
 *   node test_block_results_stream.js --height 609273 --process-events
 *   node test_block_results_stream.js --height 609273 --output full
 */

const dotenv = require('dotenv');
dotenv.config();

const { Readable } = require('stream');
const { chain } = require('stream-chain');
const { parser } = require('stream-json');
const { streamValues } = require('stream-json/streamers/StreamValues');
const { getRpcEndpoints } = require('../config/rpc');

// Parse command-line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    height: null,
    rpcUrl: null,
    processEvents: false,
    output: 'stats'
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--height' || arg === '-h') {
      config.height = parseInt(args[++i], 10);
      if (isNaN(config.height)) {
        console.error('Error: --height must be a valid number');
        process.exit(1);
      }
    } else if (arg === '--rpc-url') {
      config.rpcUrl = args[++i];
    } else if (arg === '--process-events') {
      config.processEvents = true;
    } else if (arg === '--output') {
      config.output = args[++i];
      if (!['stats', 'summary', 'full'].includes(config.output)) {
        console.error('Error: --output must be one of: stats, summary, full');
        process.exit(1);
      }
    } else if (arg === '--help') {
      console.log(`
Usage: node test_block_results_stream.js [options]

Options:
  --height, -h <number>        Block height to test (required)
  --rpc-url <url>              Block results RPC URL (optional, defaults to env config)
  --process-events             Also process events like the worker does (optional)
  --output <format>            Output format: stats (default), summary, or full
  --help                       Show this help message

Examples:
  node test_block_results_stream.js --height 609273
  node test_block_results_stream.js --height 609273 --rpc-url https://pocket-mainnet-rpc.pn.stakenodes.org
  node test_block_results_stream.js --height 609273 --process-events
  node test_block_results_stream.js --height 609273 --output full
`);
      process.exit(0);
    }
  }

  if (!config.height) {
    console.error('Error: --height is required');
    console.error('Use --help for usage information');
    process.exit(1);
  }

  return config;
}

/**
 * Fetch block results using streaming JSON parser
 */
async function fetchBlockResultsStreaming(height, rpcUrl) {
  const url = `${rpcUrl}/block_results?height=${height}`;
  console.log(`Fetching block results from: ${url}`);
  
  const startTime = Date.now();
  let contentLength = null;
  let responseSize = 0;
  
  try {
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    // Get Content-Length header if available
    contentLength = response.headers.get('content-length');
    if (contentLength) {
      const sizeMB = (parseInt(contentLength, 10) / 1024 / 1024).toFixed(2);
      console.log(`Content-Length: ${contentLength} bytes (${sizeMB} MB)`);
    }
    
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
    
    const fetchTime = Date.now() - startTime;
    const actualSizeMB = (responseSize / 1024 / 1024).toFixed(2);
    
    console.log(`Successfully parsed block results in ${fetchTime}ms`);
    console.log(`Actual response size: ${responseSize} bytes (${actualSizeMB} MB)`);
    
    return {
      data: parsedData,
      fetchTime,
      contentLength: contentLength ? parseInt(contentLength, 10) : null,
      actualSize: responseSize,
      success: true
    };
    
  } catch (error) {
    const fetchTime = Date.now() - startTime;
    console.error(`Error fetching/parsing block results: ${error.message}`);
    return {
      data: null,
      fetchTime,
      contentLength,
      actualSize: responseSize,
      success: false,
      error: error.message
    };
  }
}

/**
 * Calculate statistics from parsed block results
 */
function calculateStatistics(blockResultsData) {
  if (!blockResultsData || !blockResultsData.result) {
    return null;
  }
  
  const result = blockResultsData.result;
  
  const stats = {
    height: parseInt(result.height || '0', 10),
    txsCount: result.txs_results?.length || 0,
    finalizeBlockEventsCount: result.finalize_block_events?.length || 0,
    beginBlockEventsCount: result.begin_block_events?.length || 0,
    endBlockEventsCount: result.end_block_events?.length || 0,
    totalTxEvents: 0,
    eventTypes: {}
  };
  
  // Count transaction events
  if (result.txs_results && Array.isArray(result.txs_results)) {
    for (const txResult of result.txs_results) {
      if (txResult.events && Array.isArray(txResult.events)) {
        stats.totalTxEvents += txResult.events.length;
        
        // Count event types
        for (const event of txResult.events) {
          const type = event.type || 'unknown';
          stats.eventTypes[type] = (stats.eventTypes[type] || 0) + 1;
        }
      }
    }
  }
  
  return stats;
}

/**
 * Output results in the requested format
 */
function outputResults(result, format) {
  console.log('\n' + '='.repeat(80));
  console.log('RESULTS');
  console.log('='.repeat(80));
  
  if (!result.success) {
    console.log(`Status: FAILED`);
    console.log(`Error: ${result.error}`);
    console.log(`Fetch time: ${result.fetchTime}ms`);
    return;
  }
  
  const stats = calculateStatistics(result.data);
  
  if (format === 'full') {
    console.log(`Status: SUCCESS`);
    console.log(`Fetch time: ${result.fetchTime}ms`);
    if (result.contentLength) {
      console.log(`Content-Length: ${result.contentLength} bytes (${(result.contentLength / 1024 / 1024).toFixed(2)} MB)`);
    }
    console.log(`Actual size: ${result.actualSize} bytes (${(result.actualSize / 1024 / 1024).toFixed(2)} MB)`);
    
    if (stats) {
      console.log(`\nBlock Statistics:`);
      console.log(`  Height: ${stats.height}`);
      console.log(`  Transactions: ${stats.txsCount}`);
      console.log(`  Transaction Events: ${stats.totalTxEvents}`);
      console.log(`  Begin Block Events: ${stats.beginBlockEventsCount}`);
      console.log(`  End Block Events: ${stats.endBlockEventsCount}`);
      console.log(`  Finalize Block Events: ${stats.finalizeBlockEventsCount}`);
      
      if (Object.keys(stats.eventTypes).length > 0) {
        console.log(`\nEvent Types:`);
        const sortedTypes = Object.entries(stats.eventTypes)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 20); // Top 20
        for (const [type, count] of sortedTypes) {
          console.log(`  ${type}: ${count}`);
        }
      }
    }
    
    // Memory usage (approximate)
    const memUsage = process.memoryUsage();
    console.log(`\nMemory Usage:`);
    console.log(`  RSS: ${(memUsage.rss / 1024 / 1024).toFixed(2)} MB`);
    console.log(`  Heap Used: ${(memUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`);
    console.log(`  Heap Total: ${(memUsage.heapTotal / 1024 / 1024).toFixed(2)} MB`);
    
  } else if (format === 'summary') {
    console.log(`Status: SUCCESS`);
    console.log(`Fetch time: ${result.fetchTime}ms`);
    if (result.contentLength) {
      console.log(`Size: ${(result.contentLength / 1024 / 1024).toFixed(2)} MB`);
    }
    
    if (stats) {
      console.log(`Height: ${stats.height}`);
      console.log(`Transactions: ${stats.txsCount}`);
      console.log(`Total Events: ${stats.totalTxEvents + stats.beginBlockEventsCount + stats.endBlockEventsCount + stats.finalizeBlockEventsCount}`);
    }
    
  } else { // stats (default)
    console.log(`Status: ${result.success ? 'SUCCESS' : 'FAILED'}`);
    console.log(`Fetch time: ${result.fetchTime}ms`);
    
    if (result.contentLength) {
      const sizeMB = (result.contentLength / 1024 / 1024).toFixed(2);
      console.log(`Size: ${sizeMB} MB`);
    }
    
    if (stats) {
      console.log(`Height: ${stats.height}`);
      console.log(`Transactions: ${stats.txsCount}`);
      console.log(`Tx Events: ${stats.totalTxEvents}`);
      console.log(`Block Events: ${stats.beginBlockEventsCount + stats.endBlockEventsCount + stats.finalizeBlockEventsCount}`);
    }
  }
  
  console.log('='.repeat(80));
}

/**
 * Process events if requested
 */
async function processEventsIfRequested(blockResultsData, height, processEvents) {
  if (!processEvents || !blockResultsData || !blockResultsData.result) {
    return null;
  }
  
  try {
    console.log('\nProcessing events...');
    const { extractEventsFromBlock } = require('../services/indexer/eventExtractor');
    const { processBlockEvents } = require('../services/indexer/eventProcessor');
    
    // Create minimal block data structure
    const blockData = {
      block: {
        header: {
          height: height.toString(),
          time: new Date().toISOString()
        }
      }
    };
    
    const eventStartTime = Date.now();
    const results = await processBlockEvents(blockData, blockResultsData, 'pocket-mainnet');
    const eventTime = Date.now() - eventStartTime;
    
    const successCount = results.filter(r => r?.success).length;
    const failedCount = results.filter(r => !r?.success).length;
    
    console.log(`Event processing completed in ${eventTime}ms`);
    console.log(`  Total events: ${results.length}`);
    console.log(`  Successful: ${successCount}`);
    console.log(`  Failed: ${failedCount}`);
    
    return {
      totalEvents: results.length,
      successCount,
      failedCount,
      processingTime: eventTime
    };
    
  } catch (error) {
    console.error(`Error processing events: ${error.message}`);
    return {
      error: error.message
    };
  }
}

/**
 * Main function
 */
async function main() {
  const config = parseArgs();
  
  // Determine RPC URL
  let rpcUrl = config.rpcUrl;
  if (!rpcUrl) {
    const endpoints = getRpcEndpoints();
    const mainnetEndpoint = endpoints.find(e => e.name === 'pocket-mainnet');
    if (mainnetEndpoint && mainnetEndpoint.blockResultsUrl) {
      rpcUrl = mainnetEndpoint.blockResultsUrl;
    } else if (endpoints.length > 0 && endpoints[0].blockResultsUrl) {
      rpcUrl = endpoints[0].blockResultsUrl;
    } else {
      // Default fallback
      rpcUrl = 'https://pocket-mainnet-rpc.pn.stakenodes.org';
    }
  }
  
  console.log(`Testing block results streaming for height ${config.height}`);
  console.log(`RPC URL: ${rpcUrl}`);
  console.log(`Process events: ${config.processEvents}`);
  console.log(`Output format: ${config.output}`);
  console.log('');
  
  // Fetch and parse block results
  const result = await fetchBlockResultsStreaming(config.height, rpcUrl);
  
  // Process events if requested
  let eventResults = null;
  if (config.processEvents && result.success) {
    eventResults = await processEventsIfRequested(result.data, config.height, config.processEvents);
  }
  
  // Output results
  outputResults(result, config.output);
  
  if (eventResults && !eventResults.error) {
    console.log(`\nEvent Processing:`);
    console.log(`  Total: ${eventResults.totalEvents}`);
    console.log(`  Successful: ${eventResults.successCount}`);
    console.log(`  Failed: ${eventResults.failedCount}`);
    console.log(`  Time: ${eventResults.processingTime}ms`);
  }
  
  // Exit with appropriate code
  process.exit(result.success ? 0 : 1);
}

// Run the script
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

