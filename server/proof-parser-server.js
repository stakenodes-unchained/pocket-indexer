#!/usr/bin/env node

/**
 * Proof Parser Server
 * 
 * This server is dedicated to processing proof submissions and claims from the database.
 * It runs as a separate service alongside the main indexer.
 * 
 * Usage:
 *   node proof-parser-server.js --chain mainnet
 *   node proof-parser-server.js --chain shannon
 *   node proof-parser-server.js --all-chains
 */

const express = require('express');
const ProofParserService = require('./services/proofParserService');
const { getRpcEndpoints } = require('./config/rpc');

// Parse command line arguments
const args = process.argv.slice(2);
const chainArg = args.find(arg => arg.startsWith('--chain='));
const allChainsArg = args.find(arg => arg === '--all-chains');

let chainsToProcess = [];

if (allChainsArg) {
  // Process all chains
  const endpoints = getRpcEndpoints();
  chainsToProcess = endpoints.map(e => e.name);
  console.log(`[ProofParserServer] Processing all chains: ${chainsToProcess.join(', ')}`);
} else if (chainArg) {
  // Process specific chain
  const chain = chainArg.split('=')[1];
  chainsToProcess = [chain];
  console.log(`[ProofParserServer] Processing chain: ${chain}`);
} else {
  // Default to mainnet if no argument provided
  chainsToProcess = ['mainnet'];
  console.log(`[ProofParserServer] No chain specified, defaulting to: mainnet`);
}

// Create service instances
const services = new Map();

chainsToProcess.forEach(chain => {
  const service = new ProofParserService({
    chain: chain,
    pollInterval: parseInt(process.env.PROOF_PARSER_POLL_INTERVAL || '10000', 10),
    batchSize: parseInt(process.env.PROOF_PARSER_BATCH_SIZE || '100', 10),
    healthCheckInterval: parseInt(process.env.PROOF_PARSER_HEALTH_CHECK_INTERVAL || '5000', 10),
  });
  
  services.set(chain, service);
});

// Create Express app for health monitoring
const app = express();
const PORT = process.env.PROOF_PARSER_PORT || 3008;

// Middleware
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  const chains = [];
  
  for (const [chain, service] of services) {
    chains.push({
      chain: chain,
      ...service.getHealthStatus()
    });
  }
  
  // Determine overall health
  const allRunning = Array.from(services.values()).every(s => s.isRunning);
  const allConnected = Array.from(services.values()).every(s => s.pgClient._connected);
  
  const status = allRunning && allConnected ? 'healthy' : 'degraded';
  
  res.json({
    status: status,
    timestamp: new Date().toISOString(),
    chains: chains,
  });
});

// Individual chain health
app.get('/health/:chain', (req, res) => {
  const chain = req.params.chain;
  const service = services.get(chain);
  
  if (!service) {
    return res.status(404).json({ error: `Chain ${chain} not found` });
  }
  
  res.json({
    chain: chain,
    ...service.getHealthStatus()
  });
});

// Start/stop endpoints
app.post('/start/:chain', async (req, res) => {
  const chain = req.params.chain;
  const service = services.get(chain);
  
  if (!service) {
    return res.status(404).json({ error: `Chain ${chain} not found` });
  }
  
  try {
    await service.start();
    res.json({ message: `Service for chain ${chain} started`, ...service.getHealthStatus() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/stop/:chain', async (req, res) => {
  const chain = req.params.chain;
  const service = services.get(chain);
  
  if (!service) {
    return res.status(404).json({ error: `Chain ${chain} not found` });
  }
  
  try {
    await service.stop();
    res.json({ message: `Service for chain ${chain} stopped` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Stats endpoint
app.get('/stats', (req, res) => {
  const stats = [];
  
  for (const [chain, service] of services) {
    const health = service.getHealthStatus();
    stats.push({
      chain: chain,
      processed: health.processedCount,
      errors: health.errorCount,
      status: health.status,
      uptime: health.uptime,
      lastProcessTime: health.lastProcessTime,
    });
  }
  
  res.json({ stats });
});

// Start the server
app.listen(PORT, () => {
  console.log(`[ProofParserServer] Health monitoring server listening on port ${PORT}`);
  console.log(`[ProofParserServer] Endpoints:`);
  console.log(`  GET  /health - Overall health status`);
  console.log(`  GET  /health/:chain - Chain-specific health`);
  console.log(`  GET  /stats - Statistics for all chains`);
  console.log(`  POST /start/:chain - Start processing for a chain`);
  console.log(`  POST /stop/:chain - Stop processing for a chain`);
});

// Graceful shutdown
async function shutdown() {
  console.log('\n[ProofParserServer] Shutting down...');
  
  // Stop all services
  for (const [chain, service] of services) {
    try {
      await service.stop();
    } catch (error) {
      console.error(`[ProofParserServer] Error stopping service for ${chain}:`, error.message);
    }
  }
  
  // Close server
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Auto-start all services
async function startAllServices() {
  console.log(`[ProofParserServer] Auto-starting services for ${chainsToProcess.length} chain(s)...`);
  
  for (const [chain, service] of services) {
    try {
      console.log(`[ProofParserServer] Starting service for chain: ${chain}`);
      await service.start();
      console.log(`[ProofParserServer] Service started for chain: ${chain}`);
    } catch (error) {
      console.error(`[ProofParserServer] Error starting service for ${chain}:`, error.message);
    }
  }
  
  console.log(`[ProofParserServer] All services started`);
}

// Start services after a short delay to allow the server to start
setTimeout(startAllServices, 2000);

