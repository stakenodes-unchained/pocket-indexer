# Pocket Network Transaction Message Types

This document provides a comprehensive reference for all transaction message types in the Pocket Network, including their data structures, processing requirements, and indexing instructions for the indexer.

## Table of Contents

1. [Message Type Overview](#message-type-overview)
2. [Application Module Messages](#application-module-messages)
3. [Supplier Module Messages](#supplier-module-messages)
4. [Gateway Module Messages](#gateway-module-messages)
5. [Service Module Messages](#service-module-messages)
6. [Proof Module Messages](#proof-module-messages)
7. [Session Module Messages](#session-module-messages)
8. [Tokenomics Module Messages](#tokenomics-module-messages)
9. [Shared Module Messages](#shared-module-messages)
10. [Migration Module Messages](#migration-module-messages)
11. [Governance Messages](#governance-messages)
12. [Cosmos SDK Messages](#cosmos-sdk-messages)
13. [Message Processing Instructions](#message-processing-instructions)
14. [Indexer Processing Logic](#indexer-processing-logic)

## Message Type Overview

Pocket Network uses a modular architecture where each module defines its own message types. Messages are identified by their `type_url` which follows the pattern: `pocket.{module}.{MessageName}`.

### Message Categories

- **Core Protocol Messages**: Application, Supplier, Gateway, Service management
- **Proof-of-Relay Messages**: Claims and proofs for relay verification
- **Session Management**: Session creation and management
- **Economic Messages**: Staking, unstaking, delegation, rewards
- **Governance Messages**: Parameter updates and network administration
- **Migration Messages**: Legacy system migration and account recovery

## Application Module Messages

### 1. MsgStakeApplication
**Type URL**: `pocket.application.MsgStakeApplication`

**Purpose**: Allows an application to stake POKT tokens and configure services

**Data Structure**:
```json
{
  "address": "string",           // Bech32 address of the application
  "stake": {                     // Staking amount
    "denom": "upokt",
    "amount": "string"
  },
  "services": [                  // Service configurations
    {
      "service_id": "string",
      "endpoints": ["string"],
      "config_options": {}
    }
  ]
}
```

**Indexer Processing**:
- Create/update `applications` table record
- Set `stake_amount`, `stake_denom`, `created_block`, `updated_block`
- Create `application_service_configs` records
- Update `applications` table `is_active` to `true`
- Record state change: `CREATE` or `UPDATE` entity type `application`

**State Changes**:
- Application entity created/updated
- Stake amount recorded
- Service configurations stored
- Application becomes active

### 2. MsgUnstakeApplication
**Type URL**: `pocket.application.MsgUnstakeApplication`

**Purpose**: Initiates unstaking process for an application

**Data Structure**:
```json
{
  "address": "string"            // Bech32 address of the application
}
```

**Indexer Processing**:
- Update `applications` table `unstake_session_end_height`
- Set `is_active` to `false` after unbonding period
- Record state change: `UPDATE` entity type `application`

**State Changes**:
- Application marked for unstaking
- Unstake session end height recorded
- Application becomes inactive after unbonding

### 3. MsgDelegateToGateway
**Type URL**: `pocket.application.MsgDelegateToGateway`

**Purpose**: Establishes delegation relationship between application and gateway

**Data Structure**:
```json
{
  "app_address": "string",       // Application address
  "gateway_address": "string"    // Gateway address to delegate to
}
```

**Indexer Processing**:
- Create `delegations` table record
- Set `from_entity_type` to `application`, `to_entity_type` to `gateway`
- Set `relationship_type` to `delegation`, `action` to `create`
- Update `applications` table `delegatee_gateway_addresses` array
- Record relationship change: `CREATE` relationship type `delegation`

**State Changes**:
- Delegation relationship created
- Application gateway list updated
- Relationship tracking established

### 4. MsgUndelegateFromGateway
**Type URL**: `pocket.application.MsgUndelegateFromGateway`

**Purpose**: Removes delegation relationship between application and gateway

**Data Structure**:
```json
{
  "app_address": "string",       // Application address
  "gateway_address": "string"    // Gateway address to undelegate from
}
```

**Indexer Processing**:
- Update `delegations` table `is_active` to `false`
- Add gateway to `applications` table `pending_undelegations`
- Record relationship change: `DELETE` relationship type `delegation`

**State Changes**:
- Delegation relationship marked inactive
- Gateway added to pending undelegations
- Relationship tracking updated

### 5. MsgTransferApplication
**Type URL**: `pocket.application.MsgTransferApplication`

**Purpose**: Transfers application ownership to a new address

**Data Structure**:
```json
{
  "source_address": "string",    // Current owner address
  "destination_address": "string" // New owner address
}
```

**Indexer Processing**:
- Update `applications` table `address` to new owner
- Create `pending_transfer` record with session end height
- Record state change: `UPDATE` entity type `application`

**State Changes**:
- Application ownership transferred
- Transfer pending until session end
- Ownership change tracked

### 6. MsgUpdateParam (Application)
**Type URL**: `pocket.application.MsgUpdateParam`

**Purpose**: Updates single application module parameter

**Data Structure**:
```json
{
  "authority": "string",         // Governance authority address
  "name": "string",              // Parameter name
  "as_uint64": "uint64"          // Parameter value (uint64)
}
```

**Indexer Processing**:
- Update `network_parameters` table for application module
- Record parameter change in `state_changes` table
- Update `last_updated_block` and `last_updated_timestamp`

**State Changes**:
- Module parameter updated
- Parameter change tracked
- Governance action recorded

## Supplier Module Messages

### 1. MsgStakeSupplier
**Type URL**: `pocket.supplier.MsgStakeSupplier`

**Purpose**: Allows a supplier to stake POKT tokens and offer services

**Data Structure**:
```json
{
  "signer": "string",            // Message signer address
  "owner_address": "string",     // Owner address (custodial)
  "operator_address": "string",  // Operator address (non-custodial)
  "stake": {                     // Staking amount
    "denom": "upokt",
    "amount": "string"
  },
  "services": [                  // Service configurations
    {
      "service_id": "string",
      "endpoints": ["string"],
      "config_options": {}
    }
  ]
}
```

**Indexer Processing**:
- Create/update `suppliers` table record
- Set `operator_address`, `owner_address`, `stake_amount`, `stake_denom`
- Create `supplier_service_configs` records
- Update `suppliers` table `is_active` to `true`
- Record state change: `CREATE` or `UPDATE` entity type `supplier`

**State Changes**:
- Supplier entity created/updated
- Stake amount recorded
- Service configurations stored
- Supplier becomes active

### 2. MsgUnstakeSupplier
**Type URL**: `pocket.supplier.MsgUnstakeSupplier`

**Purpose**: Initiates unstaking process for a supplier

**Data Structure**:
```json
{
  "signer": "string",            // Message signer address
  "operator_address": "string"   // Supplier operator address
}
```

**Indexer Processing**:
- Update `suppliers` table `unstake_session_end_height`
- Set `is_active` to `false` after unbonding period
- Record state change: `UPDATE` entity type `supplier`

**State Changes**:
- Supplier marked for unstaking
- Unstake session end height recorded
- Supplier becomes inactive after unbonding

### 3. MsgUpdateParam (Supplier)
**Type URL**: `pocket.supplier.MsgUpdateParam`

**Purpose**: Updates single supplier module parameter

**Data Structure**:
```json
{
  "authority": "string",         // Governance authority address
  "name": "string",              // Parameter name
  "as_coin": {                   // Parameter value (coin)
    "denom": "string",
    "amount": "string"
  }
}
```

**Indexer Processing**:
- Update `network_parameters` table for supplier module
- Record parameter change in `state_changes` table
- Update `last_updated_block` and `last_updated_timestamp`

**State Changes**:
- Module parameter updated
- Parameter change tracked
- Governance action recorded

## Gateway Module Messages

### 1. MsgStakeGateway
**Type URL**: `pocket.gateway.MsgStakeGateway`

**Purpose**: Allows a gateway to stake POKT tokens

**Data Structure**:
```json
{
  "address": "string",           // Gateway address
  "stake": {                     // Staking amount
    "denom": "upokt",
    "amount": "string"
  }
}
```

**Indexer Processing**:
- Create/update `gateways` table record
- Set `address`, `stake_amount`, `stake_denom`
- Update `gateways` table `is_active` to `true`
- Record state change: `CREATE` or `UPDATE` entity type `gateway`

**State Changes**:
- Gateway entity created/updated
- Stake amount recorded
- Gateway becomes active

### 2. MsgUnstakeGateway
**Type URL**: `pocket.gateway.MsgUnstakeGateway`

**Purpose**: Initiates unstaking process for a gateway

**Data Structure**:
```json
{
  "address": "string"            // Gateway address
}
```

**Indexer Processing**:
- Update `gateways` table `unstake_session_end_height`
- Set `is_active` to `false` after unbonding period
- Record state change: `UPDATE` entity type `gateway`

**State Changes**:
- Gateway marked for unstaking
- Unstake session end height recorded
- Gateway becomes inactive after unbonding

### 3. MsgUpdateParam (Gateway)
**Type URL**: `pocket.gateway.MsgUpdateParam`

**Purpose**: Updates single gateway module parameter

**Data Structure**:
```json
{
  "authority": "string",         // Governance authority address
  "name": "string",              // Parameter name
  "as_coin": {                   // Parameter value (coin)
    "denom": "string",
    "amount": "string"
  }
}
```

**Indexer Processing**:
- Update `network_parameters` table for gateway module
- Record parameter change in `state_changes` table
- Update `last_updated_block` and `last_updated_timestamp`

**State Changes**:
- Module parameter updated
- Parameter change tracked
- Governance action recorded

## Service Module Messages

### 1. MsgAddService
**Type URL**: `pocket.service.MsgAddService`

**Purpose**: Adds a new service to the network

**Data Structure**:
```json
{
  "owner_address": "string",     // Service owner address
  "service": {                    // Service definition
    "id": "string",
    "name": "string",
    "description": "string",
    "compute_units_per_relay": "uint64",
    "endpoints": ["string"],
    "config_options": {}
  }
}
```

**Indexer Processing**:
- Create `services` table record
- Set `id`, `name`, `description`, `compute_units_per_relay`
- Set `owner_address`, `created_block`, `created_timestamp`
- Record state change: `CREATE` entity type `service`

**State Changes**:
- Service entity created
- Service configuration stored
- Service becomes available

### 2. MsgUpdateParam (Service)
**Type URL**: `pocket.service.MsgUpdateParam`

**Purpose**: Updates single service module parameter

**Data Structure**:
```json
{
  "authority": "string",         // Governance authority address
  "name": "string",              // Parameter name
  "as_coin": {                   // Parameter value (coin)
    "denom": "string",
    "amount": "string"
  }
}
```

**Indexer Processing**:
- Update `network_parameters` table for service module
- Record parameter change in `state_changes` table
- Update `last_updated_block` and `last_updated_timestamp`

**State Changes**:
- Module parameter updated
- Parameter change tracked
- Governance action recorded

## Proof Module Messages

### 1. MsgCreateClaim
**Type URL**: `pocket.proof.MsgCreateClaim`

**Purpose**: Supplier submits claim for relays served in a session

**Data Structure**:
```json
{
  "supplier_operator_address": "string", // Supplier operator address
  "session_header": {                     // Session information
    "application_address": "string",
    "service_id": "string",
    "session_start_block_height": "uint64",
    "session_end_block_height": "uint64"
  },
  "root_hash": "bytes"                   // Sparse Merkle Sum Tree root hash
}
```

**Indexer Processing**:
- Create `claims` table record
- Set `session_id`, `supplier_address`, `root_hash`
- Set `session_start_block`, `session_end_block`
- Set `created_block`, `created_timestamp`
- Record state change: `CREATE` entity type `claim`

**State Changes**:
- Claim entity created
- Session relay data recorded
- Proof submission window opened

### 2. MsgSubmitProof
**Type URL**: `pocket.proof.MsgSubmitProof`

**Purpose**: Supplier submits proof for claim verification

**Data Structure**:
```json
{
  "supplier_operator_address": "string", // Supplier operator address
  "session_header": {                     // Session information
    "application_address": "string",
    "service_id": "string",
    "session_start_block_height": "uint64",
    "session_end_block_height": "uint64"
  },
  "proof": "bytes"                       // Compact Merkle proof
}
```

**Indexer Processing**:
- Create `proofs` table record
- Set `session_id`, `supplier_address`, `proof_data`
- Set `session_start_block`, `session_end_block`
- Set `created_block`, `created_timestamp`
- Record state change: `CREATE` entity type `proof`

**State Changes**:
- Proof entity created
- Proof verification data recorded
- Claim settlement process initiated

### 3. MsgUpdateParam (Proof)
**Type URL**: `pocket.proof.MsgUpdateParam`

**Purpose**: Updates single proof module parameter

**Data Structure**:
```json
{
  "authority": "string",         // Governance authority address
  "name": "string",              // Parameter name
  "as_bytes": "bytes"            // Parameter value (bytes)
}
```

**Indexer Processing**:
- Update `network_parameters` table for proof module
- Record parameter change in `state_changes` table
- Update `last_updated_block` and `last_updated_timestamp`

**State Changes**:
- Module parameter updated
- Parameter change tracked
- Governance action recorded

## Session Module Messages

### 1. MsgUpdateParam (Session)
**Type URL**: `pocket.session.MsgUpdateParam`

**Purpose**: Updates single session module parameter

**Data Structure**:
```json
{
  "authority": "string",         // Governance authority address
  "name": "string",              // Parameter name
  "as_uint64": "uint64"          // Parameter value (uint64)
}
```

**Indexer Processing**:
- Update `network_parameters` table for session module
- Record parameter change in `state_changes` table
- Update `last_updated_block` and `last_updated_timestamp`

**State Changes**:
- Module parameter updated
- Parameter change tracked
- Governance action recorded

## Tokenomics Module Messages

### 1. MsgUpdateParam (Tokenomics)
**Type URL**: `pocket.tokenomics.MsgUpdateParam`

**Purpose**: Updates single tokenomics module parameter

**Data Structure**:
```json
{
  "authority": "string",         // Governance authority address
  "name": "string",              // Parameter name
  "as_mint_allocation_percentages": { // Parameter value (mint allocation)
    "applications": "float",
    "suppliers": "float",
    "gateways": "float",
    "validators": "float",
    "dao": "float"
  }
}
```

**Indexer Processing**:
- Update `network_parameters` table for tokenomics module
- Record parameter change in `state_changes` table
- Update `last_updated_block` and `last_updated_timestamp`

**State Changes**:
- Module parameter updated
- Parameter change tracked
- Governance action recorded

## Shared Module Messages

### 1. MsgUpdateParam (Shared)
**Type URL**: `pocket.shared.MsgUpdateParam`

**Purpose**: Updates single shared module parameter

**Data Structure**:
```json
{
  "authority": "string",         // Governance authority address
  "name": "string",              // Parameter name
  "as_uint64": "uint64"          // Parameter value (uint64)
}
```

**Indexer Processing**:
- Update `network_parameters` table for shared module
- Record parameter change in `state_changes` table
- Update `last_updated_block` and `last_updated_timestamp`

**State Changes**:
- Module parameter updated
- Parameter change tracked
- Governance action recorded

## Migration Module Messages

### 1. MsgClaimMorseAccount
**Type URL**: `pocket.migration.MsgClaimMorseAccount`

**Purpose**: Claims Morse account during migration

**Data Structure**:
```json
{
  "authority": "string",         // Migration authority address
  "morse_address": "string",     // Morse address to claim
  "pocket_address": "string"     // Pocket address to claim to
}
```

**Indexer Processing**:
- Create migration claim record
- Record account recovery action
- Track migration progress

**State Changes**:
- Migration claim recorded
- Account recovery initiated
- Migration state updated

### 2. MsgClaimMorseApplication
**Type URL**: `pocket.migration.MsgClaimMorseApplication`

**Purpose**: Claims Morse application during migration

**Data Structure**:
```json
{
  "authority": "string",         // Migration authority address
  "morse_address": "string",     // Morse application address
  "pocket_address": "string"     // Pocket application address
}
```

**Indexer Processing**:
- Create application migration record
- Record application recovery action
- Track migration progress

**State Changes**:
- Application migration recorded
- Application recovery initiated
- Migration state updated

### 3. MsgClaimMorseSupplier
**Type URL**: `pocket.migration.MsgClaimMorseSupplier`

**Purpose**: Claims Morse supplier during migration

**Data Structure**:
```json
{
  "authority": "string",         // Migration authority address
  "morse_address": "string",     // Morse supplier address
  "pocket_address": "string"     // Pocket supplier address
}
```

**Indexer Processing**:
- Create supplier migration record
- Record supplier recovery action
- Track migration progress

**State Changes**:
- Supplier migration recorded
- Supplier recovery initiated
- Migration state updated

## Governance Messages

### 1. MsgUpdateParams (All Modules)
**Type URL**: `pocket.{module}.MsgUpdateParams`

**Purpose**: Updates all parameters for a module at once

**Data Structure**:
```json
{
  "authority": "string",         // Governance authority address
  "params": {                    // Complete parameter set
    // Module-specific parameters
  }
}
```

**Indexer Processing**:
- Update `network_parameters` table for specified module
- Record all parameter changes in `state_changes` table
- Update `last_updated_block` and `last_updated_timestamp`

**State Changes**:
- All module parameters updated
- Parameter changes tracked
- Governance action recorded

## Cosmos SDK Messages

### 1. Bank Transfer Messages
**Type URL**: `cosmos.bank.v1beta1.MsgSend`, `cosmos.bank.v1beta1.MsgMultiSend`

**Purpose**: Standard Cosmos SDK bank transfers

**Indexer Processing**:
- Record token transfers in `token_transfers` table
- Track economic impact
- Update account balances

**State Changes**:
- Token balances updated
- Transfer history recorded
- Economic activity tracked

### 2. Staking Messages
**Type URL**: `cosmos.staking.v1beta1.MsgDelegate`, `cosmos.staking.v1beta1.MsgUndelegate`

**Purpose**: Standard Cosmos SDK staking operations

**Indexer Processing**:
- Record staking changes
- Track validator participation
- Update staking metrics

**State Changes**:
- Staking positions updated
- Validator power changed
- Staking metrics updated

## Message Processing Instructions

### Processing Priority

1. **High Priority**: Core protocol messages (stake, unstake, delegate)
2. **Medium Priority**: Proof and session messages
3. **Low Priority**: Governance and parameter updates

### Error Handling

- **Validation Errors**: Log and skip invalid messages
- **Processing Errors**: Retry with exponential backoff
- **Critical Errors**: Alert and halt processing

### State Consistency

- **Atomic Updates**: Ensure related entities updated together
- **Rollback Support**: Maintain previous state for error recovery
- **Consistency Checks**: Validate entity relationships after updates

## Indexer Processing Logic

### Message Type Detection

```python
def detect_message_type(type_url: str) -> MessageType:
    if type_url.startswith('pocket.application.'):
        return MessageType.APPLICATION
    elif type_url.startswith('pocket.supplier.'):
        return MessageType.SUPPLIER
    elif type_url.startswith('pocket.gateway.'):
        return MessageType.GATEWAY
    elif type_url.startswith('pocket.service.'):
        return MessageType.SERVICE
    elif type_url.startswith('pocket.proof.'):
        return MessageType.PROOF
    elif type_url.startswith('pocket.session.'):
        return MessageType.SESSION
    elif type_url.startswith('pocket.tokenomics.'):
        return MessageType.TOKENOMICS
    elif type_url.startswith('pocket.shared.'):
        return MessageType.SHARED
    elif type_url.startswith('pocket.migration.'):
        return MessageType.MIGRATION
    elif type_url.startswith('cosmos.'):
        return MessageType.COSMOS
    else:
        return MessageType.UNKNOWN
```

### Processing Pipeline

1. **Message Parsing**: Extract message data and type
2. **Validation**: Verify message structure and data
3. **State Update**: Apply changes to database
4. **Relationship Update**: Update entity relationships
5. **Event Recording**: Record state and relationship changes
6. **Metrics Update**: Update processing metrics

### Database Operations

- **Insert**: New entities and relationships
- **Update**: Existing entity modifications
- **Delete**: Soft delete with status flags
- **Upsert**: Create or update based on existence

### Performance Considerations

- **Batch Processing**: Group related operations
- **Indexing**: Optimize query performance
- **Caching**: Cache frequently accessed data
- **Async Processing**: Non-blocking message handling

This document provides the complete reference for implementing message processing in the Pocket Network indexer, ensuring accurate and efficient tracking of all network state changes.
