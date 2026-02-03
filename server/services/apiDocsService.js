/**
 * API Documentation Service
 * Provides structured API documentation for frontend consumption
 * Only includes PUBLIC and TOKEN authenticated endpoints
 */

/**
 * API Documentation Data
 * This is the source of truth for the API documentation shown in the frontend
 */
const API_DOCUMENTATION = {
  info: {
    title: "Pocket Network Indexer API",
    version: "1.0.0",
    description: "The Pocket Network Indexer API provides comprehensive access to blockchain data from the Pocket Network. This RESTful API enables developers to query transactions, blocks, validators, services, claims, proof submissions, and network growth metrics. The API is designed for building block explorers, analytics dashboards, monitoring tools, and any application that needs to interact with Pocket Network blockchain data. All responses are returned in JSON format with consistent pagination and error handling patterns.",
    baseUrl: "/api/v1"
  },

  authentication: {
    description: "The API uses two access levels for different endpoints. Public endpoints are freely accessible without any authentication. Token endpoints require a valid API token that you can obtain by registering an account.",
    levels: [
      {
        name: "PUBLIC",
        description: "These endpoints are freely accessible without any authentication. They provide access to basic blockchain data like transactions, blocks, gateways, and service performance metrics. Use these endpoints for public-facing features that don't require user tracking or rate limit management.",
        header: null,
        example: "curl https://api.example.com/api/v1/blocks"
      },
      {
        name: "TOKEN",
        description: "These endpoints require a valid API token for access. Token authentication provides access to advanced features including network growth analytics, detailed supplier/application data, claims, proof submissions, and validator performance metrics. To obtain an API token, register an account using the /auth/register endpoint. Include your token in the Authorization header of every request.",
        header: "Authorization: Bearer pk_live_your_token_here",
        example: "curl -H 'Authorization: Bearer pk_live_abc123...' https://api.example.com/api/v1/network-growth"
      }
    ]
  },

  categories: [
    {
      name: "Public Endpoints",
      description: "These endpoints do not require any authentication and are freely accessible to all users. They provide access to core blockchain data including transactions, blocks, gateways, and service performance metrics. These endpoints are ideal for building public-facing block explorers and dashboards.",
      authLevel: "PUBLIC",
      groups: [
        {
          name: "Transactions",
          description: "Transaction endpoints provide access to all transactions on the Pocket Network blockchain. You can query transactions with various filters including address, type, status, date range, and amount range. The API supports both single address queries and bulk queries for multiple addresses.",
          endpoints: [
            {
              method: "GET",
              path: "/api/v1/transactions",
              name: "Get Transactions",
              description: "Retrieve a paginated list of transactions from the Pocket Network blockchain. This endpoint supports comprehensive filtering options to narrow down results based on specific criteria. You can filter by sender or recipient address, transaction type (Send, Stake, Unstake, Claim, etc.), transaction status (success or failed), date range, and amount range. Results are sorted by timestamp in descending order by default (newest first), but you can customize the sorting using the sort_by and sort_order parameters. The API searches addresses in both the sender and recipient fields, as well as within the transaction data JSON for comprehensive address matching. For queries involving many addresses, consider using the POST variant of this endpoint to avoid URL length limitations.",
              parameters: [
                { name: "chain", type: "string", required: false, description: "Filter transactions by blockchain chain identifier. Use 'pocket-mainnet' for mainnet transactions or 'pocket-testnet' for testnet. If not specified, transactions from all chains are returned." },
                { name: "address", type: "string", required: false, description: "Filter transactions by a single wallet address. The API will match this address against sender, recipient, and addresses within the transaction data. You can provide multiple addresses as a comma-separated string." },
                { name: "addresses", type: "string", required: false, description: "Alternative to 'address' parameter for filtering by multiple addresses. Provide addresses as a comma-separated string. This is useful when you need to track transactions across multiple wallets." },
                { name: "type", type: "string", required: false, description: "Filter by transaction type. Common types include: 'Send' (token transfers), 'Stake' (staking tokens), 'Unstake' (unstaking tokens), 'Claim' (claiming rewards), 'MsgStakeApplication', 'MsgStakeSupplier', 'MsgStakeGateway', and more." },
                { name: "status", type: "string", required: false, description: "Filter by transaction execution status. Use 'success' for successfully executed transactions or 'failed' for transactions that failed during execution." },
                { name: "start_date", type: "string", required: false, description: "Filter transactions from this date onwards. Must be in ISO 8601 format (e.g., '2025-01-01T00:00:00Z'). Use this with end_date to query a specific date range." },
                { name: "end_date", type: "string", required: false, description: "Filter transactions up to and including this date. Must be in ISO 8601 format (e.g., '2025-01-31T23:59:59Z'). Use this with start_date to query a specific date range." },
                { name: "min_amount", type: "number", required: false, description: "Filter transactions with amount greater than or equal to this value. Useful for finding large transactions or filtering out dust transactions." },
                { name: "max_amount", type: "number", required: false, description: "Filter transactions with amount less than or equal to this value. Use with min_amount to query transactions within a specific amount range." },
                { name: "page", type: "integer", required: false, default: 1, description: "Page number for pagination. Pages are 1-indexed, meaning the first page is page 1. Use this with the 'limit' parameter to navigate through large result sets." },
                { name: "limit", type: "integer", required: false, default: 10, description: "Number of transactions to return per page. Minimum is 1, maximum is 1000. Higher limits return more data but may increase response time. Default is 10 for optimal performance." },
                { name: "sort_by", type: "string", required: false, default: "timestamp", description: "Field to sort results by. Available options: 'timestamp' (transaction time), 'amount' (transaction amount), 'fee' (transaction fee), 'block_height' (block number), 'type' (transaction type), 'status' (success/failed)." },
                { name: "sort_order", type: "string", required: false, default: "desc", description: "Sort direction. Use 'desc' for descending order (newest/largest first) or 'asc' for ascending order (oldest/smallest first). Default is 'desc'." }
              ],
              responseExample: {
                data: [
                  {
                    id: "A1B2C3D4E5F6789012345678901234567890123456789012345678901234ABCD",
                    hash: "A1B2C3D4E5F6789012345678901234567890123456789012345678901234ABCD",
                    block_id: "pocket-mainnet:BLOCK123456789",
                    sender: "pokt1abcdefghijklmnopqrstuvwxyz123456789",
                    recipient: "pokt1zyxwvutsrqponmlkjihgfedcba987654321",
                    amount: "1000.500000",
                    fee: "0.010000",
                    memo: "Payment for services",
                    type: "Send",
                    status: "success",
                    chain: "pocket-mainnet",
                    timestamp: "2025-01-27T10:30:00Z",
                    block_height: 482817,
                    tx_data: {}
                  }
                ],
                meta: {
                  total: 15847,
                  page: 1,
                  limit: 10,
                  totalPages: 1585
                }
              }
            },
            {
              method: "GET",
              path: "/api/v1/transactions/count",
              name: "Get Transaction Count",
              description: "Retrieve transaction count statistics for the Pocket Network blockchain. This endpoint returns the total number of transactions along with a daily breakdown, making it ideal for displaying transaction volume charts and tracking network activity over time. The response includes date labels and corresponding counts that can be directly used for chart visualization. This is a lightweight endpoint optimized for dashboard widgets and activity indicators.",
              parameters: [
                { name: "chain", type: "string", required: false, description: "Filter by blockchain chain identifier. Use 'pocket-mainnet' for mainnet or 'pocket-testnet' for testnet. If not specified, returns counts across all chains." }
              ],
              responseExample: {
                data: {
                  labels: ["Jan 25", "Jan 26", "Jan 27", "Jan 28", "Jan 29", "Jan 30", "Jan 31"],
                  counts: [12453, 15678, 14234, 16789, 18234, 17456, 19012],
                  total: 1547823
                }
              }
            }
          ]
        },
        {
          name: "Blocks",
          description: "Block endpoints provide access to blockchain block data. You can query blocks by height, hash, or date range. Each block contains information about the proposer, timestamp, size, production time, and the number of transactions it contains. These endpoints are essential for building block explorers and monitoring blockchain health.",
          endpoints: [
            {
              method: "GET",
              path: "/api/v1/blocks",
              name: "Get Blocks",
              description: "Retrieve a paginated list of blocks from the Pocket Network blockchain. Blocks are returned in descending order by height (newest first) by default. Each block includes essential metadata such as the block hash, proposer address, timestamp, raw block size in bytes, block production time (time elapsed since the previous block), and the count of transactions contained within the block. Use the height and date filters to query specific ranges of blocks for historical analysis. This endpoint is optimized for building block explorer list views and monitoring recent network activity.",
              parameters: [
                { name: "chain", type: "string", required: false, description: "Filter blocks by blockchain chain identifier. Use 'pocket-mainnet' for mainnet blocks or 'pocket-testnet' for testnet. If not specified, blocks from all chains are returned." },
                { name: "page", type: "integer", required: false, default: 1, description: "Page number for pagination. Pages are 1-indexed. Use this to navigate through the block history." },
                { name: "limit", type: "integer", required: false, default: 100, description: "Number of blocks to return per page. Default is 100, maximum recommended is 1000. Higher limits may increase response time but reduce the number of API calls needed." },
                { name: "start_height", type: "integer", required: false, description: "Filter blocks starting from this block height (inclusive). Use this to query blocks from a specific point in the blockchain history." },
                { name: "end_height", type: "integer", required: false, description: "Filter blocks up to this block height (inclusive). Combine with start_height to query a specific range of blocks." },
                { name: "start_date", type: "string", required: false, description: "Filter blocks from this timestamp onwards. Must be in ISO 8601 format (e.g., '2025-01-01T00:00:00Z'). Useful for time-based block queries." },
                { name: "end_date", type: "string", required: false, description: "Filter blocks up to this timestamp. Must be in ISO 8601 format. Combine with start_date for time-range queries." }
              ],
              responseExample: {
                data: [
                  {
                    id: "pocket-mainnet:ABC123DEF456789012345678901234567890",
                    height: 482817,
                    hash: "ABC123DEF456789012345678901234567890123456789012345678901234",
                    timestamp: "2025-01-27T10:30:00Z",
                    proposer: "pokt1proposer123456789abcdefghijklmnop",
                    chain: "pocket-mainnet",
                    raw_block_size: 45678,
                    block_production_time: 15.234,
                    transaction_count: 42
                  }
                ],
                meta: {
                  total: 482817,
                  page: 1,
                  limit: 100,
                  totalPages: 4829
                }
              }
            },
            {
              method: "GET",
              path: "/api/v1/blocks/:block_id",
              name: "Get Block by ID or Height",
              description: "Retrieve detailed information about a specific block by its hash (ID) or height. When querying by height, you must also provide the chain parameter to ensure the correct block is returned. This endpoint returns comprehensive block data including the full block_data JSON from the RPC API, which contains detailed header information, transaction data, evidence, and last commit data. Use this endpoint for block detail pages in block explorers or when you need complete block information for verification or analysis purposes.",
              parameters: [
                { name: "block_id", type: "string", required: true, in: "path", description: "The block identifier. This can be either the block hash (a 64-character hexadecimal string) or the block height (a positive integer). When using height, the chain parameter becomes required." },
                { name: "chain", type: "string", required: false, description: "Chain identifier. Required when querying by block height to ensure the correct block is returned. Use 'pocket-mainnet' or 'pocket-testnet'." }
              ],
              responseExample: {
                data: {
                  id: "pocket-mainnet:ABC123DEF456789012345678901234567890",
                  height: 482817,
                  hash: "ABC123DEF456789012345678901234567890123456789012345678901234",
                  timestamp: "2025-01-27T10:30:00Z",
                  proposer: "pokt1proposer123456789abcdefghijklmnop",
                  chain: "pocket-mainnet",
                  raw_block_size: 45678,
                  block_production_time: 15.234,
                  transaction_count: 42,
                  block_data: {
                    block_id: { hash: "ABC123DEF456..." },
                    block: {
                      header: {
                        version: { block: "11", app: "0" },
                        chain_id: "pocket-mainnet",
                        height: "482817",
                        time: "2025-01-27T10:30:00Z"
                      }
                    }
                  }
                }
              }
            }
          ]
        },
        {
          name: "Gateways",
          description: "Gateway endpoints provide access to gateway node information on the Pocket Network. Gateways serve as entry points for applications to access the network's decentralized infrastructure. These endpoints allow you to list all registered gateways and view their staking status, helping developers and operators monitor gateway availability and health.",
          endpoints: [
            {
              method: "GET",
              path: "/api/v1/gateways",
              name: "Get Gateways",
              description: "Retrieve a paginated list of all gateway nodes registered on the Pocket Network. Gateways are infrastructure nodes that provide applications with access to the network's decentralized RPC services. Each gateway entry includes the gateway's address, staking amount, current status, and last activity timestamp. Use this endpoint to display gateway directories, monitor gateway availability, or analyze the gateway ecosystem distribution.",
              parameters: [
                { name: "chain", type: "string", required: false, description: "Filter gateways by blockchain chain identifier. Use 'pocket-mainnet' for mainnet gateways or 'pocket-testnet' for testnet." },
                { name: "page", type: "integer", required: false, default: 1, description: "Page number for pagination." },
                { name: "limit", type: "integer", required: false, default: 25, description: "Number of gateways to return per page." }
              ],
              responseExample: {
                data: [
                  {
                    address: "pokt1gateway123456789abcdefghijklmnop",
                    chain: "pocket-mainnet",
                    staked_amount: "100000000000",
                    stake_denom: "upokt",
                    status: "staked",
                    last_seen: "2025-01-27T10:30:00Z"
                  }
                ],
                meta: {
                  total: 45,
                  page: 1,
                  limit: 25,
                  totalPages: 2
                }
              }
            }
          ]
        },
        {
          name: "Services",
          description: "Service endpoints provide analytics and performance metrics for blockchain services available on the Pocket Network. Services represent different blockchain networks (like Ethereum, Avalanche, Polygon, etc.) that suppliers provide access to through the Pocket Network. These endpoints help you understand service adoption, performance distribution, and market share across the network.",
          endpoints: [
            {
              method: "GET",
              path: "/api/v1/services/top-by-compute-units",
              name: "Get Top Services by Compute Units",
              description: "Retrieve the top-performing blockchain services ranked by total compute units processed over a specified time period. Compute units are a measure of the computational work performed by suppliers to serve relay requests. This endpoint is ideal for building growth charts, service adoption dashboards, and understanding which blockchain services are most actively used on the Pocket Network. Results are sorted by total claimed compute units in descending order, giving you instant insight into the most popular services.",
              parameters: [
                { name: "limit", type: "integer", required: false, default: 10, description: "Number of top services to return. Accepted values are 5, 10, 25, or 50. Default is 10, which provides a good balance between detail and overview." },
                { name: "days", type: "integer", required: false, default: 30, description: "Time period in days to aggregate compute units over. Accepted values are 7 (weekly), 15 (bi-weekly), or 30 (monthly). Default is 30 days for a comprehensive monthly view." },
                { name: "chain", type: "string", required: false, description: "Filter by blockchain chain identifier to see service performance on a specific chain." }
              ],
              responseExample: {
                data: [
                  {
                    service_id: "eth-mainnet",
                    chain: "pocket-mainnet",
                    total_claimed_compute_units: "15847293847",
                    total_estimated_compute_units: "15847293847",
                    submission_count: "125847",
                    avg_efficiency_percent: "100.00",
                    period_start: "2025-01-01T00:00:00Z",
                    period_end: "2025-01-31T23:59:59Z"
                  },
                  {
                    service_id: "avax-mainnet",
                    chain: "pocket-mainnet",
                    total_claimed_compute_units: "12456789012",
                    total_estimated_compute_units: "12500000000",
                    submission_count: "98456",
                    avg_efficiency_percent: "99.65",
                    period_start: "2025-01-01T00:00:00Z",
                    period_end: "2025-01-31T23:59:59Z"
                  }
                ],
                meta: {
                  limit: 10,
                  days: 30,
                  chain: "pocket-mainnet",
                  period_start: "2025-01-01T00:00:00Z",
                  period_end: "2025-01-31T23:59:59Z"
                }
              }
            },
            {
              method: "GET",
              path: "/api/v1/services/top-by-performance",
              name: "Get Top Services by Performance",
              description: "Retrieve the top 10 blockchain services with detailed performance metrics and market share percentages. This endpoint calculates each service's percentage of the total network compute units, making it perfect for pie charts, market share analysis, and competitive service comparisons. Each service includes a rank position, efficiency metrics, and the total network compute units for context. Use this data to understand how network resources are distributed across different blockchain services.",
              parameters: [
                { name: "days", type: "integer", required: false, default: 30, description: "Time period in days to analyze performance over. Accepted values are 7, 15, or 30 days. A longer period provides more stable percentages, while shorter periods show recent trends." },
                { name: "chain", type: "string", required: false, description: "Filter by blockchain chain identifier to see service performance distribution on a specific chain." }
              ],
              responseExample: {
                data: [
                  {
                    rank: 1,
                    service_id: "eth-mainnet",
                    chain: "pocket-mainnet",
                    total_claimed_compute_units: 15847293847,
                    total_estimated_compute_units: 15847293847,
                    submission_count: 125847,
                    avg_efficiency_percent: 100.00,
                    percentage_of_total: 35.52,
                    period_start: "2025-01-01T00:00:00Z",
                    period_end: "2025-01-31T23:59:59Z"
                  }
                ],
                total_compute_units: 44625353000,
                meta: {
                  days: 30,
                  chain: "pocket-mainnet",
                  period_start: "2025-01-01T00:00:00Z",
                  period_end: "2025-01-31T23:59:59Z"
                }
              }
            },
            {
              method: "GET",
              path: "/api/v1/services/:service_id",
              name: "Get Service Consumers (Applications and Suppliers)",
              description: "Retrieve staked applications and suppliers that are configured for a specific service_id. This endpoint joins application_service_configs and supplier_service_configs with the applications and suppliers tables, returning only entities with status = 'staked'. Use this to build service detail pages, show which applications consume a service, and which suppliers provide it on the network.",
              parameters: [
                { name: "service_id", type: "string", required: true, in: "path", description: "The service identifier (e.g., 'eth-mainnet', 'avax-mainnet')." },
                { name: "chain", type: "string", required: false, description: "Optional chain filter (e.g., 'pocket-mainnet'). When provided, only entities on this chain are returned." },
                { name: "page", type: "integer", required: false, default: 1, description: "Page number for pagination. Applies to both applications and suppliers lists." },
                { name: "limit", type: "integer", required: false, default: 25, description: "Number of results per page for applications and suppliers." }
              ],
              responseExample: {
                data: {
                  service_id: "eth-mainnet",
                  chain: "pocket-mainnet",
                  applications: [
                    {
                      address: "pokt1app...",
                      chain: "pocket-mainnet",
                      staked_amount: "1000000000",
                      stake_denom: "upokt",
                      status: "staked",
                      chains: ["eth-mainnet"],
                      delegated: false,
                      gateway_address: null,
                      delegatee_gateway_addresses: [],
                      unstake_session_end_height: null,
                      last_seen: "2025-01-31T23:59:59Z",
                      endpoints: ["https://eth-mainnet.example.com"],
                      config_options: {}
                    }
                  ],
                  suppliers: [
                    {
                      address: "poktvaloper1supplier...",
                      chain: "pocket-mainnet",
                      staked_amount: "5000000000",
                      stake_denom: "upokt",
                      status: "staked",
                      service_url: "https://rpc.example.com",
                      owner_address: "pokt1owner...",
                      last_seen: "2025-01-31T23:59:59Z",
                      geo: "US",
                      endpoints: ["https://eth-mainnet.example.com"],
                      config_options: {}
                    }
                  ]
                },
                meta: {
                  page: 1,
                  limit: 25,
                  totalApplications: 42,
                  totalSuppliers: 128,
                  applicationsTotalPages: 2,
                  suppliersTotalPages: 6
                }
              }
            }
          ]
        },
        {
          name: "Authentication",
          description: "Authentication endpoints handle user registration, login, and account recovery. These endpoints are publicly accessible and allow users to create accounts, obtain API tokens, and manage their authentication status. API tokens obtained through registration are used to access TOKEN-authenticated endpoints.",
          endpoints: [
            {
              method: "POST",
              path: "/api/v1/auth/register",
              name: "Register",
              description: "Create a new user account and receive an API token for accessing authenticated endpoints. This is the primary way to obtain API credentials for the Pocket Network Indexer API. Upon successful registration, you will receive a unique API token that should be stored securely - the full token is only displayed once during registration and cannot be retrieved later. If you lose your token, you can create a new one after logging in. The registration process supports both password-based and passwordless (email-only) registration flows.",
              requestBody: {
                email: { type: "string", required: true, description: "Your email address. This will be used for account recovery, notifications, and as your login identifier. Must be a valid, unique email address." },
                password: { type: "string", required: false, description: "Your account password. If provided, enables password-based login. Should be at least 8 characters with a mix of letters, numbers, and symbols for security. If not provided, the account will be passwordless." },
                name: { type: "string", required: false, description: "Your display name. This is used for personalization and identification purposes. Can be your full name, username, or organization name." }
              },
              responseExample: {
                data: {
                  account: {
                    id: 1,
                    email: "developer@example.com",
                    name: "John Developer",
                    created_at: "2025-01-28T15:30:00Z"
                  },
                  token: {
                    token: "pk_live_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6",
                    name: "Default Token",
                    created_at: "2025-01-28T15:30:00Z"
                  }
                },
                message: "Account created successfully. Please save your API token - it will only be shown once."
              }
            },
            {
              method: "POST",
              path: "/api/v1/auth/login",
              name: "Login",
              description: "Authenticate with your email and password to access your account. Upon successful login, you receive JWT access and refresh tokens for session management, along with a list of your API tokens (showing only prefixes for security). Use this endpoint when you need to manage your account, view your existing API tokens, or create new tokens. The access token is short-lived for security, while the refresh token can be used to obtain new access tokens without re-entering credentials.",
              requestBody: {
                email: { type: "string", required: true, description: "The email address associated with your account." },
                password: { type: "string", required: true, description: "Your account password." }
              },
              responseExample: {
                data: {
                  account: {
                    id: 1,
                    email: "developer@example.com",
                    name: "John Developer"
                  },
                  tokens: [
                    {
                      id: 1,
                      token_prefix: "pk_live_a1b2c3d4",
                      name: "Default Token",
                      status: "active",
                      last_used_at: "2025-01-28T15:30:00Z"
                    }
                  ],
                  accessToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
                  refreshToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                }
              }
            },
            {
              method: "POST",
              path: "/api/v1/auth/refresh",
              name: "Refresh Token",
              description: "Obtain a new access token using a valid refresh token. Access tokens are short-lived for security purposes (typically 15 minutes to 1 hour). When your access token expires, use this endpoint with your refresh token to get a new access token without requiring the user to log in again. This enables seamless session management for long-running applications.",
              requestBody: {
                refreshToken: { type: "string", required: true, description: "The refresh token obtained during login. Refresh tokens have a longer lifespan than access tokens but should still be stored securely." }
              },
              responseExample: {
                data: {
                  accessToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
                  refreshToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                }
              }
            },
            {
              method: "POST",
              path: "/api/v1/auth/logout",
              name: "Logout",
              description: "Invalidate your refresh token and end your session. After logging out, the provided refresh token can no longer be used to obtain new access tokens. This is important for security, especially when logging out from shared devices or when you suspect your tokens may have been compromised.",
              requestBody: {
                refreshToken: { type: "string", required: true, description: "The refresh token to invalidate." }
              },
              responseExample: {
                message: "Logged out successfully"
              }
            },
            {
              method: "POST",
              path: "/api/v1/auth/verify-email",
              name: "Verify Email",
              description: "Verify your email address using the verification token sent to your email. Email verification confirms ownership of the email address and may be required for certain account features. The verification token is included in the email sent after registration or when requesting a new verification email.",
              requestBody: {
                token: { type: "string", required: true, description: "The verification token from the email. This token is valid for a limited time (typically 24 hours)." }
              },
              responseExample: {
                message: "Email verified successfully"
              }
            },
            {
              method: "POST",
              path: "/api/v1/auth/resend-verification",
              name: "Resend Verification Email",
              description: "Request a new email verification link if the original one expired or was not received. A new verification token will be generated and sent to your registered email address. This endpoint is rate-limited to prevent abuse.",
              requestBody: {
                email: { type: "string", required: true, description: "The email address to send the verification link to. Must match your registered email." }
              },
              responseExample: {
                message: "Verification email sent"
              }
            },
            {
              method: "POST",
              path: "/api/v1/auth/forgot-password",
              name: "Forgot Password",
              description: "Initiate the password reset process by requesting a reset link. If an account exists with the provided email address, a password reset email will be sent containing a secure link to reset your password. For security reasons, the response is the same whether or not the email exists in our system.",
              requestBody: {
                email: { type: "string", required: true, description: "The email address associated with your account." }
              },
              responseExample: {
                message: "If an account exists with this email, a password reset link has been sent."
              }
            },
            {
              method: "POST",
              path: "/api/v1/auth/reset-password",
              name: "Reset Password",
              description: "Set a new password using the reset token received via email. The reset token is valid for a limited time (typically 1 hour). After successfully resetting your password, you can log in with your new credentials. All existing refresh tokens are invalidated for security.",
              requestBody: {
                token: { type: "string", required: true, description: "The password reset token from the email." },
                password: { type: "string", required: true, description: "Your new password. Should be at least 8 characters with a mix of letters, numbers, and symbols." }
              },
              responseExample: {
                message: "Password reset successfully"
              }
            }
          ]
        }
      ]
    },
    {
      name: "Token Authenticated Endpoints",
      description: "These endpoints require a valid API token for access. Include your API token in the Authorization header of every request using the Bearer token format: 'Authorization: Bearer pk_live_your_token_here'. Token authentication provides access to advanced analytics, detailed entity data, and comprehensive network metrics. Obtain your API token by registering an account through the /auth/register endpoint.",
      authLevel: "TOKEN",
      groups: [
        {
          name: "Network Growth",
          description: "Network growth endpoints provide comprehensive analytics about the Pocket Network's expansion and performance over time. These endpoints track new entity creation (applications, suppliers, gateways, services), relay volume, and compute unit consumption. Use these endpoints for building growth dashboards, tracking network health, and analyzing adoption trends.",
          endpoints: [
            {
              method: "GET",
              path: "/api/v1/network-growth",
              name: "Get Network Growth (Combined)",
              description: "Retrieve a complete daily time series combining both performance metrics (relays, compute units) and entity statistics (applications, suppliers, gateways, services) over the specified window. This endpoint merges data from multiple sources to provide a comprehensive view of network growth in a single API call. Each day in the timeline includes counts of newly created entities and the total relays/compute units processed. Note: For better performance in production applications, consider using the separate /performance and /entities endpoints instead of this combined endpoint.",
              parameters: [
                { name: "window", type: "integer", required: false, default: 7, description: "The number of days to include in the time series, ending today. Default is 7 days (one week). Maximum is 365 days (one year). Larger windows provide more historical context but may increase response time." },
                { name: "chain", type: "string", required: false, description: "Filter by blockchain chain identifier. If not specified, results are aggregated across all chains." }
              ],
              responseExample: {
                data: {
                  window_days: 7,
                  timeline: [
                    {
                      day: "2025-01-25",
                      applications: 3,
                      suppliers: 2,
                      gateways: 1,
                      services: 2,
                      relays: 15847293,
                      compute_units: 158472930000
                    },
                    {
                      day: "2025-01-26",
                      applications: 5,
                      suppliers: 1,
                      gateways: 0,
                      services: 1,
                      relays: 16234567,
                      compute_units: 162345670000
                    }
                  ]
                }
              }
            },
            {
              method: "GET",
              path: "/api/v1/network-growth/performance",
              name: "Get Network Growth Performance",
              description: "Retrieve a daily time series focused on network performance metrics including relay counts and compute unit consumption. This endpoint provides detailed breakdowns of compute units from both proof submissions and settled claims, making it ideal for performance dashboards and throughput analysis. The data uses America/New_York timezone for day boundaries. This is the recommended endpoint for performance-focused analytics as it is optimized for speed and returns only the metrics needed for performance visualization.",
              parameters: [
                { name: "window", type: "integer", required: false, default: 7, description: "Number of days to include in the time series. Default is 7 days, maximum is 365 days." },
                { name: "chain", type: "string", required: false, description: "Filter by blockchain chain identifier to see performance for a specific chain." }
              ],
              responseExample: {
                data: {
                  window_days: 30,
                  timeline: [
                    {
                      day: "2025-01-01",
                      relays: 1234567890,
                      compute_units: 12345678900000,
                      proof_submissions_computed_units: 12000000000000,
                      proof_submissions_estimated_units: 12500000000000,
                      settled_claims_computed_units: 345678900000,
                      settled_claims_estimated_units: 350000000000
                    }
                  ]
                }
              }
            },
            {
              method: "GET",
              path: "/api/v1/network-growth/entities",
              name: "Get Network Growth Entities",
              description: "Retrieve a daily time series showing the count of newly created entities on the Pocket Network. Entities include applications (dApps using the network), suppliers (nodes providing RPC services), gateways (entry points for applications), and services (new blockchain integrations). This endpoint identifies first-seen entities by parsing transaction messages, making it perfect for tracking network adoption and ecosystem growth. Use this for onboarding metrics and growth rate analysis.",
              parameters: [
                { name: "window", type: "integer", required: false, default: 7, description: "Number of days to include in the entity growth time series. Default is 7 days, maximum is 365 days." },
                { name: "chain", type: "string", required: false, description: "Filter by blockchain chain identifier." }
              ],
              responseExample: {
                data: {
                  window_days: 30,
                  timeline: [
                    {
                      day: "2025-01-01",
                      applications: 5,
                      suppliers: 3,
                      gateways: 1,
                      services: 2
                    }
                  ]
                }
              }
            },
            {
              method: "GET",
              path: "/api/v1/network-growth/summary",
              name: "Get Network Growth Summary",
              description: "Retrieve aggregate summary statistics for the specified time window without daily breakdown. This endpoint provides total counts ideal for dashboard KPI cards and quick overview statistics. It returns the total number of new entities created and the aggregate relay/compute unit metrics for the entire window period. Use this for executive summaries and at-a-glance network health indicators.",
              parameters: [
                { name: "window", type: "integer", required: false, default: 7, description: "Number of days to aggregate. Default is 7 days, maximum is 365 days." },
                { name: "chain", type: "string", required: false, description: "Filter by blockchain chain identifier." }
              ],
              responseExample: {
                data: {
                  window_days: 7,
                  applications: 28,
                  suppliers: 15,
                  gateways: 4,
                  services: 8,
                  relays: 112847293,
                  compute_units: 1128472930000
                }
              }
            }
          ]
        },
        {
          name: "Transactions (Token)",
          description: "Token-authenticated transaction endpoints provide additional capabilities beyond the public transaction endpoints, including POST-based queries for complex filters, individual transaction lookup, and comprehensive statistics. These endpoints are essential for building advanced transaction explorers and analytics dashboards.",
          endpoints: [
            {
              method: "POST",
              path: "/api/v1/transactions",
              name: "Get Transactions (POST)",
              description: "Retrieve transactions using a POST request with filters in the request body. This endpoint is functionally identical to the GET /transactions endpoint but accepts parameters in the JSON request body instead of query parameters. Use this method when you need to filter by many addresses (which would exceed URL length limits), when building programmatic queries, or when you prefer to construct queries as JSON objects. The POST method is recommended for production applications that query multiple addresses.",
              requestBody: {
                addresses: { type: "array", required: false, description: "Array of wallet addresses to filter transactions by. The API matches these addresses against sender, recipient, and addresses within transaction data. This is more efficient than making multiple single-address requests." },
                chain: { type: "string", required: false, description: "Chain identifier to filter by." },
                type: { type: "string", required: false, description: "Transaction type filter (Send, Stake, Unstake, Claim, etc.)." },
                status: { type: "string", required: false, description: "Transaction status filter (success or failed)." },
                start_date: { type: "string", required: false, description: "Filter from date in ISO 8601 format." },
                end_date: { type: "string", required: false, description: "Filter to date in ISO 8601 format." },
                min_amount: { type: "number", required: false, description: "Minimum transaction amount filter." },
                max_amount: { type: "number", required: false, description: "Maximum transaction amount filter." },
                page: { type: "integer", required: false, description: "Page number (default: 1)." },
                limit: { type: "integer", required: false, description: "Results per page (default: 10, max: 1000)." },
                sort_by: { type: "string", required: false, description: "Sort field (timestamp, amount, fee, block_height, type, status)." },
                sort_order: { type: "string", required: false, description: "Sort direction (asc or desc)." }
              }
            },
            {
              method: "GET",
              path: "/api/v1/transactions/:transaction_id",
              name: "Get Transaction by ID",
              description: "Retrieve complete details for a specific transaction by its hash. This endpoint returns all transaction data including the full tx_data JSON containing the original transaction payload. Use this for transaction detail pages, verification, and deep transaction analysis. The transaction hash is case-insensitive.",
              parameters: [
                { name: "transaction_id", type: "string", required: true, in: "path", description: "The transaction hash (64-character hexadecimal string). This uniquely identifies the transaction on the blockchain." },
                { name: "chain", type: "string", required: false, description: "Chain identifier. Optional but recommended for faster lookup if you know which chain the transaction is on." }
              ],
              responseExample: {
                data: {
                  id: "A1B2C3D4E5F6789012345678901234567890123456789012345678901234ABCD",
                  hash: "A1B2C3D4E5F6789012345678901234567890123456789012345678901234ABCD",
                  block_id: "pocket-mainnet:BLOCK123",
                  sender: "pokt1sender123456789abcdefghijklmnop",
                  recipient: "pokt1recipient123456789abcdefghijk",
                  amount: "1000.500000",
                  fee: "0.010000",
                  memo: "Payment for services",
                  type: "Send",
                  status: "success",
                  chain: "pocket-mainnet",
                  timestamp: "2025-01-27T10:30:00Z",
                  block_height: 482817,
                  tx_data: {}
                }
              }
            },
            {
              method: "GET",
              path: "/api/v1/transactions/stats",
              name: "Get Transaction Statistics",
              description: "Retrieve comprehensive aggregate statistics for transactions matching the specified filters. This endpoint calculates totals, breakdowns by type and status, and date range information. Use this for analytics dashboards, account summaries, and understanding transaction patterns. Unlike the list endpoint, this returns computed statistics rather than individual transactions.",
              parameters: [
                { name: "chain", type: "string", required: false, description: "Chain identifier to filter statistics by." },
                { name: "address", type: "string", required: false, description: "Wallet address to calculate statistics for. Matches sender, recipient, and addresses within transaction data." },
                { name: "addresses", type: "string", required: false, description: "Comma-separated list of addresses for bulk statistics." },
                { name: "type", type: "string", required: false, description: "Filter by transaction type." },
                { name: "status", type: "string", required: false, description: "Filter by transaction status." },
                { name: "start_date", type: "string", required: false, description: "Start of date range filter." },
                { name: "end_date", type: "string", required: false, description: "End of date range filter." }
              ],
              responseExample: {
                data: {
                  total_count: 15847,
                  total_amount: 158472930.75,
                  total_fees: 1584.73,
                  by_type: {
                    Send: 8543,
                    Stake: 4521,
                    Unstake: 1892,
                    Claim: 891
                  },
                  by_status: {
                    success: 15692,
                    failed: 155
                  },
                  date_range: {
                    min: "2024-01-01T00:00:00Z",
                    max: "2025-01-31T23:59:59Z"
                  }
                }
              }
            },
            {
              method: "POST",
              path: "/api/v1/transactions/stats",
              name: "Get Transaction Statistics (POST)",
              description: "Retrieve transaction statistics using a POST request. This is the same as GET /transactions/stats but accepts parameters in the request body, making it suitable for queries with many addresses or complex filter combinations.",
              requestBody: {
                addresses: { type: "array", required: false, description: "Array of addresses to calculate statistics for." },
                chain: { type: "string", required: false, description: "Chain identifier filter." },
                type: { type: "string", required: false, description: "Transaction type filter." },
                status: { type: "string", required: false, description: "Transaction status filter." },
                start_date: { type: "string", required: false, description: "Start date filter." },
                end_date: { type: "string", required: false, description: "End date filter." }
              }
            }
          ]
        },
        {
          name: "Applications",
          description: "Application endpoints provide access to data about applications (dApps) that use the Pocket Network for decentralized RPC access. Applications stake tokens to access relay services from suppliers. These endpoints enable you to list applications, view individual application details, and analyze application usage patterns.",
          endpoints: [
            {
              method: "GET",
              path: "/api/v1/applications",
              name: "Get Applications",
              description: "Retrieve a paginated list of all applications registered on the Pocket Network. Applications are decentralized applications (dApps) that have staked tokens to access RPC services through the network. Each application entry includes staking information, status, and service configuration. Use this endpoint for application directories and ecosystem analysis.",
              parameters: [
                { name: "chain", type: "string", required: false, description: "Filter applications by blockchain chain identifier." },
                { name: "page", type: "integer", required: false, default: 1, description: "Page number for pagination." },
                { name: "limit", type: "integer", required: false, default: 50, description: "Number of applications per page." }
              ]
            },
            {
              method: "GET",
              path: "/api/v1/applications/:address",
              name: "Get Application by Address",
              description: "Retrieve detailed information about a specific application by its address. This endpoint returns comprehensive data including the application's staking amount, configured services, current status, and metadata. Use this for application profile pages and detailed analytics.",
              parameters: [
                { name: "address", type: "string", required: true, in: "path", description: "The application's wallet address (pokt1...)." }
              ]
            },
            {
              method: "GET",
              path: "/api/v1/applications/:address/usage",
              name: "Get Application Usage",
              description: "Retrieve daily usage metrics for a specific application over time. This endpoint analyzes proof submissions to calculate daily statistics including the number of unique suppliers serving the application, services used, total relays, rewards distributed, and efficiency metrics. Perfect for application performance monitoring and cost analysis.",
              parameters: [
                { name: "address", type: "string", required: true, in: "path", description: "The application's wallet address." },
                { name: "start_date", type: "string", required: false, description: "Filter from this date (ISO 8601 format)." },
                { name: "end_date", type: "string", required: false, description: "Filter to this date." },
                { name: "page", type: "integer", required: false, default: 1, description: "Page number." },
                { name: "limit", type: "integer", required: false, default: 100, description: "Results per page." }
              ],
              responseExample: {
                data: [
                  {
                    application_address: "pokt1app123456789abcdefghijklmnop",
                    day_bucket: "2025-01-27T00:00:00Z",
                    unique_suppliers: 15,
                    unique_services: 5,
                    total_submissions: 1547,
                    total_rewards_upokt: 15470000,
                    total_relays: 154700,
                    avg_efficiency_percent: 99.85,
                    avg_reward_per_relay: 100.00,
                    total_claimed_compute_units: 7735000000,
                    total_estimated_compute_units: 7750000000
                  }
                ],
                meta: { total: 30, page: 1, limit: 100, totalPages: 1 }
              }
            },
            {
              method: "GET",
              path: "/api/v1/applications/:address/claims/usage",
              name: "Get Application Claims Usage",
              description: "Retrieve daily usage metrics for a specific application based on claims data. Claims represent the initial relay work submission before proof verification. This endpoint provides similar metrics to /usage but derived from claims rather than proof submissions, useful for comparing claimed vs. proven work.",
              parameters: [
                { name: "address", type: "string", required: true, in: "path", description: "The application's wallet address." },
                { name: "start_date", type: "string", required: false, description: "Filter from this date." },
                { name: "end_date", type: "string", required: false, description: "Filter to this date." },
                { name: "page", type: "integer", required: false, default: 1, description: "Page number." },
                { name: "limit", type: "integer", required: false, default: 100, description: "Results per page." }
              ]
            }
          ]
        },
        {
          name: "Suppliers",
          description: "Supplier endpoints provide access to data about node operators (suppliers) that provide RPC services on the Pocket Network. Suppliers stake tokens and run infrastructure to serve relay requests from applications. These endpoints enable you to list suppliers, view individual supplier details, and analyze supplier performance metrics.",
          endpoints: [
            {
              method: "GET",
              path: "/api/v1/suppliers",
              name: "Get Suppliers",
              description: "Retrieve a paginated list of all suppliers registered on the Pocket Network. Suppliers are node operators who stake tokens and provide RPC services to applications. Each supplier entry includes their operator address, staking information, configured services, and current status. The response includes aggregate statistics: totalStakedTokens (all time), unstakingCount24h (number of suppliers unstaking in the last 24 hours), and totalUnstakingTokens24h (total tokens being unstaked in the last 24 hours). Use this for supplier directories and network infrastructure analysis.",
              parameters: [
                { name: "chain", type: "string", required: false, description: "Filter suppliers by blockchain chain identifier." },
                { name: "page", type: "integer", required: false, default: 1, description: "Page number for pagination." },
                { name: "limit", type: "integer", required: false, default: 50, description: "Number of suppliers per page." }
              ]
            },
            {
              method: "GET",
              path: "/api/v1/suppliers/:address",
              name: "Get Supplier by Address",
              description: "Retrieve detailed information about a specific supplier by their operator address. This endpoint returns comprehensive data including staking amounts, configured services with their endpoints, owner address, and current operational status. Use this for supplier profile pages and detailed infrastructure analysis.",
              parameters: [
                { name: "address", type: "string", required: true, in: "path", description: "The supplier's operator address (pokt1... or poktvaloper1...)." }
              ]
            },
            {
              method: "GET",
              path: "/api/v1/suppliers/:address/performance",
              name: "Get Supplier Performance",
              description: "Retrieve daily performance metrics for a specific supplier over time. This endpoint analyzes proof submissions to calculate comprehensive daily statistics including unique applications served, services provided, total submissions, rewards earned, relay counts, efficiency percentages, and compute unit metrics. Essential for supplier performance monitoring, revenue tracking, and operational optimization.",
              parameters: [
                { name: "address", type: "string", required: true, in: "path", description: "The supplier's operator address." },
                { name: "start_date", type: "string", required: false, description: "Filter from this date (ISO 8601 format)." },
                { name: "end_date", type: "string", required: false, description: "Filter to this date." },
                { name: "page", type: "integer", required: false, default: 1, description: "Page number for pagination." },
                { name: "limit", type: "integer", required: false, default: 100, description: "Results per page." }
              ],
              responseExample: {
                data: [
                  {
                    supplier_operator_address: "pokt1supplier123456789abcdefghijk",
                    day_bucket: "2025-01-27T00:00:00Z",
                    unique_applications: 25,
                    unique_services: 8,
                    total_submissions: 2547,
                    total_rewards_upokt: 25470000,
                    total_relays: 254700,
                    avg_efficiency_percent: 100.00,
                    avg_reward_per_relay: 100.00,
                    total_claimed_compute_units: 12735000000,
                    total_estimated_compute_units: 12735000000
                  }
                ],
                meta: { total: 30, page: 1, limit: 100, totalPages: 1 }
              }
            },
            {
              method: "GET",
              path: "/api/v1/suppliers/:address/claims/performance",
              name: "Get Supplier Claims Performance",
              description: "Retrieve daily performance metrics for a specific supplier based on claims data. This provides similar metrics to /performance but derived from claims rather than proof submissions, useful for analyzing claimed work before proof verification.",
              parameters: [
                { name: "address", type: "string", required: true, in: "path", description: "The supplier's operator address." },
                { name: "start_date", type: "string", required: false, description: "Filter from this date." },
                { name: "end_date", type: "string", required: false, description: "Filter to this date." },
                { name: "page", type: "integer", required: false, default: 1, description: "Page number." },
                { name: "limit", type: "integer", required: false, default: 100, description: "Results per page." }
              ]
            }
          ]
        },
        {
          name: "Gateways (Token)",
          description: "Token-authenticated gateway endpoints provide detailed information about individual gateways beyond what's available in the public endpoints.",
          endpoints: [
            {
              method: "GET",
              path: "/api/v1/gateways/:address",
              name: "Get Gateway by Address",
              description: "Retrieve detailed information about a specific gateway by its address. This endpoint returns comprehensive gateway data including staking amount, status, delegated applications, and operational metadata. Use this for gateway profile pages and detailed infrastructure analysis.",
              parameters: [
                { name: "address", type: "string", required: true, in: "path", description: "The gateway's wallet address (pokt1...)." },
                { name: "chain", type: "string", required: false, description: "Chain identifier if querying a specific chain." }
              ]
            }
          ]
        },
        {
          name: "Delegations",
          description: "Delegation endpoints provide access to token delegation data on the Pocket Network. Delegations allow token holders to delegate their stake to validators or gateways while retaining ownership.",
          endpoints: [
            {
              method: "GET",
              path: "/api/v1/delegations",
              name: "Get Delegations",
              description: "Retrieve a list of all token delegations on the Pocket Network. Delegations represent relationships between token holders (delegators) and validators or gateways they have delegated to. Each delegation includes the delegator address, validator/gateway address, amount delegated, and delegation status.",
              parameters: [
                { name: "chain", type: "string", required: false, description: "Filter delegations by blockchain chain identifier." }
              ]
            }
          ]
        },
        {
          name: "Staking",
          description: "Staking endpoints provide access to network-wide staking information and statistics.",
          endpoints: [
            {
              method: "GET",
              path: "/api/v1/staking",
              name: "Get Staking Info",
              description: "Retrieve network-wide staking information and statistics. This endpoint provides aggregate data about total staked tokens, staking distribution across different entity types (validators, suppliers, applications, gateways), and staking-related network parameters.",
              parameters: [
                { name: "chain", type: "string", required: false, description: "Filter staking info by blockchain chain identifier." }
              ]
            }
          ]
        },
        {
          name: "Proof Submissions",
          description: "Proof submission endpoints provide access to verified relay work data. Proof submissions are the verified records of relay work performed by suppliers for applications. These endpoints enable detailed analysis of network activity, reward distribution, and supplier performance at the proof level.",
          endpoints: [
            {
              method: "GET",
              path: "/api/v1/proof-submissions",
              name: "Get Proof Submissions",
              description: "Retrieve a paginated list of proof submissions from the Pocket Network. Proof submissions represent verified relay work where suppliers have cryptographically proven they served requests for applications. Each submission includes the transaction hash, supplier and application addresses, service ID, session information, claimed rewards, relay counts, compute units, and efficiency metrics. Use this for detailed relay analysis and reward tracking.",
              parameters: [
                { name: "chain", type: "string", required: false, description: "Filter by blockchain chain identifier." },
                { name: "service_id", type: "string", required: false, description: "Filter by service ID (e.g., 'eth-mainnet', 'avax-mainnet'). Returns only proof submissions for the specified blockchain service." },
                { name: "supplier_address", type: "string", required: false, description: "Filter by supplier operator address to see all proof submissions from a specific supplier." },
                { name: "application_address", type: "string", required: false, description: "Filter by application address to see all proof submissions for a specific application." },
                { name: "start_date", type: "string", required: false, description: "Filter submissions from this date onwards (ISO 8601 format)." },
                { name: "end_date", type: "string", required: false, description: "Filter submissions up to this date." },
                { name: "page", type: "integer", required: false, default: 1, description: "Page number for pagination." },
                { name: "limit", type: "integer", required: false, default: 100, description: "Number of submissions per page." }
              ],
              responseExample: {
                data: [
                  {
                    id: 12847,
                    transaction_hash: "A1B2C3D4E5F6789012345678901234567890123456789012345678901234ABCD",
                    block_height: 482817,
                    timestamp: "2025-01-27T10:30:00Z",
                    chain: "pocket-mainnet",
                    supplier_operator_address: "pokt1supplier123456789abcdefghijk",
                    application_address: "pokt1app123456789abcdefghijklmnop",
                    service_id: "eth-mainnet",
                    session_id: "session123456789abcdef",
                    session_end_block_height: 482800,
                    claim_proof_status_int: 0,
                    claimed_upokt: "154700upokt",
                    claimed_upokt_amount: 154700,
                    num_claimed_compute_units: 7735000,
                    num_estimated_compute_units: 7735000,
                    num_relays: 1547,
                    compute_unit_efficiency: 100.00,
                    reward_per_relay: 100.00,
                    msg_index: 0,
                    created_at: "2025-01-27T10:30:00Z"
                  }
                ],
                meta: { total: 158472, page: 1, limit: 100, totalPages: 1585 }
              }
            },
            {
              method: "GET",
              path: "/api/v1/proof-submissions/rewards",
              name: "Get Proof Submissions Rewards",
              description: "Retrieve reward analytics aggregated by service across a time period. This endpoint provides service-level reward summaries showing total submissions, rewards, relays, compute units, and efficiency metrics for each blockchain service. Results are sorted by total rewards in descending order. Use this for service performance rankings, reward distribution analysis, and identifying top-performing services.",
              parameters: [
                { name: "chain", type: "string", required: false, description: "Filter by blockchain chain identifier." },
                { name: "days", type: "integer", required: false, description: "Get rewards for the last X days (e.g., 7, 30, 90). If provided, start_date and end_date are ignored. This is the recommended approach for most use cases." },
                { name: "supplier_address", type: "string", required: false, description: "Filter by supplier address. Note: Results are still aggregated by service, but only include data from the specified supplier." },
                { name: "service_id", type: "string", required: false, description: "Filter by specific service ID to see rewards for only that service." },
                { name: "start_date", type: "string", required: false, description: "Filter from this date (used if 'days' is not provided)." },
                { name: "end_date", type: "string", required: false, description: "Filter to this date (used if 'days' is not provided)." },
                { name: "page", type: "integer", required: false, default: 1, description: "Page number." },
                { name: "limit", type: "integer", required: false, default: 100, description: "Results per page." }
              ],
              responseExample: {
                data: [
                  {
                    service_id: "eth-mainnet",
                    chain: "pocket-mainnet",
                    total_submissions: 158472,
                    total_rewards_upokt: 15847200000,
                    total_relays: 15847200,
                    total_claimed_compute_units: 792360000000,
                    total_estimated_compute_units: 800000000000,
                    avg_efficiency_percent: 99.05,
                    avg_reward_per_relay: 100.00,
                    max_reward_per_submission: 500000,
                    min_reward_per_submission: 100
                  }
                ],
                meta: { total: 25, page: 1, limit: 100, totalPages: 1 }
              }
            },
            {
              method: "GET",
              path: "/api/v1/proof-submissions/summary",
              name: "Get Proof Submissions Summary",
              description: "Retrieve aggregate summary statistics for proof submissions across the network. This endpoint provides high-level metrics including total submission count, unique suppliers and applications, total rewards distributed, relay counts, compute unit totals, and overall efficiency. Perfect for network health dashboards and executive summaries.",
              parameters: [
                { name: "chain", type: "string", required: false, description: "Filter by blockchain chain identifier." },
                { name: "service_id", type: "string", required: false, description: "Filter by specific service ID." },
                { name: "supplier_address", type: "string", required: false, description: "Filter by supplier address. Can be comma-separated for multiple addresses." },
                { name: "start_date", type: "string", required: false, description: "Filter from this date." },
                { name: "end_date", type: "string", required: false, description: "Filter to this date." }
              ],
              responseExample: {
                data: {
                  total_submissions: 1584729,
                  unique_suppliers: 547,
                  unique_applications: 289,
                  unique_services: 45,
                  total_rewards_upokt: 158472900000,
                  total_relays: 158472900,
                  total_claimed_compute_units: 7923645000000,
                  total_estimated_compute_units: 8000000000000,
                  avg_efficiency_percent: 99.05,
                  avg_reward_per_relay: 100.00,
                  first_submission: "2024-01-01T00:00:00Z",
                  last_submission: "2025-01-27T23:59:59Z"
                }
              }
            }
          ]
        },
        {
          name: "Claims",
          description: "Claims endpoints provide access to relay claim data. Claims represent the initial submission of relay work before proof verification. They include information about the session, claimed compute units, and expected rewards. Use these endpoints to analyze claimed work and compare with verified proof submissions.",
          endpoints: [
            {
              method: "GET",
              path: "/api/v1/claims",
              name: "Get Claims",
              description: "Retrieve a paginated list of claims from the Pocket Network. Claims represent initial relay work submissions before cryptographic proof verification. Each claim includes session information, claimed compute units, relay counts, and expected rewards. Use this to track pending work and analyze the claims-to-proof pipeline.",
              parameters: [
                { name: "chain", type: "string", required: false, description: "Filter by blockchain chain identifier." },
                { name: "service_id", type: "string", required: false, description: "Filter by service ID." },
                { name: "supplier_address", type: "string", required: false, description: "Filter by supplier operator address. Can be comma-separated for multiple addresses." },
                { name: "application_address", type: "string", required: false, description: "Filter by application address." },
                { name: "start_date", type: "string", required: false, description: "Filter claims from this date onwards." },
                { name: "end_date", type: "string", required: false, description: "Filter claims up to this date." },
                { name: "page", type: "integer", required: false, default: 1, description: "Page number for pagination." },
                { name: "limit", type: "integer", required: false, default: 100, description: "Number of claims per page." }
              ],
              responseExample: {
                data: [
                  {
                    id: 15847,
                    supplier_operator_address: "pokt1supplier123456789abcdefghijk",
                    application_address: "pokt1app123456789abcdefghijklmnop",
                    service_id: "eth-mainnet",
                    session_id: "session123456789abcdef",
                    session_start_block_height: 482750,
                    session_end_block_height: 482800,
                    root_hash: "hash123456789abcdef",
                    status: "claimed",
                    timestamp: "2025-01-27T10:30:00Z",
                    chain: "pocket-mainnet",
                    claim_proof_status_int: 0,
                    claimed_upokt: "154700upokt",
                    claimed_upokt_amount: 154700,
                    num_claimed_compute_units: 7735000,
                    num_estimated_compute_units: 7735000,
                    num_relays: 1547,
                    compute_unit_efficiency: 100.00,
                    reward_per_relay: 100.00
                  }
                ],
                meta: { total: 158472, page: 1, limit: 100, totalPages: 1585 }
              }
            },
            {
              method: "POST",
              path: "/api/v1/claims",
              name: "Get Claims (POST)",
              description: "Retrieve claims using a POST request with filters in the request body. This endpoint is functionally identical to GET /claims but accepts parameters in the JSON body, making it suitable for complex queries or when filtering by many addresses.",
              requestBody: {
                supplier_address: { type: "string", required: false, description: "Filter by supplier address." },
                supplier_addresses: { type: "array", required: false, description: "Filter by multiple supplier addresses." },
                application_address: { type: "string", required: false, description: "Filter by application address." },
                service_id: { type: "string", required: false, description: "Filter by service ID." },
                chain: { type: "string", required: false, description: "Filter by chain identifier." },
                start_date: { type: "string", required: false, description: "Filter from date." },
                end_date: { type: "string", required: false, description: "Filter to date." },
                page: { type: "integer", required: false, description: "Page number." },
                limit: { type: "integer", required: false, description: "Results per page." }
              }
            },
            {
              method: "GET",
              path: "/api/v1/claims/rewards",
              name: "Get Claims Rewards",
              description: "Retrieve hourly aggregated reward and performance metrics for claims. This endpoint groups claims by hour and calculates aggregate statistics including claim counts, total rewards, relay totals, and efficiency metrics. Useful for detailed time-series analysis of claim activity.",
              parameters: [
                { name: "chain", type: "string", required: false, description: "Filter by blockchain chain identifier." },
                { name: "service_id", type: "string", required: false, description: "Filter by service ID." },
                { name: "supplier_address", type: "string", required: false, description: "Filter by supplier address." },
                { name: "start_date", type: "string", required: false, description: "Filter from this date." },
                { name: "end_date", type: "string", required: false, description: "Filter to this date." },
                { name: "page", type: "integer", required: false, default: 1, description: "Page number." },
                { name: "limit", type: "integer", required: false, default: 100, description: "Results per page." }
              ],
              responseExample: {
                data: [
                  {
                    supplier_operator_address: "pokt1supplier123456789abcdefghijk",
                    application_address: "pokt1app123456789abcdefghijklmnop",
                    service_id: "eth-mainnet",
                    hour_bucket: "2025-01-27T10:00:00Z",
                    claim_count: 47,
                    total_rewards_upokt: 4700000,
                    total_relays: 47000,
                    total_claimed_compute_units: 2350000000,
                    total_estimated_compute_units: 2350000000,
                    avg_efficiency_percent: 100.00,
                    avg_reward_per_relay: 100.00,
                    max_reward_per_claim: 200000,
                    min_reward_per_claim: 50000
                  }
                ],
                meta: { total: 720, page: 1, limit: 100, totalPages: 8 }
              }
            },
            {
              method: "GET",
              path: "/api/v1/claims/summary",
              name: "Get Claims Summary",
              description: "Retrieve aggregate summary statistics for claims. This endpoint provides high-level metrics about claim activity including total claims, unique participants, reward totals, and efficiency metrics. Perfect for dashboard overview cards and quick network health checks.",
              parameters: [
                { name: "chain", type: "string", required: false, description: "Filter by blockchain chain identifier." },
                { name: "service_id", type: "string", required: false, description: "Filter by service ID." },
                { name: "supplier_address", type: "string", required: false, description: "Filter by supplier address. Can be comma-separated." },
                { name: "start_date", type: "string", required: false, description: "Filter from this date." },
                { name: "end_date", type: "string", required: false, description: "Filter to this date." }
              ],
              responseExample: {
                data: {
                  total_claims: 1584729,
                  unique_suppliers: 547,
                  unique_applications: 289,
                  unique_services: 45,
                  total_rewards_upokt: 158472900000,
                  total_relays: 158472900,
                  total_claimed_compute_units: 7923645000000,
                  total_estimated_compute_units: 8000000000000,
                  avg_efficiency_percent: 99.05,
                  avg_reward_per_relay: 100.00,
                  first_claim: "2024-01-01T00:00:00Z",
                  last_claim: "2025-01-27T23:59:59Z"
                }
              }
            }
          ]
        },
        {
          name: "Validators",
          description: "Validator endpoints provide comprehensive data about network validators (node operators) including performance metrics, search functionality, and leaderboards. Validators secure the network through staking and block production. These endpoints enable validator discovery, performance comparison, and detailed operational analytics.",
          endpoints: [
            {
              method: "GET",
              path: "/api/v1/validators/search",
              name: "Search Validators and Services",
              description: "Search for validators and blockchain services using a text query. This endpoint searches across validator names (monikers), wallet addresses (both account and operator formats), and service JSON-RPC URLs. Results are categorized into validators and services, making it easy to build autocomplete search interfaces. The search is case-insensitive and supports partial matching.",
              parameters: [
                { name: "q", type: "string", required: true, description: "Search query string (minimum 2 characters). Matches against validator monikers, addresses, and service URLs." },
                { name: "chain", type: "string", required: false, description: "Filter results by blockchain chain identifier." },
                { name: "limit", type: "integer", required: false, default: 20, description: "Maximum number of results per category (validators and services). Maximum is 100." }
              ],
              responseExample: {
                validators: [
                  {
                    type: "validator",
                    validator_account_address: "pokt1validator123456789abcdefghijk",
                    moniker: "Pocket Network Foundation",
                    operator_address: "poktvaloper1validator123456789abcdef"
                  }
                ],
                services: [
                  {
                    type: "service",
                    service_id: "eth-mainnet",
                    json_rpc_url: "https://eth-mainnet.rpc.example.com",
                    supplier_operator_addresses: ["poktvaloper1abc...", "poktvaloper1def..."],
                    supplier_count: 2
                  }
                ]
              }
            },
            {
              method: "GET",
              path: "/api/v1/validators/performance",
              name: "Get Validator Performance List",
              description: "Retrieve performance metrics for validators with flexible filtering and time-based grouping. This endpoint provides comprehensive performance data including submission counts, relay totals, compute units, efficiency percentages, and diversity metrics (unique applications and services). Data can be grouped by day, hour, or aggregated into totals. Use this for building validator leaderboards and performance dashboards.",
              parameters: [
                { name: "domain", type: "string", required: false, description: "Filter by validator website domain (e.g., 'grove.city'). Useful for finding validators from specific organizations." },
                { name: "owner_address", type: "string", required: false, description: "Filter by supplier owner address (pokt1...). Shows all validators owned by a specific address." },
                { name: "supplier_address", type: "string", required: false, description: "Filter by specific supplier operator address(es). Can be comma-separated for multiple addresses." },
                { name: "chain", type: "string", required: false, description: "Filter by blockchain chain identifier." },
                { name: "service_id", type: "string", required: false, description: "Filter by service ID to see performance for a specific blockchain service." },
                { name: "start_date", type: "string", required: false, description: "Start of time range filter (ISO 8601 format)." },
                { name: "end_date", type: "string", required: false, description: "End of time range filter." },
                { name: "group_by", type: "string", required: false, default: "day", description: "Time grouping for results: 'day' (daily buckets), 'hour' (hourly buckets), or 'total' (single aggregate row)." },
                { name: "page", type: "integer", required: false, default: 1, description: "Page number for pagination." },
                { name: "limit", type: "integer", required: false, default: 100, description: "Results per page." }
              ],
              responseExample: {
                data: [
                  {
                    bucket: "2025-01-27T00:00:00Z",
                    supplier_operator_address: "poktvaloper1validator123456789abcdef",
                    owner_address: "pokt1owner123456789abcdefghijklmno",
                    moniker: "Pocket Network Foundation - Node 1",
                    website: "https://pokt.network",
                    website_domain: "pokt.network",
                    validator_status: "BOND_STATUS_BONDED",
                    submissions: 2547,
                    total_relays: 2547000,
                    total_claimed_compute_units: 127350000000,
                    total_estimated_compute_units: 127350000000,
                    avg_efficiency_percent: 100.00,
                    avg_reward_per_relay: 100.00,
                    unique_applications: 89,
                    unique_services: 12
                  }
                ],
                meta: { total: 547, page: 1, limit: 100, totalPages: 6 }
              }
            },
            {
              method: "POST",
              path: "/api/v1/validators/performance",
              name: "Get Validator Performance (POST)",
              description: "Retrieve performance metrics for multiple validators using a POST request. This endpoint is recommended when querying multiple validator addresses to avoid URL length limitations. It returns performance data for all specified validators with optional time-based grouping. When multiple validators are specified, the response includes metadata for each validator.",
              requestBody: {
                operator_addresses: { type: "array", required: true, description: "Array of validator operator addresses (poktvaloper1...) to fetch performance for." },
                chain: { type: "string", required: false, description: "Filter by blockchain chain identifier." },
                service_id: { type: "string", required: false, description: "Filter by service ID." },
                start_date: { type: "string", required: false, description: "Start of time range filter." },
                end_date: { type: "string", required: false, description: "End of time range filter." },
                group_by: { type: "string", required: false, description: "Time grouping: 'day', 'hour', or 'total'." },
                page: { type: "integer", required: false, description: "Page number." },
                limit: { type: "integer", required: false, description: "Results per page." }
              },
              responseExample: {
                data: [
                  {
                    bucket: "2025-01-27T00:00:00Z",
                    supplier_operator_address: "poktvaloper1abc123...",
                    submissions: 1547,
                    total_relays: 1547000,
                    total_claimed_compute_units: 77350000000,
                    avg_efficiency_percent: 100.00,
                    unique_applications: 45,
                    unique_services: 8
                  }
                ],
                validators: [
                  {
                    operator_address: "poktvaloper1abc123...",
                    moniker: "Validator Node 1",
                    website: "https://example.com",
                    website_domain: "example.com",
                    status: "BOND_STATUS_BONDED",
                    jailed: false,
                    tokens: "1500000000000"
                  }
                ],
                meta: { total: 60, page: 1, limit: 100, totalPages: 1 }
              }
            },
            {
              method: "GET",
              path: "/api/v1/validators/:operator_address/performance",
              name: "Get Validator Detail Performance",
              description: "Retrieve detailed performance metrics for a specific validator by their operator address. This endpoint returns time-series performance data along with complete validator metadata. Use this for validator profile pages, detailed performance analysis, and historical trend visualization.",
              parameters: [
                { name: "operator_address", type: "string", required: true, in: "path", description: "The validator's operator address (poktvaloper1...)." },
                { name: "chain", type: "string", required: false, description: "Filter by blockchain chain identifier." },
                { name: "service_id", type: "string", required: false, description: "Filter by service ID." },
                { name: "start_date", type: "string", required: false, description: "Start of time range filter." },
                { name: "end_date", type: "string", required: false, description: "End of time range filter." },
                { name: "group_by", type: "string", required: false, default: "day", description: "Time grouping: 'day', 'hour', or 'total'." },
                { name: "page", type: "integer", required: false, default: 1, description: "Page number." },
                { name: "limit", type: "integer", required: false, default: 100, description: "Results per page." }
              ],
              responseExample: {
                data: [
                  {
                    bucket: "2025-01-27T14:00:00Z",
                    supplier_operator_address: "poktvaloper1validator123...",
                    submissions: 147,
                    total_relays: 147000,
                    total_claimed_compute_units: 7350000000,
                    total_estimated_compute_units: 7350000000,
                    avg_efficiency_percent: 100.00,
                    avg_reward_per_relay: 100.00,
                    unique_applications: 25,
                    unique_services: 8
                  }
                ],
                validator: {
                  operator_address: "poktvaloper1validator123...",
                  moniker: "Pocket Network Foundation - Node 1",
                  website: "https://pokt.network",
                  website_domain: "pokt.network",
                  status: "BOND_STATUS_BONDED",
                  jailed: false,
                  tokens: "1500000000000"
                },
                meta: { total: 24, page: 1, limit: 100, totalPages: 1 }
              }
            },
            {
              method: "GET",
              path: "/api/v1/validators/domains",
              name: "Get Domain Leaderboard",
              description: "Retrieve aggregated performance metrics grouped by validator website domain. This endpoint shows which organizations (identified by their website domains) are contributing the most to the network. Useful for understanding network decentralization, identifying major infrastructure providers, and building organization-level leaderboards.",
              parameters: [
                { name: "chain", type: "string", required: false, description: "Filter by blockchain chain identifier." },
                { name: "service_id", type: "string", required: false, description: "Filter by service ID." },
                { name: "start_date", type: "string", required: false, description: "Start of time range filter." },
                { name: "end_date", type: "string", required: false, description: "End of time range filter." },
                { name: "page", type: "integer", required: false, default: 1, description: "Page number." },
                { name: "limit", type: "integer", required: false, default: 20, description: "Results per page." }
              ],
              responseExample: {
                data: [
                  {
                    domain: "grove.city",
                    validator_count: 15,
                    total_relays: 150000000,
                    total_claimed_compute_units: 7500000000000,
                    total_estimated_compute_units: 7500000000000,
                    avg_efficiency_percent: 100.00
                  },
                  {
                    domain: "pokt.network",
                    validator_count: 8,
                    total_relays: 80000000,
                    total_claimed_compute_units: 4000000000000,
                    total_estimated_compute_units: 4000000000000,
                    avg_efficiency_percent: 100.00
                  }
                ],
                meta: { total: 45, page: 1, limit: 20, totalPages: 3 }
              }
            },
            {
              method: "GET",
              path: "/api/v1/validators/owners",
              name: "Get Owner Leaderboard",
              description: "Retrieve aggregated performance metrics grouped by supplier owner address. Owner addresses represent the entities that control one or more supplier nodes. This endpoint helps identify major node operators in the network, analyze stake concentration, and understand the operator landscape.",
              parameters: [
                { name: "chain", type: "string", required: false, description: "Filter by blockchain chain identifier." },
                { name: "service_id", type: "string", required: false, description: "Filter by service ID." },
                { name: "start_date", type: "string", required: false, description: "Start of time range filter." },
                { name: "end_date", type: "string", required: false, description: "End of time range filter." },
                { name: "page", type: "integer", required: false, default: 1, description: "Page number." },
                { name: "limit", type: "integer", required: false, default: 50, description: "Results per page." }
              ],
              responseExample: {
                data: [
                  {
                    owner_address: "pokt1owner123456789abcdefghijklmno",
                    supplier_count: 5,
                    total_relays: 50000000,
                    total_claimed_compute_units: 2500000000000,
                    total_estimated_compute_units: 2500000000000,
                    avg_efficiency_percent: 100.00
                  }
                ],
                meta: { total: 289, page: 1, limit: 50, totalPages: 6 }
              }
            }
          ]
        },
        {
          name: "Metrics",
          description: "Metrics endpoints provide access to chain-level performance metrics and monitoring data. These endpoints are useful for network health monitoring and operational dashboards.",
          endpoints: [
            {
              method: "GET",
              path: "/api/v1/metrics/chains",
              name: "Get Chain Metrics Overview",
              description: "Retrieve an overview of metrics across all blockchain chains supported by the Pocket Network. This endpoint provides aggregate statistics for each chain including block counts, transaction volumes, and indexing status. Use this for multi-chain monitoring dashboards and network health overviews.",
              parameters: []
            }
          ]
        }
      ]
    }
  ],

  errorHandling: {
    description: "All API endpoints return errors in a consistent JSON format. The response includes an 'error' field with a human-readable description of what went wrong. Use the HTTP status code to determine the error category and the error message for specific details.",
    format: {
      error: "A human-readable description of the error"
    },
    statusCodes: [
      { code: 200, description: "Success - The request was processed successfully and the response contains the requested data." },
      { code: 201, description: "Created - The request successfully created a new resource (used for POST requests that create entities like user accounts or API tokens)." },
      { code: 400, description: "Bad Request - The request was malformed or contained invalid parameters. Check the error message for details about which parameters are invalid." },
      { code: 401, description: "Unauthorized - Authentication is required but was not provided, or the provided credentials (API token or JWT) are invalid or expired." },
      { code: 403, description: "Forbidden - Authentication was successful but you don't have permission to access this resource or perform this action." },
      { code: 404, description: "Not Found - The requested resource (transaction, block, validator, etc.) does not exist." },
      { code: 429, description: "Too Many Requests - You have exceeded the rate limit for this endpoint. Wait before making additional requests. Check response headers for rate limit details." },
      { code: 500, description: "Internal Server Error - An unexpected error occurred on the server. If this persists, please contact support." }
    ]
  },

  commonPatterns: {
    pagination: {
      description: "Most list endpoints support pagination to efficiently handle large datasets. Pagination uses a page-based approach where you specify the page number and results per page. The response includes metadata about the total number of results and pages available.",
      parameters: [
        { name: "page", type: "integer", default: 1, description: "The page number to retrieve (1-indexed, meaning the first page is page 1)." },
        { name: "limit", type: "integer", description: "The number of results to return per page. Each endpoint has its own default and maximum values." }
      ],
      responseFormat: {
        meta: {
          total: "The total number of results matching your query across all pages",
          page: "The current page number being returned",
          limit: "The number of results per page",
          totalPages: "The total number of pages available (calculated as ceil(total/limit))"
        }
      },
      example: "To fetch page 3 with 50 results per page: ?page=3&limit=50"
    },
    dateFiltering: {
      description: "Many endpoints support filtering by date range to query historical data. Dates must be provided in ISO 8601 format with timezone information. If no timezone is specified, UTC is assumed.",
      format: "ISO 8601 format: YYYY-MM-DDTHH:mm:ssZ (e.g., '2025-01-27T10:30:00Z')",
      parameters: [
        { name: "start_date", description: "Include results from this date/time onwards (inclusive)" },
        { name: "end_date", description: "Include results up to this date/time (inclusive)" }
      ],
      example: "To query data for January 2025: ?start_date=2025-01-01T00:00:00Z&end_date=2025-01-31T23:59:59Z"
    },
    chainFiltering: {
      description: "Most endpoints support filtering by blockchain chain. This is useful when you want to query data for a specific network (mainnet vs testnet) or when you're building chain-specific views.",
      parameter: { name: "chain", example: "pocket-mainnet", description: "The blockchain chain identifier" },
      commonValues: ["pocket-mainnet", "pocket-testnet"],
      example: "To query mainnet data: ?chain=pocket-mainnet"
    }
  }
};

