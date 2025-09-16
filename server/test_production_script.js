#!/usr/bin/env node

/**
 * Test script for production data processor
 * Tests the script with a small sample of data from local database
 */

const ProductionDataProcessor = require('./process_production_data');

async function testProductionScript() {
  console.log('🧪 Testing Production Data Processor with local database...\n');
  
  try {
    // Test with pocket-testnet-beta and a small limit
    const processor = new ProductionDataProcessor({
      chain: 'pocket-testnet-beta',
      batchSize: 1000,
      limit: 1700000,
      verbose: true,
      saveResults: true
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
