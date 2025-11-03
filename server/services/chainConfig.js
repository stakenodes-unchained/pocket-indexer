'use strict';

const { getRpcEndpoints } = require('../config/rpc');

/**
 * Get API base URL for a specific chain
 * @param {string} chain - Chain name
 * @returns {{name: string, url: string} | null} Chain config or null if not found
 */
function getChainApiBase(chain) {
  const rpcEndpoints = getRpcEndpoints();
  const chainConfig = rpcEndpoints.find(rpc => rpc.name === chain);
  return chainConfig || null;
}

/**
 * Get all configured chains with their API bases
 * @returns {Array<{name: string, url: string}>} Array of chain configs
 */
function getAllChainConfigs() {
  return getRpcEndpoints();
}

module.exports = {
  getChainApiBase,
  getAllChainConfigs
};

