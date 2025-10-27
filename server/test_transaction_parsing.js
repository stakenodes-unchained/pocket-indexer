#!/usr/bin/env node

/**
 * Test parsing a real transaction from the database
 */

const { parseProofSubmissions } = require('./services/indexer/entityParser');

// This is the transaction data from the database
const txData = {
  "tx": {
    "body": {
      "memo": "", 
      "messages": [{
        "@type": "/pocket.proof.MsgSubmitProof", 
        "proof": "...",
        "session_header": {
          "service_id": "proto-test-0",
          "session_id": "99f185672ac389ad1c9f89274f29b84a017f6c97ab8c9b89851b08f0fc47c86d",
          "application_address": "pokt16phxccfgz2jermxwstcffa9pyj4au5wqwhj36n",
          "session_end_block_height": "1440",
          "session_start_block_height": "1431"
        },
        "supplier_operator_address": "pokt1mwjprc4l2g9zfmwlm68fvh774vpnhlz7r2n8pf"
      }]
    }
  },
  "tx_response": {
    "height": "1447",
    "txhash": "536681F7C1C1ECC93B30451846521874A0E2E5209D7DF501D62E5DEF129F8494",
    "events": [{
      "type": "pocket.proof.EventProofSubmitted",
      "attributes": [
        {"key": "claim", "index": true, "value": "{\"supplier_operator_address\":\"pokt1mwjprc4l2g9zfmwlm68fvh774vpnhlz7r2n8pf\",\"session_header\":{\"application_address\":\"pokt16phxccfgz2jermxwstcffa9pyj4au5wqwhj36n\",\"service_id\":\"proto-test-0\",\"session_id\":\"99f185672ac389ad1c9f89274f29b84a017f6c97ab8c9b89851b08f0fc47c86d\",\"session_start_block_height\":\"1431\",\"session_end_block_height\":\"1440\"},\"root_hash\":\"yrc/hML6yaqYayUspGg07C+Q3hDN6cQ+nRPzEeepLEgAAAAAAAAABgAAAAAAAAAG\",\"proof_validation_status\":\"PENDING_VALIDATION\"}"},
        {"key": "claimed_upokt", "index": true, "value": "{\"denom\":\"upokt\",\"amount\":\"252\"}"},
        {"key": "num_claimed_compute_units", "index": true, "value": "\"6\""},
        {"key": "num_estimated_compute_units", "index": true, "value": "\"6\""},
        {"key": "num_relays", "index": true, "value": "\"6\""}
      ]
    }]
  }
};

const txObj = {
  hash: "536681F7C1C1ECC93B30451846521874A0E2E5209D7DF501D62E5DEF129F8494",
  tx_response: txData.tx_response,
  tx_data: JSON.stringify(txData)
};

const block = {
  block: {
    header: {
      height: "1447",
      time: "2025-04-01T23:32:13Z"
    }
  },
  height: 1447,
  timestamp: "2025-04-01T23:32:13Z"
};

console.log('Testing parser on transaction with proof submission events...');
console.log('Transaction hash:', txObj.hash);
console.log('Block height:', block.block.header.height);
console.log('Events:', txObj.tx_response.events.length);
console.log('Event types:', txObj.tx_response.events.map(e => e.type));

const proofs = parseProofSubmissions(txObj, block, 'pocket-testnet-alpha');

console.log(`\nParsed ${proofs.length} proof submissions:`);
proofs.forEach((proof, i) => {
  console.log(`\nProof ${i + 1}:`);
  console.log('  Transaction:', proof.transaction_hash);
  console.log('  Supplier:', proof.supplier_operator_address);
  console.log('  Application:', proof.application_address);
  console.log('  Service:', proof.service_id);
  console.log('  Session:', proof.session_id);
  console.log('  Rewards:', proof.claimed_upokt);
  console.log('  Relays:', proof.num_relays);
  console.log('  Claimed CU:', proof.num_claimed_compute_units);
  console.log('  Estimated CU:', proof.num_estimated_compute_units);
  console.log('  Status:', proof.claim_proof_status_int);
});

