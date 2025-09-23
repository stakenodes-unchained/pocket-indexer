#!/usr/bin/env node

/**
 * Test script for production data processor
 * Tests the script with a small sample of data from local database
 */

const ProductionDataProcessor = require('./process_production_data');

async function testProductionScript() {
  console.log('🧪 Testing Production Data Processor with local database...\n');
  
  try {
    // Test with pocket-testnet-beta and optimized settings
    const processor = new ProductionDataProcessor({
      chain: 'pocket-testnet-beta',
      batchSize: 2000, // Larger batches for better performance
      limit: 50000, // Reduced limit for faster testing
      verbose: false,
      offset: 0 * 25 * 2000,
      saveResults: true,
      parseInParallel: true, // Enable parallel processing
      maxConcurrency: 15, // Higher concurrency for better throughput
      skipEmptyTransactions: true // Skip invalid transactions early
    });
    
    await processor.connect();
    await processor.processTransactions();
    await processor.disconnect();
    
    console.log('\n✅ Test completed successfully!');
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    process.exit(1);
  }
}

// Run the test
if (require.main === module) {
  testProductionScript();
}
