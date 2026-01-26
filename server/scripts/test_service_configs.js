#!/usr/bin/env node
/**
 * Test Service Configs Insertion
 * 
 * This script tests that the service_configs field is properly handled
 * by the upsertSupplier and upsertApplication functions
 */

const { upsertSupplier, upsertApplication } = require('../services/indexer/db');

async function testSupplierServiceConfigs() {
  console.log('Testing supplier service configs insertion...\n');
  
  const testSupplier = {
    operator_address: 'pokt1test_supplier_address_12345',
    staked_amount: '15000000000',
    stake_denom: 'upokt',
    chain: 'pocket-mainnet',
    status: 'staked',
    service_configs: [
      {
        service_id: 'anvil',
        endpoints: ['https://test1.example.com:443', 'https://test2.example.com:443'],
        config_options: {
          publicly_exposed_endpoints: ['https://public.example.com'],
          revshare_percent: 10
        }
      },
      {
        service_id: 'eth-mainnet',
        endpoints: ['https://eth1.example.com:443'],
        config_options: {
          publicly_exposed_endpoints: ['https://eth-public.example.com'],
          revshare_percent: 5
        }
      }
    ],
    last_seen: new Date().toISOString()
  };
  
  try {
    await upsertSupplier(testSupplier);
    console.log('✓ Supplier inserted successfully');
    console.log(`  Address: ${testSupplier.operator_address}`);
    console.log(`  Service configs: ${testSupplier.service_configs.length}`);
    
    // Query to verify
    const { pgPool } = require('../services/indexer/db');
    const result = await pgPool.query(
      'SELECT * FROM supplier_service_configs WHERE supplier_address = $1 AND chain = $2',
      [testSupplier.operator_address, testSupplier.chain]
    );
    
    console.log(`\n✓ Verified ${result.rows.length} service configs in database:`);
    result.rows.forEach(row => {
      console.log(`  - Service: ${row.service_id}`);
      console.log(`    Endpoints: ${row.endpoints.length}`);
      console.log(`    Config options: ${JSON.stringify(row.config_options)}`);
    });
    
    return true;
  } catch (error) {
    console.error('✗ Error testing supplier service configs:', error.message);
    return false;
  }
}

async function testApplicationServiceConfigs() {
  console.log('\n\nTesting application service configs insertion...\n');
  
  const testApplication = {
    address: 'pokt1test_application_address_12345',
    staked_amount: '10000000000',
    stake_denom: 'upokt',
    chain: 'pocket-mainnet',
    status: 'staked',
    chains: ['anvil', 'eth-mainnet'],
    service_configs: [
      {
        service_id: 'anvil',
        endpoints: ['https://app-test1.example.com:443'],
        config_options: {
          max_relays_per_session: 1000
        }
      },
      {
        service_id: 'eth-mainnet',
        endpoints: ['https://app-eth1.example.com:443'],
        config_options: {
          max_relays_per_session: 500
        }
      }
    ],
    last_seen: new Date().toISOString()
  };
  
  try {
    await upsertApplication(testApplication);
    console.log('✓ Application inserted successfully');
    console.log(`  Address: ${testApplication.address}`);
    console.log(`  Service configs: ${testApplication.service_configs.length}`);
    
    // Query to verify
    const { pgPool } = require('../services/indexer/db');
    const result = await pgPool.query(
      'SELECT * FROM application_service_configs WHERE application_address = $1 AND chain = $2',
      [testApplication.address, testApplication.chain]
    );
    
    console.log(`\n✓ Verified ${result.rows.length} service configs in database:`);
    result.rows.forEach(row => {
      console.log(`  - Service: ${row.service_id}`);
      console.log(`    Endpoints: ${row.endpoints.length}`);
      console.log(`    Config options: ${JSON.stringify(row.config_options)}`);
    });
    
    return true;
  } catch (error) {
    console.error('✗ Error testing application service configs:', error.message);
    return false;
  }
}

async function cleanup() {
  console.log('\n\nCleaning up test data...');
  
  try {
    const { pgPool } = require('../services/indexer/db');
    
    await pgPool.query(
      'DELETE FROM supplier_service_configs WHERE supplier_address = $1',
      ['pokt1test_supplier_address_12345']
    );
    
    await pgPool.query(
      'DELETE FROM suppliers WHERE address = $1',
      ['pokt1test_supplier_address_12345']
    );
    
    await pgPool.query(
      'DELETE FROM application_service_configs WHERE application_address = $1',
      ['pokt1test_application_address_12345']
    );
    
    await pgPool.query(
      'DELETE FROM applications WHERE address = $1',
      ['pokt1test_application_address_12345']
    );
    
    console.log('✓ Test data cleaned up');
  } catch (error) {
    console.error('✗ Error cleaning up:', error.message);
  }
}

async function runTests() {
  console.log('=== Service Configs Insertion Test ===\n');
  
  try {
    const supplierResult = await testSupplierServiceConfigs();
    const applicationResult = await testApplicationServiceConfigs();
    
    await cleanup();
    
    console.log('\n=== Test Summary ===');
    console.log(`Supplier test: ${supplierResult ? '✓ PASSED' : '✗ FAILED'}`);
    console.log(`Application test: ${applicationResult ? '✓ PASSED' : '✗ FAILED'}`);
    
    if (supplierResult && applicationResult) {
      console.log('\n✓ All tests passed!');
      process.exit(0);
    } else {
      console.log('\n✗ Some tests failed');
      process.exit(1);
    }
  } catch (error) {
    console.error('Error running tests:', error);
    process.exit(1);
  }
}

// Run tests if this is the main module
if (require.main === module) {
  runTests();
}

module.exports = { testSupplierServiceConfigs, testApplicationServiceConfigs };

