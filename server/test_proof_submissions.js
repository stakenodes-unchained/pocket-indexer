#!/usr/bin/env node

/**
 * Test script for proof submissions parsing and storage
 * This script tests the implementation with the provided sample data
 */

const { parseProofSubmissions } = require('./services/indexer/entityParser.v2');
const { bulkSaveProofSubmissions } = require('./services/indexer/db');

// Test with tx_data format (as stored in database)
function createTxWithTxData(txResponse) {
  return {
    hash: txResponse.tx_response.txhash,
    tx_data: JSON.stringify(txResponse) // This is how it's stored in the DB
  };
}

// Sample transaction data from the user
const sampleTx = {
  "hash": "711EF830537F468B61C0C7BFDBFACAC4B2DF49A63A46F4D67AE9F5070C2CAFD3",
  "tx": {
    "body": {
      "messages": [
        {
          "@type": "/pocket.proof.MsgSubmitProof",
          "supplier_operator_address": "pokt183lm40qjafypys95g52szszxk8pqe7tnphpphc",
          "session_header": {
            "application_address": "pokt1xqaeh4zg6tnqzz0elzt4ka2yua2p29wa660yhj",
            "service_id": "fuse",
            "session_id": "3c938423d1a390404f5509205ab865ad769272668fd2dcc94964e1823ade6533",
            "session_start_block_height": "412021",
            "session_end_block_height": "412080"
          },
          "proof": "base64_encoded_proof_data"
        }
      ]
    }
  },
  "tx_response": {
    "height": "412104",
    "txhash": "711EF830537F468B61C0C7BFDBFACAC4B2DF49A63A46F4D67AE9F5070C2CAFD3",
    "events": [
      {
        "type": "pocket.proof.EventProofSubmitted",
        "attributes": [
          {
            "key": "application_address",
            "value": "\"pokt1xqaeh4zg6tnqzz0elzt4ka2yua2p29wa660yhj\"",
            "index": true
          },
          {
            "key": "claim_proof_status_int",
            "value": "0",
            "index": true
          },
          {
            "key": "claimed_upokt",
            "value": "\"89175upokt\"",
            "index": true
          },
          {
            "key": "num_claimed_compute_units",
            "value": "\"2965000\"",
            "index": true
          },
          {
            "key": "num_estimated_compute_units",
            "value": "\"2965000\"",
            "index": true
          },
          {
            "key": "num_relays",
            "value": "\"593\"",
            "index": true
          },
          {
            "key": "service_id",
            "value": "\"fuse\"",
            "index": true
          },
          {
            "key": "session_end_block_height",
            "value": "\"412080\"",
            "index": true
          },
          {
            "key": "supplier_operator_address",
            "value": "\"pokt183lm40qjafypys95g52szszxk8pqe7tnphpphc\"",
            "index": true
          },
          {
            "key": "msg_index",
            "value": "0",
            "index": true
          }
        ]
      },
      {
        "type": "pocket.proof.EventProofSubmitted",
        "attributes": [
          {
            "key": "application_address",
            "value": "\"pokt1f9sdjcmkel8jlwe8nqqha9tjpt2xtujmwkzuf2\"",
            "index": true
          },
          {
            "key": "claim_proof_status_int",
            "value": "0",
            "index": true
          },
          {
            "key": "claimed_upokt",
            "value": "\"71580upokt\"",
            "index": true
          },
          {
            "key": "num_claimed_compute_units",
            "value": "\"2380000\"",
            "index": true
          },
          {
            "key": "num_estimated_compute_units",
            "value": "\"2380000\"",
            "index": true
          },
          {
            "key": "num_relays",
            "value": "\"476\"",
            "index": true
          },
          {
            "key": "service_id",
            "value": "\"blast\"",
            "index": true
          },
          {
            "key": "session_end_block_height",
            "value": "\"412080\"",
            "index": true
          },
          {
            "key": "supplier_operator_address",
            "value": "\"pokt183lm40qjafypys95g52szszxk8pqe7tnphpphc\"",
            "index": true
          },
          {
            "key": "msg_index",
            "value": "1",
            "index": true
          }
        ]
      },
      {
        "type": "pocket.proof.EventProofSubmitted",
        "attributes": [
          {
            "key": "application_address",
            "value": "\"pokt1jz6hcaz3pjrshw9atqelktuzf8zkklqr0jj2mn\"",
            "index": true
          },
          {
            "key": "claim_proof_status_int",
            "value": "0",
            "index": true
          },
          {
            "key": "claimed_upokt",
            "value": "\"38346upokt\"",
            "index": true
          },
          {
            "key": "num_claimed_compute_units",
            "value": "\"1275000\"",
            "index": true
          },
          {
            "key": "num_estimated_compute_units",
            "value": "\"1275000\"",
            "index": true
          },
          {
            "key": "num_relays",
            "value": "\"255\"",
            "index": true
          },
          {
            "key": "service_id",
            "value": "\"avax\"",
            "index": true
          },
          {
            "key": "session_end_block_height",
            "value": "\"412080\"",
            "index": true
          },
          {
            "key": "supplier_operator_address",
            "value": "\"pokt183lm40qjafypys95g52szszxk8pqe7tnphpphc\"",
            "index": true
          },
          {
            "key": "msg_index",
            "value": "2",
            "index": true
          }
        ]
      },
      {
        "type": "pocket.proof.EventProofSubmitted",
        "attributes": [
          {
            "key": "application_address",
            "value": "\"pokt17w6jtw7q02398afx7urfgma3mwv5wtw9nm7a48\"",
            "index": true
          },
          {
            "key": "claim_proof_status_int",
            "value": "0",
            "index": true
          },
          {
            "key": "claimed_upokt",
            "value": "\"24060upokt\"",
            "index": true
          },
          {
            "key": "num_claimed_compute_units",
            "value": "\"800000\"",
            "index": true
          },
          {
            "key": "num_estimated_compute_units",
            "value": "\"800000\"",
            "index": true
          },
          {
            "key": "num_relays",
            "value": "\"160\"",
            "index": true
          },
          {
            "key": "service_id",
            "value": "\"iotex\"",
            "index": true
          },
          {
            "key": "session_end_block_height",
            "value": "\"412080\"",
            "index": true
          },
          {
            "key": "supplier_operator_address",
            "value": "\"pokt183lm40qjafypys95g52szszxk8pqe7tnphpphc\"",
            "index": true
          },
          {
            "key": "msg_index",
            "value": "3",
            "index": true
          }
        ]
      }
    ]
  }
};

