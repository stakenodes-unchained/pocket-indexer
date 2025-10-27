#!/usr/bin/env node

require('dotenv').config();
const { Client } = require('pg');
const { parseProofSubmissions } = require('./services/indexer/entityParser');

async function testSingleTx() {
  const client = new Client({
    host: 'localhost',
    port: 5432,
    user: 'postgres',
    password: 'somestringpassword',
    database: 'pocket_indexer',
  });
  
  await client.connect();
  console.log('Connected to database');
  
  // Get the specific transaction
  const txResult = await client.query(
    `SELECT id, hash, chain, tx_data, timestamp
     FROM transactions 
     WHERE hash = '536681F7C1C1ECC93B30451846521874A0E2E5209D7DF501D62E5DEF129F8494'`
  );
  
  if (txResult.rows.length === 0) {
    console.log('Transaction not found');
    await client.end();
    return;
  }
  
  const tx = txResult.rows[0];
  console.log('Found transaction:', tx.hash);
  
  // Get block
  const blockResult = await client.query(
    `SELECT b.* FROM blocks b
     INNER JOIN transactions t ON t.block_id = b.id
     WHERE t.hash = $1 LIMIT 1`,
    [tx.hash]
  );
  
  if (blockResult.rows.length === 0) {
    console.log('Block not found');
    await client.end();
    return;
  }
  
  const block = blockResult.rows[0];
  const blockObj = {
    block: {
      header: {
        height: block.height.toString(),
        time: block.timestamp,
        hash: block.hash,
      }
    },
    height: block.height,
    timestamp: block.timestamp,
  };
  
  // Parse tx_data
  const txData = typeof tx.tx_data === 'string' ? JSON.parse(tx.tx_data) : tx.tx_data;
  
  const txObj = {
    hash: tx.hash,
    tx_response: txData?.tx_response,
    tx_data: tx.tx_data,
  };
  
  console.log('Tx obj:', Object.keys(txObj));
  console.log('Tx response events:', txObj.tx_response?.events?.length);
  
  const proofs = parseProofSubmissions(txObj, blockObj, tx.chain);
  
  console.log(`\nParsed ${proofs.length} proof submissions`);
  if (proofs.length > 0) {
    console.log('First proof:', JSON.stringify(proofs[0], null, 2));
  } else {
    console.log('No proof submissions extracted. Event types:', txObj.tx_response?.events?.map(e => e.type));
  }
  
  await client.end();
}

testSingleTx().catch(console.error);