/**
 * Get full API documentation
 * @returns {Object} Complete API documentation
 */
function getApiDocumentation() {
  return API_DOCUMENTATION;
}

/**
 * Get documentation for a specific category
 * @param {string} categoryName - Category name (e.g., "Public Endpoints")
 * @returns {Object|null} Category documentation or null if not found
 */
function getCategoryDocumentation(categoryName) {
  return API_DOCUMENTATION.categories.find(cat =>
    cat.name.toLowerCase() === categoryName.toLowerCase()
  ) || null;
}

/**
 * Get documentation for a specific endpoint
 * @param {string} method - HTTP method
 * @param {string} path - Endpoint path
 * @returns {Object|null} Endpoint documentation or null if not found
 */
function getEndpointDocumentation(method, path) {
  for (const category of API_DOCUMENTATION.categories) {
    for (const group of category.groups) {
      const endpoint = group.endpoints.find(ep =>
        ep.method.toUpperCase() === method.toUpperCase() && ep.path === path
      );
      if (endpoint) {
        return {
          ...endpoint,
          category: category.name,
          group: group.name,
          authLevel: category.authLevel
        };
      }
    }
  }
  return null;
}

/**
 * Search endpoints by keyword
 * @param {string} query - Search query
 * @returns {Array} Matching endpoints
 */
function searchEndpoints(query) {
  const results = [];
  const lowerQuery = query.toLowerCase();

  for (const category of API_DOCUMENTATION.categories) {
    for (const group of category.groups) {
      for (const endpoint of group.endpoints) {
        if (
          endpoint.name.toLowerCase().includes(lowerQuery) ||
          endpoint.path.toLowerCase().includes(lowerQuery) ||
          (endpoint.description && endpoint.description.toLowerCase().includes(lowerQuery))
        ) {
          results.push({
            ...endpoint,
            category: category.name,
            group: group.name,
            authLevel: category.authLevel
          });
        }
      }
    }
  }

  return results;
}

module.exports = {
  getApiDocumentation,
  getCategoryDocumentation,
  getEndpointDocumentation,
  searchEndpoints,
  API_DOCUMENTATION
};