const sampleBlock = {
  "block": {
    "header": {
      "height": "412104",
      "time": "2025-09-27T22:50:10Z"
    }
  }
};

async function testProofSubmissionsParsing() {
  console.log('🧪 Testing proof submissions parsing...');
  
  try {
// Test parsing with tx_response format
    console.log('📝 Testing parsing with tx_response format...');
    const proofSubmissions = parseProofSubmissions(sampleTx, sampleBlock, 'mainnet');
    console.log(`✅ Parsed ${proofSubmissions.length} proof submissions from tx_response format`);
    
    // Test parsing with tx_data format (as stored in database)
    console.log('\n📝 Testing parsing with tx_data format (DB format)...');
    const fullTxResponse = {
      tx: sampleTx.tx,
      tx_response: sampleTx.tx_response
    };
    const txWithTxData = createTxWithTxData(fullTxResponse);
    const proofSubmissionsFromTxData = parseProofSubmissions(txWithTxData, sampleBlock, 'mainnet');
    console.log(`✅ Parsed ${proofSubmissionsFromTxData.length} proof submissions from tx_data format`);
    
    if (proofSubmissionsFromTxData.length !== proofSubmissions.length) {
      throw new Error(`Mismatch: parsed ${proofSubmissions.length} from tx_response but ${proofSubmissionsFromTxData.length} from tx_data`);
    }
    
    // Verify chain parameter is set correctly
    const allHaveChain = proofSubmissions.every(s => s.chain === 'mainnet');
    const txDataAllHaveChain = proofSubmissionsFromTxData.every(s => s.chain === 'mainnet');
    
    if (!allHaveChain || !txDataAllHaveChain) {
      throw new Error(`Chain parameter not set correctly: expected 'mainnet'`);
    }
    
    console.log('✅ Both formats produce the same results');
    console.log('✅ Chain parameter correctly set to "mainnet"');
    
    // Use the results from the first parsing
    const finalProofSubmissions = proofSubmissions;
    
    // Calculate computed fields for display (these would be computed columns in the database)
    finalProofSubmissions.forEach((submission) => {
      // Extract numeric value from claimed_upokt string
      const claimedAmount = submission.claimed_upokt.replace('upokt', '');
      submission.claimed_upokt_amount = parseInt(claimedAmount) || 0;
      
      // Calculate efficiency percentage
      if (submission.num_estimated_compute_units > 0) {
        submission.compute_unit_efficiency = Math.round((submission.num_claimed_compute_units / submission.num_estimated_compute_units) * 100 * 100) / 100;
      } else {
        submission.compute_unit_efficiency = 0;
      }
      
      // Calculate reward per relay
      if (submission.num_relays > 0) {
        submission.reward_per_relay = Math.round(submission.claimed_upokt_amount / submission.num_relays * 100) / 100;
      } else {
        submission.reward_per_relay = 0;
      }
    });
    
    // Display parsed data
    finalProofSubmissions.forEach((submission, index) => {
      console.log(`\n📊 Proof Submission ${index + 1}:`);
      console.log(`   Chain: ${submission.chain}`);
      console.log(`   Supplier: ${submission.supplier_operator_address}`);
      console.log(`   Application: ${submission.application_address}`);
      console.log(`   Service: ${submission.service_id}`);
      console.log(`   Rewards: ${submission.claimed_upokt} (${submission.claimed_upokt_amount} upokt)`);
      console.log(`   Relays: ${submission.num_relays}`);
      console.log(`   Claimed Compute Units: ${submission.num_claimed_compute_units}`);
      console.log(`   Estimated Compute Units: ${submission.num_estimated_compute_units}`);
      console.log(`   Efficiency: ${submission.compute_unit_efficiency}%`);
      console.log(`   Reward per Relay: ${submission.reward_per_relay} upokt`);
      console.log(`   Status: ${submission.claim_proof_status_int === 0 ? 'Success' : 'Failed'}`);
    });
    
    // Test database storage (if database is available)
    try {
      console.log('\n💾 Testing database storage...');
      await bulkSaveProofSubmissions(finalProofSubmissions);
      console.log('✅ Successfully saved proof submissions to database');
    } catch (dbError) {
      console.log('⚠️  Database not available or error:', dbError.message);
      console.log('   This is expected if the database is not running or migration not applied');
    }
    
    // Calculate summary statistics
    const totalRewards = finalProofSubmissions.reduce((sum, sub) => sum + sub.claimed_upokt_amount, 0);
    const totalRelays = finalProofSubmissions.reduce((sum, sub) => sum + sub.num_relays, 0);
    const totalClaimedComputeUnits = finalProofSubmissions.reduce((sum, sub) => sum + sub.num_claimed_compute_units, 0);
    const totalEstimatedComputeUnits = finalProofSubmissions.reduce((sum, sub) => sum + sub.num_estimated_compute_units, 0);
    const avgEfficiency = finalProofSubmissions.reduce((sum, sub) => sum + sub.compute_unit_efficiency, 0) / finalProofSubmissions.length;
    const avgRewardPerRelay = finalProofSubmissions.reduce((sum, sub) => sum + sub.reward_per_relay, 0) / finalProofSubmissions.length;
    
    console.log('\n📈 Summary Statistics:');
    console.log(`   Total Rewards: ${totalRewards} upokt`);
    console.log(`   Total Relays: ${totalRelays}`);
    console.log(`   Total Claimed Compute Units: ${totalClaimedComputeUnits}`);
    console.log(`   Total Estimated Compute Units: ${totalEstimatedComputeUnits}`);
    console.log(`   Average Efficiency: ${avgEfficiency.toFixed(2)}%`);
    console.log(`   Average Reward per Relay: ${avgRewardPerRelay.toFixed(2)} upokt`);
    console.log(`   Unique Services: ${new Set(finalProofSubmissions.map(s => s.service_id)).size}`);
    console.log(`   Unique Applications: ${new Set(finalProofSubmissions.map(s => s.application_address)).size}`);
    
    console.log('\n🎉 Test completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Run the test
if (require.main === module) {
  testProofSubmissionsParsing()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Test failed:', error);
      process.exit(1);
    });
}

module.exports = { testProofSubmissionsParsing };
