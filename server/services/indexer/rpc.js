async function fetchBlockByHeight(height, rpcUrl) {
  try {
    const res = await fetch(`${rpcUrl}/cosmos/base/tendermint/v1beta1/blocks/${height}`);
    if (!res.ok) {
      throw new Error(`Failed to fetch block ${height}: ${res.status} ${res.statusText}`);
    }
    return res.json();
  } catch (error) {
    throw new Error(`Error fetching block ${height}: ${error.message}`);
  }
}

async function fetchLatestBlock(rpcUrl) {
  try {
    const res = await fetch(`${rpcUrl}/cosmos/base/tendermint/v1beta1/blocks/latest`);
    if (!res.ok) {
      throw new Error(`Failed to fetch latest block: ${res.status} ${res.statusText}`);
    }
    return res.json();
  } catch (error) {
    throw new Error(`Error fetching latest block: ${error.message}`);
  }
}

async function fetchTransactionByHash(txHash, rpcUrl) {
  try {
    const res = await fetch(`${rpcUrl}/cosmos/tx/v1beta1/txs/${txHash}`);
    if (!res.ok) {
      throw new Error(`Failed to fetch transaction ${txHash}: ${res.status} ${res.statusText}`);
    }
    return res.json();
  } catch (error) {
    throw new Error(`Error fetching transaction ${txHash}: ${error.message}`);
  }
}

module.exports = {
  fetchBlockByHeight,
  fetchLatestBlock,
  fetchTransactionByHash,
}; 