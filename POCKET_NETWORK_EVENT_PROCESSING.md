# Pocket Network Event Processing Requirements

## Document Purpose

This document provides comprehensive requirements for processing all event types from all Pocket Network modules. Events are critical for maintaining complete data parity in the indexer, as they contain state information that cannot be derived from transaction messages alone.

This document should be used in conjunction with:
- `POCKET_NETWORK_INDEXER_REQUIREMENTS.md` - Main indexer architecture and requirements
- `POCKET_NETWORK_MESSAGE_TYPES.md` - Transaction message type reference

## Table of Contents

1. [Introduction & Overview](#introduction--overview)
2. [Event Categories](#event-categories)
3. [Event Data Models](#event-data-models)
4. [Event Collection & Extraction](#event-collection--extraction)
5. [Historical Backfilling Requirements](#historical-backfilling-requirements)
6. [Real-Time Event Processing](#real-time-event-processing)
7. [Event Processing Logic](#event-processing-logic)
8. [Database Schema](#database-schema)
9. [State Change Tracking](#state-change-tracking)
10. [Integration with Existing Indexer](#integration-with-existing-indexer)
11. [Performance & Scalability](#performance--scalability)
12. [Error Handling & Recovery](#error-handling--recovery)

---

## Introduction & Overview

### Purpose of Event Processing

Events in Pocket Network are emitted during block processing to signal state changes that occur as a result of:
- **Transaction execution**: Events emitted when transactions are processed
- **Block-level operations**: Events emitted during BeginBlock/EndBlock hooks (e.g., claim settlement, unbonding completion)

Events provide critical information that complements transaction messages:
- **Entity lifecycle events**: Staking, unstaking, unbonding, transfers
- **Economic impacts**: Rewards, burns, slashes, reimbursements
- **Protocol operations**: Claim settlements, proof validations, service config changes
- **State transitions**: Status changes that occur automatically (not via transactions)

### Difference Between Messages and Events

**Transaction Messages:**
- User-initiated actions submitted in transactions
- Represent intent (e.g., "I want to stake")
- Processed during transaction execution
- Can fail validation or execution

**Events:**
- System-generated signals about state changes
- Represent outcomes (e.g., "stake was successful", "claim was settled")
- Emitted during transaction execution OR block processing
- Always emitted when the state change occurs (even if no transaction was involved)

### Why Events Are Critical for Data Parity

Without event processing, the indexer misses:
- **Automatic state transitions**: Unbonding completions, claim settlements
- **Economic activities**: Reward distributions, burns, slashes
- **Entity lifecycle**: When entities become active/inactive
- **Protocol operations**: Mining difficulty updates, service config activations
- **Migration data**: Morse account claims and recoveries

### Event Sources

Events come from two sources in block data:

1. **Transaction Events** (`block.txs_results[].events`):
   - Emitted during transaction execution
   - Linked to specific transaction hash
   - Include events from message handlers

2. **Block Events** (`block.finalize_block_events`):
   - Emitted during BeginBlock/EndBlock hooks
   - Not linked to specific transactions
   - Include automatic operations (claim settlement, unbonding checks, etc.)

Both sources must be processed to maintain complete data parity.

---

## Event Categories

Pocket Network emits 34 distinct event types across 7 modules. Each event type represents a specific state change or protocol operation.

### Tokenomics Events (6 events)

These events track the economic outcomes of claim settlement and protocol operations:

1. **EventClaimSettled** - Emitted when a claim is successfully settled with reward distribution
2. **EventClaimExpired** - Emitted when a claim expires due to missing or invalid proof
3. **EventSupplierSlashed** - Emitted when a supplier is penalized for missing/invalid proof
4. **EventApplicationOverserviced** - Emitted when application stake is insufficient to cover claim
5. **EventClaimDiscarded** - Emitted when a claim is discarded due to errors
6. **EventApplicationReimbursementRequest** - Emitted when application requests DAO reimbursement

### Application Events (8 events)

These events track application lifecycle and state changes:

1. **EventApplicationStaked** - Emitted when application is staked or up-staked
2. **EventRedelegation** - Emitted when application changes gateway delegations
3. **EventTransferBegin** - Emitted when application transfer is initiated
4. **EventTransferEnd** - Emitted when application transfer completes successfully
5. **EventTransferError** - Emitted when application transfer fails
6. **EventApplicationUnbondingBegin** - Emitted when application unbonding starts
7. **EventApplicationUnbondingEnd** - Emitted when application unbonding completes
8. **EventApplicationUnbondingCanceled** - Emitted when application unbonding is canceled

### Supplier Events (5 events)

These events track supplier lifecycle and service configuration:

1. **EventSupplierStaked** - Emitted when supplier is staked or up-staked
2. **EventSupplierUnbondingBegin** - Emitted when supplier unbonding starts
3. **EventSupplierUnbondingEnd** - Emitted when supplier unbonding completes
4. **EventSupplierUnbondingCanceled** - Emitted when supplier unbonding is canceled
5. **EventSupplierServiceConfigActivated** - Emitted when supplier service configuration becomes active

### Gateway Events (4 events)

These events track gateway lifecycle:

1. **EventGatewayStaked** - Emitted when gateway is staked or up-staked
2. **EventGatewayUnbondingBegin** - Emitted when gateway unbonding starts
3. **EventGatewayUnbondingEnd** - Emitted when gateway unbonding completes
4. **EventGatewayUnbondingCanceled** - Emitted when gateway unbonding is canceled

### Proof Events (5 events)

These events track claim and proof lifecycle:

1. **EventClaimCreated** - Emitted when supplier creates a claim
2. **EventClaimUpdated** - Emitted when supplier updates a claim
3. **EventProofSubmitted** - Emitted when supplier submits a proof
4. **EventProofUpdated** - Emitted when supplier updates a proof
5. **EventProofValidityChecked** - Emitted when proof validation is checked

### Service Events (1 event)

1. **EventRelayMiningDifficultyUpdated** - Emitted when relay mining difficulty is updated for a service

### Migration Events (5 events)

These events track Morse network migration:

1. **EventImportMorseClaimableAccounts** - Emitted when Morse claimable accounts are imported
2. **EventMorseAccountClaimed** - Emitted when Morse account is claimed
3. **EventMorseApplicationClaimed** - Emitted when Morse application is claimed
4. **EventMorseSupplierClaimed** - Emitted when Morse supplier is claimed
5. **EventMorseAccountRecovered** - Emitted when Morse account is recovered

---

## Event Data Models

This section provides complete Python dataclass definitions for all event types. Each event includes metadata about when and where it was emitted.

### Event Metadata

All events should include the following metadata when stored:

```python
@dataclass
class EventMetadata:
    block_height: int
    block_timestamp: datetime
    transaction_hash: Optional[str]  # None for block-level events
    event_source: str  # "transaction" or "block"
    event_index: int  # Index within the event list
    created_timestamp: datetime
```

### Enums

```python
from enum import Enum

class ClaimExpirationReason(Enum):
    EXPIRATION_REASON_UNSPECIFIED = 0
    PROOF_MISSING = 1
    PROOF_INVALID = 2

class ClaimProofStatus(Enum):
    PENDING_VALIDATION = 0
    VALIDATED = 1
    INVALID = 2

class ProofRequirementReason(Enum):
    NOT_REQUIRED = 0
    PROBABILISTIC = 1
    THRESHOLD = 2

class ApplicationUnbondingReason(Enum):
    APPLICATION_UNBONDING_REASON_ELECTIVE = 0
    APPLICATION_UNBONDING_REASON_BELOW_MIN_STAKE = 1
    APPLICATION_UNBONDING_REASON_MIGRATION = 2

class SupplierUnbondingReason(Enum):
    SUPPLIER_UNBONDING_REASON_UNSPECIFIED = 0
    SUPPLIER_UNBONDING_REASON_VOLUNTARY = 1
    SUPPLIER_UNBONDING_REASON_BELOW_MIN_STAKE = 2
    SUPPLIER_UNBONDING_REASON_MIGRATION = 3

class MorseSupplierClaimSignerType(Enum):
    MORSE_SUPPLIER_CLAIM_SIGNER_TYPE_NON_CUSTODIAL_SIGNED_BY_ADDR = 0
    MORSE_SUPPLIER_CLAIM_SIGNER_TYPE_CUSTODIAL_SIGNED_BY_OPERATOR = 1
    MORSE_SUPPLIER_CLAIM_SIGNER_TYPE_CUSTODIAL_SIGNED_BY_OWNER = 2
```

### Tokenomics Event Models

#### EventClaimSettled

```python
@dataclass
class EventClaimSettled:
    proof_requirement_int: int  # ProofRequirementReason enum value
    num_relays: int
    num_claimed_compute_units: int
    num_estimated_compute_units: int
    claimed_upokt: str
    service_id: str
    application_address: str
    session_end_block_height: int
    claim_proof_status_int: int  # ClaimProofStatus enum value
    supplier_operator_address: str
    reward_distribution: Dict[str, str]  # address -> amount in uPOKT
    metadata: EventMetadata
```

#### EventClaimExpired

```python
@dataclass
class EventClaimExpired:
    expiration_reason: int  # ClaimExpirationReason enum value
    num_relays: int
    num_claimed_compute_units: int
    num_estimated_compute_units: int
    claimed_upokt: str
    service_id: str
    application_address: str
    session_end_block_height: int
    claim_proof_status_int: int
    supplier_operator_address: str
    metadata: EventMetadata
```

#### EventSupplierSlashed

```python
@dataclass
class EventSupplierSlashed:
    proof_missing_penalty: str  # uPOKT amount slashed
    service_id: str
    application_address: str
    session_end_block_height: int
    claim_proof_status_int: int
    supplier_operator_address: str
    metadata: EventMetadata
```

#### EventApplicationOverserviced

```python
@dataclass
class EventApplicationOverserviced:
    application_addr: str
    supplier_operator_addr: str
    expected_burn: str  # Expected uPOKT burn amount
    effective_burn: str  # Actual uPOKT burn amount
    metadata: EventMetadata
```

#### EventClaimDiscarded

```python
@dataclass
class EventClaimDiscarded:
    error: str
    service_id: str
    application_address: str
    session_end_block_height: int
    claim_proof_status_int: int
    supplier_operator_address: str
    metadata: EventMetadata
```

#### EventApplicationReimbursementRequest

```python
@dataclass
class EventApplicationReimbursementRequest:
    application_addr: str
    supplier_operator_addr: str
    supplier_owner_addr: str
    service_id: str
    session_id: str
    amount: str  # uPOKT amount to reimburse
    metadata: EventMetadata
```

### Application Event Models

#### EventApplicationStaked

```python
@dataclass
class EventApplicationStaked:
    application: Application  # Full application object
    session_end_height: int
    metadata: EventMetadata
```

#### EventRedelegation

```python
@dataclass
class EventRedelegation:
    application: Application  # Full application object with updated delegations
    session_end_height: int
    metadata: EventMetadata
```

#### EventTransferBegin

```python
@dataclass
class EventTransferBegin:
    source_address: str
    destination_address: str
    source_application: Application
    session_end_height: int
    transfer_end_height: int
    metadata: EventMetadata
```

#### EventTransferEnd

```python
@dataclass
class EventTransferEnd:
    source_address: str
    destination_address: str
    destination_application: Application
    session_end_height: int
    transfer_end_height: int
    metadata: EventMetadata
```

#### EventTransferError

```python
@dataclass
class EventTransferError:
    source_address: str
    destination_address: str
    source_application: Application
    session_end_height: int
    error: str
    metadata: EventMetadata
```

#### EventApplicationUnbondingBegin

```python
@dataclass
class EventApplicationUnbondingBegin:
    application: Application
    reason: int  # ApplicationUnbondingReason enum value
    session_end_height: int
    unbonding_end_height: int
    metadata: EventMetadata
```

#### EventApplicationUnbondingEnd

```python
@dataclass
class EventApplicationUnbondingEnd:
    application: Application
    reason: int  # ApplicationUnbondingReason enum value
    session_end_height: int
    unbonding_end_height: int
    metadata: EventMetadata
```

#### EventApplicationUnbondingCanceled

```python
@dataclass
class EventApplicationUnbondingCanceled:
    application: Application
    session_end_height: int
    metadata: EventMetadata
```

### Supplier Event Models

#### EventSupplierStaked

```python
@dataclass
class EventSupplierStaked:
    session_end_height: int
    operator_address: str
    metadata: EventMetadata
```

#### EventSupplierUnbondingBegin

```python
@dataclass
class EventSupplierUnbondingBegin:
    supplier: Supplier  # Full supplier object
    reason: int  # SupplierUnbondingReason enum value
    session_end_height: int
    unbonding_end_height: int
    metadata: EventMetadata
```

#### EventSupplierUnbondingEnd

```python
@dataclass
class EventSupplierUnbondingEnd:
    supplier: Supplier
    reason: int  # SupplierUnbondingReason enum value
    session_end_height: int
    unbonding_end_height: int
    metadata: EventMetadata
```

#### EventSupplierUnbondingCanceled

```python
@dataclass
class EventSupplierUnbondingCanceled:
    supplier: Supplier
    height: int
    session_end_height: int
    metadata: EventMetadata
```

#### EventSupplierServiceConfigActivated

```python
@dataclass
class EventSupplierServiceConfigActivated:
    activation_height: int
    operator_address: str
    service_id: str
    metadata: EventMetadata
```

### Gateway Event Models

#### EventGatewayStaked

```python
@dataclass
class EventGatewayStaked:
    gateway: Gateway  # Full gateway object
    session_end_height: int
    metadata: EventMetadata
```

#### EventGatewayUnbondingBegin

```python
@dataclass
class EventGatewayUnbondingBegin:
    gateway: Gateway
    session_end_height: int
    unbonding_end_height: int
    metadata: EventMetadata
```

#### EventGatewayUnbondingEnd

```python
@dataclass
class EventGatewayUnbondingEnd:
    gateway: Gateway
    session_end_height: int
    unbonding_end_height: int
    metadata: EventMetadata
```

#### EventGatewayUnbondingCanceled

```python
@dataclass
class EventGatewayUnbondingCanceled:
    gateway: Gateway
    session_end_height: int
    metadata: EventMetadata
```

### Proof Event Models

#### EventClaimCreated

```python
@dataclass
class EventClaimCreated:
    num_relays: int
    num_claimed_compute_units: int
    num_estimated_compute_units: int
    claimed_upokt: str
    service_id: str
    application_address: str
    session_end_block_height: int
    claim_proof_status_int: int
    supplier_operator_address: str
    metadata: EventMetadata
```

#### EventClaimUpdated

```python
@dataclass
class EventClaimUpdated:
    num_relays: int
    num_claimed_compute_units: int
    num_estimated_compute_units: int
    claimed_upokt: str
    service_id: str
    application_address: str
    session_end_block_height: int
    claim_proof_status_int: int
    supplier_operator_address: str
    metadata: EventMetadata
```

#### EventProofSubmitted

```python
@dataclass
class EventProofSubmitted:
    num_relays: int
    num_claimed_compute_units: int
    num_estimated_compute_units: int
    claimed_upokt: str
    service_id: str
    application_address: str
    session_end_block_height: int
    claim_proof_status_int: int
    supplier_operator_address: str
    metadata: EventMetadata
```

#### EventProofUpdated

```python
@dataclass
class EventProofUpdated:
    num_relays: int
    num_claimed_compute_units: int
    num_estimated_compute_units: int
    claimed_upokt: str
    service_id: str
    application_address: str
    session_end_block_height: int
    claim_proof_status_int: int
    supplier_operator_address: str
    metadata: EventMetadata
```

#### EventProofValidityChecked

```python
@dataclass
class EventProofValidityChecked:
    block_height: int
    failure_reason: Optional[str]  # None if valid
    service_id: str
    application_address: str
    session_end_block_height: int
    claim_proof_status_int: int
    supplier_operator_address: str
    metadata: EventMetadata
```

### Service Event Models

#### EventRelayMiningDifficultyUpdated

```python
@dataclass
class EventRelayMiningDifficultyUpdated:
    service_id: str
    prev_target_hash_hex_encoded: str
    new_target_hash_hex_encoded: str
    prev_num_relays_ema: int
    new_num_relays_ema: int
    metadata: EventMetadata
```

### Migration Event Models

#### EventImportMorseClaimableAccounts

```python
@dataclass
class EventImportMorseClaimableAccounts:
    created_at_height: int
    morse_account_state_hash: bytes
    num_accounts: int
    metadata: EventMetadata
```

#### EventMorseAccountClaimed

```python
@dataclass
class EventMorseAccountClaimed:
    session_end_height: int
    shannon_dest_address: str
    morse_src_address: str
    claimed_balance: str  # uPOKT amount
    metadata: EventMetadata
```

#### EventMorseApplicationClaimed

```python
@dataclass
class EventMorseApplicationClaimed:
    session_end_height: int
    morse_src_address: str
    application: Application  # Full application object
    claimed_balance: str
    claimed_application_stake: str
    metadata: EventMetadata
```

#### EventMorseSupplierClaimed

```python
@dataclass
class EventMorseSupplierClaimed:
    session_end_height: int
    claimed_balance: str
    morse_node_address: str
    morse_output_address: str
    claim_signer_type: int  # MorseSupplierClaimSignerType enum value
    claimed_supplier_stake: str
    supplier: Supplier  # Full supplier object
    metadata: EventMetadata
```

#### EventMorseAccountRecovered

```python
@dataclass
class EventMorseAccountRecovered:
    session_end_height: int
    recovered_balance: str  # uPOKT amount
    shannon_dest_address: str
    morse_src_address: str
    metadata: EventMetadata
```

---


## Event Collection & Extraction

### Block Data Structure

Events are found in two locations within block data:

1. **Transaction Events**: `block.txs_results[].events` - Events emitted during transaction execution, linked to transaction hash
2. **Block Events**: `block.finalize_block_events` - Events emitted during BeginBlock/EndBlock hooks, not linked to transactions

### Event Extraction

```python
def extract_events_from_block(block_data: dict) -> List[Event]:
    events = []
    
    # Extract transaction events
    for tx_result in block_data.get("txs_results", []):
        tx_hash = tx_result.get("tx_hash")
        for event in tx_result.get("events", []):
            parsed_event = parse_typed_event(event, tx_hash, "transaction")
            if parsed_event:
                events.append(parsed_event)
    
    # Extract block-level events
    for event in block_data.get("finalize_block_events", []):
        parsed_event = parse_typed_event(event, None, "block")
        if parsed_event:
            events.append(parsed_event)
    
    return events
```

### Typed Event Parsing

Events use protobuf encoding and must be parsed using Cosmos SDK's `ParseTypedEvent`:

```python
from cosmos_sdk.types import ParseTypedEvent

def parse_typed_event(event: dict, tx_hash: Optional[str], source: str) -> Optional[Event]:
    """Parse typed event and map to appropriate dataclass."""
    try:
        parsed = ParseTypedEvent(event)
        event_type = event.get("type")  # e.g., "pocket.tokenomics.EventClaimSettled"
        return map_to_event_dataclass(parsed, event_type, metadata)
    except Exception as e:
        logger.error(f"Failed to parse event: {e}")
        return None
```

---

## Historical Backfilling Requirements

### Backfilling Strategy

The indexer must backfill all events from genesis block to current block height. This ensures complete historical data parity.

#### 1. Block Range Processing

```python
def backfill_events(start_height: int, end_height: int):
    """
    Backfill events for a range of blocks.
    
    Strategy:
    - Process blocks in batches (e.g., 100 blocks at a time)
    - Track progress to allow resumability
    - Handle errors gracefully with retry logic
    """
    batch_size = 100
    current_height = start_height
    
    while current_height <= end_height:
        batch_end = min(current_height + batch_size - 1, end_height)
        process_block_range(current_height, batch_end)
        current_height = batch_end + 1
```

#### 2. Progress Tracking

```python
# Database table for tracking backfill progress
CREATE TABLE event_processing_status (
    id SERIAL PRIMARY KEY,
    start_height BIGINT NOT NULL,
    end_height BIGINT NOT NULL,
    current_height BIGINT NOT NULL,
    status VARCHAR(20) NOT NULL,  # 'pending', 'processing', 'completed', 'failed'
    events_processed BIGINT DEFAULT 0,
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    error_message TEXT,
    created_timestamp TIMESTAMP NOT NULL,
    updated_timestamp TIMESTAMP NOT NULL
);
```

#### 3. Batch Processing

- Process blocks in configurable batch sizes (default: 100 blocks)
- Commit database transactions per batch
- Log progress after each batch
- Allow configuration of batch size based on system resources

#### 4. Resumability

- Track last successfully processed block height
- Resume from last processed height on restart
- Skip already-processed blocks (idempotent processing)
- Validate data integrity after resuming

#### 5. Error Handling and Retry

- Retry failed blocks with exponential backoff
- Log errors for manual review
- Continue processing other blocks on failure
- Mark failed blocks for later retry

#### 6. Data Validation

After backfilling:
- Verify event counts match expected ranges
- Check for missing events in critical ranges
- Validate event data integrity
- Compare with on-chain state queries

---

## Real-Time Event Processing

### Event Stream Processing

Once backfilling is complete, the indexer must process new events in real-time as blocks are produced.

#### 1. Block-by-Block Processing

```python
def process_new_block(block_height: int):
    """Process events from a newly produced block."""
    block_data = fetch_block(block_height)
    events = extract_events_from_block(block_data)
    
    for event in events:
        process_event(event)
    
    update_latest_processed_height(block_height)
```

#### 2. Event Ordering

- Process events in block order (by height)
- Maintain event index within block for ordering
- Ensure transaction events are processed before block events
- Handle out-of-order blocks (if using multiple node sources)

#### 3. Duplicate Detection

- Check if event already exists before processing
- Use unique identifiers: (block_height, event_index, event_type, event_hash)
- Skip duplicates silently (idempotent processing)

#### 4. Real-Time State Updates

- Update entity states immediately upon event processing
- Update relationships synchronously
- Track economic impacts in real-time
- Maintain consistency with transaction processing

---


## Event Processing Logic

### Processing by Event Category

#### Tokenomics Events

**EventClaimSettled:**
- Update `claims` table: Set status to "settled"
- Create `claim_settlements` record with settlement details
- Create `reward_distributions` records for each recipient
- Update supplier stake (if rewards increase stake)
- Track economic impact: Record minted tokens

**EventClaimExpired:**
- Update `claims` table: Set status to "expired"
- Create `claim_settlements` record with expiration reason
- Track economic impact: No rewards distributed

**EventSupplierSlashed:**
- Create `supplier_slashes` record
- Update `suppliers` table: Decrease stake by slashed amount
- Track economic impact: Record burned tokens

**EventApplicationOverserviced:**
- Create `application_overservicing` record
- Update `applications` table: Decrease stake by effective_burn
- Track economic impact: Record partial burn

**EventClaimDiscarded:**
- Update `claims` table: Set status to "discarded"
- Create `claim_discards` record with error message
- Log for investigation

**EventApplicationReimbursementRequest:**
- Create `reimbursement_requests` record
- Track pending reimbursement

#### Application Events

**EventApplicationStaked:**
- Update `applications` table: Set is_active=true, update stake
- Create `entity_lifecycle_events` record
- Update relationships if new application

**EventRedelegation:**
- Update `applications` table: Update delegatee_gateway_addresses
- Update `delegations` table: Mark old delegations inactive, create new ones
- Create `entity_lifecycle_events` record

**EventTransferBegin/End/Error:**
- Create `entity_lifecycle_events` records
- Update `applications` table: Handle transfer state
- Track transfer lifecycle

**EventApplicationUnbondingBegin/End/Canceled:**
- Update `applications` table: Update unbonding status
- Create `entity_lifecycle_events` records
- Track unbonding lifecycle

#### Supplier Events

**EventSupplierStaked:**
- Update `suppliers` table: Set is_active=true, update stake
- Create `entity_lifecycle_events` record

**EventSupplierUnbondingBegin/End/Canceled:**
- Update `suppliers` table: Update unbonding status
- Create `entity_lifecycle_events` records

**EventSupplierServiceConfigActivated:**
- Update `supplier_service_configs` table: Mark config as active
- Create `service_config_events` record
- Update service availability

#### Gateway Events

**EventGatewayStaked:**
- Update `gateways` table: Set is_active=true, update stake
- Create `entity_lifecycle_events` record

**EventGatewayUnbondingBegin/End/Canceled:**
- Update `gateways` table: Update unbonding status
- Create `entity_lifecycle_events` records

#### Proof Events

**EventClaimCreated/Updated:**
- Create/update `claims` table record
- Create `proof_events` record
- Update claim status

**EventProofSubmitted/Updated:**
- Create/update `proofs` table record
- Create `proof_events` record
- Link proof to claim

**EventProofValidityChecked:**
- Update `proofs` table: Set validation status
- Create `proof_events` record
- Update claim status based on validation

#### Service Events

**EventRelayMiningDifficultyUpdated:**
- Update `services` table: Update mining difficulty
- Create `relay_mining_difficulty` record
- Track difficulty history

#### Migration Events

**EventImportMorseClaimableAccounts:**
- Create `migration_events` record
- Track import state

**EventMorseAccountClaimed/ApplicationClaimed/SupplierClaimed:**
- Create `migration_events` records
- Update entity records if applicable
- Track migration progress

**EventMorseAccountRecovered:**
- Create `migration_events` record
- Track recovery operations

---

## Database Schema

### Event-Specific Tables

#### Claim Settlements

```sql
CREATE TABLE claim_settlements (
    id SERIAL PRIMARY KEY,
    session_id VARCHAR(255) NOT NULL,
    supplier_operator_address VARCHAR(255) NOT NULL,
    application_address VARCHAR(255) NOT NULL,
    service_id VARCHAR(255) NOT NULL,
    session_end_block_height BIGINT NOT NULL,
    settlement_type VARCHAR(20) NOT NULL,  -- 'settled', 'expired', 'discarded'
    expiration_reason VARCHAR(50),
    proof_requirement_int INTEGER,
    num_relays BIGINT NOT NULL,
    num_claimed_compute_units BIGINT NOT NULL,
    num_estimated_compute_units BIGINT NOT NULL,
    claimed_upokt BIGINT NOT NULL,
    claim_proof_status_int INTEGER,
    error_message TEXT,
    block_height BIGINT NOT NULL,
    transaction_hash VARCHAR(255),
    created_timestamp TIMESTAMP NOT NULL,
    UNIQUE(session_id, supplier_operator_address)
);
```

#### Supplier Slashes

```sql
CREATE TABLE supplier_slashes (
    id SERIAL PRIMARY KEY,
    supplier_operator_address VARCHAR(255) NOT NULL,
    service_id VARCHAR(255) NOT NULL,
    application_address VARCHAR(255) NOT NULL,
    session_end_block_height BIGINT NOT NULL,
    proof_missing_penalty BIGINT NOT NULL,
    claim_proof_status_int INTEGER,
    block_height BIGINT NOT NULL,
    transaction_hash VARCHAR(255),
    created_timestamp TIMESTAMP NOT NULL
);
```

#### Application Overservicing

```sql
CREATE TABLE application_overservicing (
    id SERIAL PRIMARY KEY,
    application_addr VARCHAR(255) NOT NULL,
    supplier_operator_addr VARCHAR(255) NOT NULL,
    expected_burn BIGINT NOT NULL,
    effective_burn BIGINT NOT NULL,
    block_height BIGINT NOT NULL,
    transaction_hash VARCHAR(255),
    created_timestamp TIMESTAMP NOT NULL
);
```

#### Reward Distributions

```sql
CREATE TABLE reward_distributions (
    id SERIAL PRIMARY KEY,
    claim_settlement_id INTEGER REFERENCES claim_settlements(id),
    recipient_address VARCHAR(255) NOT NULL,
    amount BIGINT NOT NULL,  -- uPOKT amount
    block_height BIGINT NOT NULL,
    transaction_hash VARCHAR(255),
    created_timestamp TIMESTAMP NOT NULL
);
```

#### Entity Lifecycle Events

```sql
CREATE TABLE entity_lifecycle_events (
    id SERIAL PRIMARY KEY,
    entity_type VARCHAR(20) NOT NULL,  -- 'application', 'supplier', 'gateway'
    entity_address VARCHAR(255) NOT NULL,
    event_type VARCHAR(50) NOT NULL,  -- 'staked', 'unbonding_begin', etc.
    reason INTEGER,  -- Unbonding reason enum value
    session_end_height BIGINT,
    unbonding_end_height BIGINT,
    transfer_source_address VARCHAR(255),
    transfer_destination_address VARCHAR(255),
    transfer_end_height BIGINT,
    error_message TEXT,
    entity_data JSONB,  -- Full entity object at time of event
    block_height BIGINT NOT NULL,
    transaction_hash VARCHAR(255),
    created_timestamp TIMESTAMP NOT NULL
);
```

#### Proof Events

```sql
CREATE TABLE proof_events (
    id SERIAL PRIMARY KEY,
    session_id VARCHAR(255) NOT NULL,
    supplier_operator_address VARCHAR(255) NOT NULL,
    event_type VARCHAR(30) NOT NULL,  -- 'created', 'updated', 'submitted', 'validated'
    num_relays BIGINT,
    num_claimed_compute_units BIGINT,
    num_estimated_compute_units BIGINT,
    claimed_upokt BIGINT,
    service_id VARCHAR(255),
    application_address VARCHAR(255),
    session_end_block_height BIGINT,
    claim_proof_status_int INTEGER,
    failure_reason TEXT,
    block_height BIGINT NOT NULL,
    transaction_hash VARCHAR(255),
    created_timestamp TIMESTAMP NOT NULL
);
```

#### Service Config Events

```sql
CREATE TABLE service_config_events (
    id SERIAL PRIMARY KEY,
    supplier_operator_address VARCHAR(255) NOT NULL,
    service_id VARCHAR(255) NOT NULL,
    activation_height BIGINT NOT NULL,
    block_height BIGINT NOT NULL,
    transaction_hash VARCHAR(255),
    created_timestamp TIMESTAMP NOT NULL
);
```

#### Relay Mining Difficulty

```sql
CREATE TABLE relay_mining_difficulty (
    id SERIAL PRIMARY KEY,
    service_id VARCHAR(255) NOT NULL,
    prev_target_hash_hex_encoded VARCHAR(255),
    new_target_hash_hex_encoded VARCHAR(255) NOT NULL,
    prev_num_relays_ema BIGINT,
    new_num_relays_ema BIGINT NOT NULL,
    block_height BIGINT NOT NULL,
    transaction_hash VARCHAR(255),
    created_timestamp TIMESTAMP NOT NULL
);
```

#### Migration Events

```sql
CREATE TABLE migration_events (
    id SERIAL PRIMARY KEY,
    event_type VARCHAR(50) NOT NULL,
    morse_src_address VARCHAR(255),
    shannon_dest_address VARCHAR(255),
    morse_node_address VARCHAR(255),
    morse_output_address VARCHAR(255),
    claim_signer_type INTEGER,
    claimed_balance BIGINT,
    claimed_application_stake BIGINT,
    claimed_supplier_stake BIGINT,
    recovered_balance BIGINT,
    morse_account_state_hash BYTEA,
    num_accounts INTEGER,
    created_at_height BIGINT,
    session_end_height BIGINT,
    entity_data JSONB,  -- Application or Supplier object if applicable
    block_height BIGINT NOT NULL,
    transaction_hash VARCHAR(255),
    created_timestamp TIMESTAMP NOT NULL
);
```

#### Event Processing Status

```sql
CREATE TABLE event_processing_status (
    id SERIAL PRIMARY KEY,
    start_height BIGINT NOT NULL,
    end_height BIGINT NOT NULL,
    current_height BIGINT NOT NULL,
    status VARCHAR(20) NOT NULL,
    events_processed BIGINT DEFAULT 0,
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    error_message TEXT,
    created_timestamp TIMESTAMP NOT NULL,
    updated_timestamp TIMESTAMP NOT NULL
);
```

### Indexes

```sql
-- Claim settlements indexes
CREATE INDEX idx_claim_settlements_session ON claim_settlements(session_id);
CREATE INDEX idx_claim_settlements_supplier ON claim_settlements(supplier_operator_address);
CREATE INDEX idx_claim_settlements_application ON claim_settlements(application_address);
CREATE INDEX idx_claim_settlements_height ON claim_settlements(block_height);

-- Supplier slashes indexes
CREATE INDEX idx_supplier_slashes_supplier ON supplier_slashes(supplier_operator_address);
CREATE INDEX idx_supplier_slashes_height ON supplier_slashes(block_height);

-- Entity lifecycle indexes
CREATE INDEX idx_entity_lifecycle_type ON entity_lifecycle_events(entity_type, entity_address);
CREATE INDEX idx_entity_lifecycle_height ON entity_lifecycle_events(block_height);

-- Proof events indexes
CREATE INDEX idx_proof_events_session ON proof_events(session_id);
CREATE INDEX idx_proof_events_supplier ON proof_events(supplier_operator_address);
CREATE INDEX idx_proof_events_height ON proof_events(block_height);

-- Migration events indexes
CREATE INDEX idx_migration_events_type ON migration_events(event_type);
CREATE INDEX idx_migration_events_morse ON migration_events(morse_src_address);
```

---

## State Change Tracking

### Economic Impact Tracking

Events provide critical economic data:

**Burns:**
- Track from `EventSupplierSlashed` (supplier penalties)
- Track from `EventApplicationOverserviced` (application stake burns)
- Aggregate total burns by block, day, entity

**Mints:**
- Track from `EventClaimSettled` reward distributions
- Aggregate total mints by block, day, recipient

**Slashes:**
- Track from `EventSupplierSlashed`
- Update supplier stake immediately
- Track slashing history

### Entity Lifecycle Tracking

**Staking Events:**
- `EventApplicationStaked`, `EventSupplierStaked`, `EventGatewayStaked`
- Mark entities as active
- Record stake amounts
- Track staking history

**Unbonding Events:**
- `Event*UnbondingBegin`, `Event*UnbondingEnd`, `Event*UnbondingCanceled`
- Track unbonding periods
- Update entity status
- Handle unbonding completion

**Transfer Events:**
- `EventTransferBegin`, `EventTransferEnd`, `EventTransferError`
- Track application ownership transfers
- Handle transfer lifecycle

### Claim/Proof Status Updates

**Claim Lifecycle:**
- `EventClaimCreated` → Status: "pending"
- `EventClaimSettled` → Status: "settled"
- `EventClaimExpired` → Status: "expired"
- `EventClaimDiscarded` → Status: "discarded"

**Proof Lifecycle:**
- `EventProofSubmitted` → Link proof to claim
- `EventProofValidityChecked` → Update validation status
- Update claim status based on proof validation

### Stake Adjustments

**Supplier Stake:**
- Increase: Rewards from `EventClaimSettled`
- Decrease: Slashes from `EventSupplierSlashed`

**Application Stake:**
- Decrease: Burns from `EventApplicationOverserviced`
- Track stake changes from all events

### Reward Distribution Tracking

From `EventClaimSettled.reward_distribution`:
- Create records for each recipient
- Track reward amounts
- Link to claim settlement
- Aggregate by recipient, service, time period

### Service Configuration History

**Service Config Activation:**
- `EventSupplierServiceConfigActivated`
- Track when service configs become active
- Update supplier service availability

**Mining Difficulty Updates:**
- `EventRelayMiningDifficultyUpdated`
- Track difficulty changes over time
- Link to service performance

---


## Integration with Existing Indexer

### How Events Complement Transaction Messages

**Transaction Messages:**
- Represent user intent and actions
- Provide initial state changes
- May not capture all state transitions

**Events:**
- Represent actual outcomes and state changes
- Capture automatic protocol operations
- Provide complete state transition history

**Together:**
- Messages show "what user wanted to do"
- Events show "what actually happened"
- Both are needed for complete data parity

### Event Processing Pipeline

```
Block Data
    ↓
Event Extractor (transaction events + block events)
    ↓
Event Parser (typed event parsing)
    ↓
Event Router (by module/category)
    ↓
Event Handler (state updates)
    ↓
Database Storage
    ↓
State Manager (entity updates)
    ↓
Relationship Manager (relationship updates)
```

### Integration Points

**1. Transaction Parser Integration:**
- Process events after transaction messages
- Use events to validate transaction outcomes
- Update state based on both messages and events

**2. State Manager Integration:**
- Events trigger state updates
- Maintain consistency between message-based and event-based updates
- Handle conflicts (events take precedence for actual outcomes)

**3. Relationship Manager Integration:**
- Events update relationships (e.g., delegations from EventRedelegation)
- Track relationship lifecycle from events
- Maintain relationship history

### Data Consistency Requirements

**1. Event-Message Consistency:**
- Verify that transaction events match transaction messages
- Handle cases where events indicate different outcomes than messages
- Events are authoritative for actual state

**2. State Consistency:**
- Ensure entity states match event history
- Validate unbonding periods from events
- Check stake amounts against event history

**3. Relationship Consistency:**
- Verify relationships match event history
- Track relationship changes from events
- Maintain relationship state consistency

### Conflict Resolution

**Events vs Messages:**
- Events represent actual outcomes (authoritative)
- If event contradicts message, event takes precedence
- Log conflicts for investigation

**Example:**
- Message: `MsgStakeApplication` (user intent)
- Event: `EventApplicationStaked` (actual outcome)
- If event shows different stake amount, use event value

---

## Performance & Scalability

### Batch Processing Strategies

**1. Block Batching:**
- Process multiple blocks in single transaction
- Configurable batch size (default: 100 blocks)
- Commit after each batch

**2. Event Batching:**
- Group events by type for batch processing
- Process similar events together
- Optimize database operations

**3. Parallel Processing:**
- Process independent events in parallel
- Use worker pools for event processing
- Maintain event ordering within blocks

### Caching Requirements

**1. Entity Cache:**
- Cache frequently accessed entities (applications, suppliers, gateways)
- Invalidate on relevant events
- Reduce database queries

**2. Session Cache:**
- Cache session data for claim/proof events
- Invalidate on session completion
- Improve lookup performance

**3. Parameter Cache:**
- Cache network parameters
- Update on parameter change events
- Reduce parameter lookups

### Index Optimization

**Critical Indexes:**
- Block height indexes for time-range queries
- Entity address indexes for entity lookups
- Session ID indexes for claim/proof queries
- Transaction hash indexes for message-event linking

**Composite Indexes:**
- (entity_type, entity_address, block_height) for entity history
- (session_id, supplier_address) for claim lookups
- (block_height, event_type) for event filtering

### Query Performance

**Optimization Strategies:**
- Use indexes for common query patterns
- Batch queries when possible
- Use materialized views for aggregations
- Partition large tables by block height ranges

**Common Queries:**
- Entity event history: Use entity_type + entity_address index
- Economic activity: Use block_height index with date ranges
- Claim settlements: Use session_id index
- Reward distributions: Use recipient_address index

---

## Error Handling & Recovery

### Event Parsing Errors

**Handling:**
- Log parsing errors with full event data
- Skip unparseable events (don't halt processing)
- Store raw event data for later analysis
- Alert on high error rates

**Recovery:**
- Retry parsing with updated parsers
- Manual review of unparseable events
- Update parsing logic based on errors

### Missing Event Data

**Detection:**
- Compare event counts across blocks
- Validate expected events are present
- Check for gaps in event sequences

**Handling:**
- Log missing events
- Query on-chain state to fill gaps
- Re-process blocks if needed
- Alert on critical missing events

### Inconsistent State Recovery

**Detection:**
- Compare entity states with event history
- Validate stake amounts against events
- Check relationship consistency

**Recovery:**
- Re-process events for affected entities
- Query on-chain state for current values
- Rebuild state from event history
- Manual intervention for complex cases

### Backfilling Failure Recovery

**Resumability:**
- Track last successfully processed block
- Resume from last processed block
- Skip already-processed blocks
- Validate data integrity after resume

**Error Recovery:**
- Retry failed blocks with exponential backoff
- Mark permanently failed blocks for manual review
- Continue processing other blocks
- Alert on persistent failures

### Real-Time Processing Error Handling

**Block Processing Errors:**
- Log error and continue with next block
- Retry failed block after delay
- Alert on consecutive failures
- Fallback to alternative node if available

**Event Processing Errors:**
- Log error and continue with next event
- Store failed event for later retry
- Don't halt block processing for single event error
- Alert on high error rates

**State Update Errors:**
- Rollback transaction on error
- Log error with full context
- Retry with exponential backoff
- Alert on persistent state update failures

### Monitoring and Alerting

**Key Metrics:**
- Events processed per block
- Event parsing error rate
- State update error rate
- Backfilling progress
- Processing lag (blocks behind)

**Alerts:**
- High error rates (>1% parsing errors)
- Processing lag (>10 blocks behind)
- Missing critical events
- State inconsistency detected
- Backfilling failures

---

## Summary

This document provides comprehensive requirements for processing all 34 event types from all Pocket Network modules. Key requirements:

1. **Complete Event Coverage**: Process all events from all modules
2. **Historical Backfilling**: Backfill events from genesis to current
3. **Real-Time Processing**: Process new events as blocks are produced
4. **Data Parity**: Maintain consistency between events and messages
5. **Performance**: Optimize for high-volume event processing
6. **Reliability**: Handle errors gracefully and recover automatically

The indexer must process both transaction events and block-level events to maintain complete data parity and provide accurate network state tracking.

