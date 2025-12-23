# Pocket Network Indexer Requirements & Architecture Guide

> **Status:** Design/requirements document. This file captures a superset of the functionality the indexer should support; not all sections are implemented exactly as written. Treat this as guidance and future roadmap rather than a strict description of the current codebase.

## **Document Purpose**
This document provides comprehensive requirements and architectural guidance for building an indexer for Pocket Network. It covers all aspects of data collection, relationship tracking, transaction parsing, and change monitoring required to maintain an accurate and up-to-date index of the network state.

## **Table of Contents**
1. [System Overview](#system-overview)
2. [Core Actors & Relationships](#core-actors--relationships)
3. [Data Collection Requirements](#data-collection-requirements)
4. [Transaction Parsing Logic](#transaction-parsing-logic)
5. [State Change Tracking](#state-change-tracking)
6. [Relationship Mapping](#relationship-mapping)
7. [Indexer Architecture](#indexer-architecture)
8. [Data Models](#data-models)
9. [API Integration](#api-integration)
10. [Performance Requirements](#performance-requirements)
11. [Error Handling & Resilience](#error-handling--resilience)
12. [Monitoring & Alerting](#monitoring--alerting)

---

## **System Overview**

### **What is Pocket Network?**
Pocket Network is a decentralized RPC infrastructure that connects **Applications** (end users) with **Suppliers** (service providers) through **Gateways** (routing nodes) and **RelayMiners** (off-chain processors).

### **Indexer Purpose**
The indexer must maintain a real-time, accurate representation of:
- All network participants and their states
- Relationships between actors
- Transaction history and state changes
- Session assignments and lifecycle
- Proof submissions and settlements
- Economic parameters and token flows

---

## **Core Actors & Relationships**

### **1. Applications**
- **Role**: End users who stake POKT tokens to access RPC services
- **Key Properties**: Stake amount, service configurations, gateway delegations
- **Relationships**: 
  - Delegates to Gateways
  - Consumes services from Suppliers
  - Participates in Sessions

### **2. Suppliers**
- **Role**: Service providers who run RPC endpoints and stake POKT tokens
- **Key Properties**: Stake amount, service endpoints, revenue sharing
- **Relationships**:
  - Provides services to Applications
  - Assigned to Sessions
  - Submits Claims and Proofs

### **3. Gateways**
- **Role**: Routing nodes that applications delegate to for service discovery
- **Key Properties**: Stake amount, delegation relationships
- **Relationships**:
  - Receives delegations from Applications
  - Routes requests to Suppliers
  - Manages application access

### **4. Services**
- **Role**: Define the types of RPC services available on the network
- **Key Properties**: Service ID, compute unit costs, owner address
- **Relationships**:
  - Owned by specific addresses
  - Used by Applications and Suppliers
  - Has associated mining difficulty

### **5. Sessions**
- **Role**: Temporary assignments of suppliers to applications for specific services
- **Key Properties**: Duration, supplier assignment, application-service pair
- **Relationships**:
  - Links Applications to Suppliers
  - Has specific start/end heights
  - Generates Claims and Proofs

---

## **Data Collection Requirements**

### **Primary Data Sources**

#### **1. Blockchain State Queries**
```bash
# Applications
GET /pokt-network/poktroll/application/application?pagination.limit=100
GET /pokt-network/poktroll/application/application/{address}

# Suppliers
GET /pokt-network/poktroll/supplier/supplier?pagination.limit=100
GET /pokt-network/poktroll/supplier/supplier/{operator_address}

# Gateways
GET /pokt-network/poktroll/gateway/gateway?pagination.limit=100
GET /pokt-network/poktroll/gateway/gateway/{address}

# Services
GET /pokt-network/poktroll/service/service?pagination.limit=100
GET /pokt-network/poktroll/service/service/{id}

# Sessions
GET /pokt-network/poktroll/session/get_session?application_address={addr}&service_id={id}&block_height={height}

# Proofs and Claims
GET /pokt-network/poktroll/proof/claim?pagination.limit=100
GET /pokt-network/poktroll/proof/proof?pagination.limit=100
```

#### **2. Network Parameters**
```bash
# Critical parameters for calculations
GET /pokt-network/poktroll/shared/params
GET /pokt-network/poktroll/tokenomics/params
GET /pokt-network/poktroll/session/params
```

#### **3. Block and Transaction Data**
```bash
# Block information
GET /cosmos/base/tendermint/v1beta1/blocks/latest
GET /cosmos/base/tendermint/v1beta1/blocks/{height}

# Transaction details (when available)
GET /cosmos/tx/v1beta1/txs/{tx_hash}
```

### **Data Collection Strategy**

#### **Initial Sync**
1. **Bootstrap**: Collect all existing state data
2. **Historical**: Process all historical blocks and transactions
3. **Validation**: Cross-reference data for consistency

#### **Real-time Updates**
1. **Block Monitoring**: Watch for new blocks
2. **State Changes**: Detect modifications to tracked entities
3. **Relationship Updates**: Update connection mappings

---

## **Transaction Parsing Logic**

### **Message Types to Track**

#### **Application Messages**
```protobuf
// Stake application
MsgStakeApplication {
  string address
  cosmos.base.v1beta1.Coin stake
  repeated ApplicationServiceConfig service_configs
}

// Delegate to gateway
MsgDelegateToGateway {
  string application_address
  string gateway_address
}

// Unstake application
MsgUnstakeApplication {
  string address
}
```

#### **Supplier Messages**
```protobuf
// Stake supplier
MsgStakeSupplier {
  string operator_address
  cosmos.base.v1beta1.Coin stake
  repeated SupplierServiceConfig services
}

// Unstake supplier
MsgUnstakeSupplier {
  string operator_address
}
```

#### **Gateway Messages**
```protobuf
// Stake gateway
MsgStakeGateway {
  string address
  cosmos.base.v1beta1.Coin stake
}

// Unstake gateway
MsgUnstakeGateway {
  string address
}
```

#### **Proof Messages**
```protobuf
// Create claim
MsgCreateClaim {
  string supplier_operator_address
  SessionHeader session_header
  bytes root_hash
}

// Submit proof
MsgSubmitProof {
  string supplier_operator_address
  SessionHeader session_header
  bytes closest_merkle_proof
}
```

### **Transaction Processing Logic**

#### **1. Message Extraction**
```python
def extract_messages(tx):
    """Extract all messages from a transaction"""
    messages = []
    for msg in tx.body.messages:
        if msg.type_url == "pocket.application.MsgStakeApplication":
            messages.append(parse_stake_application(msg))
        elif msg.type_url == "pocket.application.MsgDelegateToGateway":
            messages.append(parse_delegate_gateway(msg))
        # ... handle other message types
    return messages
```

#### **2. State Change Detection**
```python
def detect_state_changes(messages, current_state):
    """Detect what state changes occurred"""
    changes = []
    for msg in messages:
        if isinstance(msg, StakeApplicationMessage):
            changes.append(StateChange(
                entity_type="application",
                entity_id=msg.address,
                change_type="stake",
                old_value=None,
                new_value=msg.stake
            ))
    return changes
```

#### **3. Relationship Updates**
```python
def update_relationships(changes, relationships):
    """Update relationship mappings based on changes"""
    for change in changes:
        if change.change_type == "delegate":
            relationships.add_delegation(
                application=change.application_address,
                gateway=change.gateway_address
            )
        elif change.change_type == "undelegate":
            relationships.remove_delegation(
                application=change.application_address,
                gateway=change.gateway_address
            )
```

---

## **State Change Tracking**

### **Change Types to Monitor**

#### **1. Stake Changes**
- **Application Staking**: New applications joining the network
- **Application Unstaking**: Applications leaving the network
- **Supplier Staking**: New suppliers joining
- **Supplier Unstaking**: Suppliers leaving
- **Gateway Staking**: New gateways joining
- **Gateway Unstaking**: Gateways leaving

#### **2. Delegation Changes**
- **Application → Gateway**: New delegations
- **Application → Gateway**: Removed delegations
- **Delegation Updates**: Changes in delegation amounts

#### **3. Service Configuration Changes**
- **New Services**: Services added to the network
- **Service Updates**: Changes in compute units or pricing
- **Supplier Service Changes**: Suppliers adding/removing services
- **Application Service Changes**: Applications changing service configs

#### **4. Session Lifecycle**
- **Session Creation**: New sessions starting
- **Session Assignment**: Suppliers assigned to sessions
- **Session Completion**: Sessions ending
- **Claim Submission**: Claims for completed sessions
- **Proof Submission**: Proofs for claims

#### **5. Economic Changes**
- **Token Transfers**: POKT movements between accounts
- **Reward Distributions**: Token rewards to participants
- **Slashing Events**: Penalties applied to participants
- **Parameter Updates**: Network parameter changes

### **Change Detection Methods**

#### **1. Block-by-Block Monitoring**
```python
def monitor_blocks(start_height, end_height):
    """Monitor blocks for changes"""
    for height in range(start_height, end_height + 1):
        block = get_block(height)
        changes = process_block(block)
        apply_changes(changes)
        update_index(height)
```

#### **2. State Comparison**
```python
def compare_states(old_state, new_state):
    """Compare two states to detect changes"""
    changes = []
    
    # Compare applications
    for app_id in set(old_state.applications.keys()) | set(new_state.applications.keys()):
        old_app = old_state.applications.get(app_id)
        new_app = new_state.applications.get(app_id)
        
        if old_app != new_app:
            changes.append(StateChange(
                entity_type="application",
                entity_id=app_id,
                change_type="update",
                old_value=old_app,
                new_value=new_app
            ))
    
    return changes
```

#### **3. Event Monitoring**
```python
def monitor_events(block):
    """Extract events from block for change detection"""
    events = []
    for tx in block.transactions:
        for event in tx.events:
            if event.type == "delegate":
                events.append(parse_delegate_event(event))
            elif event.type == "stake":
                events.append(parse_stake_event(event))
    return events
```

---

## **Relationship Mapping**

### **Core Relationships to Track**

#### **1. Application Relationships**
```python
class ApplicationRelationships:
    def __init__(self):
        self.gateway_delegations = {}  # app_addr -> [gateway_addrs]
        self.service_configs = {}      # app_addr -> [service_configs]
        self.active_sessions = {}      # app_addr -> [session_ids]
        self.stake_history = {}        # app_addr -> [stake_changes]
```

#### **2. Supplier Relationships**
```python
class SupplierRelationships:
    def __init__(self):
        self.services = {}             # supplier_addr -> [service_configs]
        self.sessions = {}             # supplier_addr -> [session_ids]
        self.claims = {}               # supplier_addr -> [claim_ids]
        self.proofs = {}               # supplier_addr -> [proof_ids]
        self.revenue_sharing = {}      # supplier_addr -> [share_configs]
```

#### **3. Gateway Relationships**
```python
class GatewayRelationships:
    def __init__(self):
        self.application_delegations = {}  # gateway_addr -> [app_addrs]
        self.total_delegated_stake = {}    # gateway_addr -> total_stake
        self.delegation_history = {}       # gateway_addr -> [delegation_changes]
```

#### **4. Service Relationships**
```python
class ServiceRelationships:
    def __init__(self):
        self.owner = {}                # service_id -> owner_addr
        self.applications = {}         # service_id -> [app_addrs]
        self.suppliers = {}            # service_id -> [supplier_addrs]
        self.sessions = {}             # service_id -> [session_ids]
        self.mining_difficulty = {}    # service_id -> difficulty
```

#### **5. Session Relationships**
```python
class SessionRelationships:
    def __init__(self):
        self.application = {}          # session_id -> app_addr
        self.service = {}              # session_id -> service_id
        self.suppliers = {}            # session_id -> [supplier_addrs]
        self.claims = {}               # session_id -> [claim_ids]
        self.proofs = {}               # session_id -> [proof_ids]
        self.block_range = {}          # session_id -> (start_height, end_height)
```

### **Relationship Update Logic**

#### **1. Delegation Updates**
```python
def update_delegation(app_addr, gateway_addr, action):
    """Update delegation relationships"""
    if action == "add":
        if app_addr not in app_relationships.gateway_delegations:
            app_relationships.gateway_delegations[app_addr] = []
        app_relationships.gateway_delegations[app_addr].append(gateway_addr)
        
        if gateway_addr not in gateway_relationships.application_delegations:
            gateway_relationships.application_delegations[gateway_addr] = []
        gateway_relationships.application_delegations[gateway_addr].append(app_addr)
    
    elif action == "remove":
        if app_addr in app_relationships.gateway_delegations:
            app_relationships.gateway_delegations[app_addr].remove(gateway_addr)
        
        if gateway_addr in gateway_relationships.application_delegations:
            gateway_relationships.application_delegations[gateway_addr].remove(app_addr)
```

#### **2. Session Updates**
```python
def update_session_relationships(session_id, session_data):
    """Update all relationships for a session"""
    app_addr = session_data.application_address
    service_id = session_data.service_id
    supplier_addrs = [s.operator_address for s in session_data.suppliers]
    
    # Update application relationships
    if app_addr not in app_relationships.active_sessions:
        app_relationships.active_sessions[app_addr] = []
    app_relationships.active_sessions[app_addr].append(session_id)
    
    # Update service relationships
    if service_id not in service_relationships.sessions:
        service_relationships.sessions[service_id] = []
    service_relationships.sessions[service_id].append(session_id)
    
    # Update supplier relationships
    for supplier_addr in supplier_addrs:
        if supplier_addr not in supplier_relationships.sessions:
            supplier_relationships.sessions[supplier_addr] = []
        supplier_relationships.sessions[supplier_addr].append(session_id)
```

---

## **Indexer Architecture**

### **System Components**

#### **1. Data Collection Layer**
```python
class DataCollector:
    def __init__(self, node_urls):
        self.nodes = node_urls
        self.current_height = 0
    
    def collect_block_data(self, height):
        """Collect all data for a specific block height"""
        pass
    
    def collect_state_data(self):
        """Collect current state from all modules"""
        pass
    
    def collect_historical_data(self, start_height, end_height):
        """Collect historical data for initial sync"""
        pass
```

#### **2. Transaction Parser**
```python
class TransactionParser:
    def __init__(self):
        self.message_handlers = {
            "pocket.application.MsgStakeApplication": self.handle_stake_application,
            "pocket.application.MsgDelegateToGateway": self.handle_delegate_gateway,
            "pocket.supplier.MsgStakeSupplier": self.handle_stake_supplier,
            # ... other handlers
        }
    
    def parse_transaction(self, tx):
        """Parse a transaction and extract all relevant information"""
        pass
    
    def handle_stake_application(self, msg):
        """Handle application staking message"""
        pass
```

#### **3. State Manager**
```python
class StateManager:
    def __init__(self):
        self.applications = {}
        self.suppliers = {}
        self.gateways = {}
        self.services = {}
        self.sessions = {}
        self.claims = {}
        self.proofs = {}
    
    def apply_changes(self, changes):
        """Apply state changes to current state"""
        pass
    
    def get_entity(self, entity_type, entity_id):
        """Get entity by type and ID"""
        pass
    
    def update_entity(self, entity_type, entity_id, new_data):
        """Update entity data"""
        pass
```

#### **4. Relationship Manager**
```python
class RelationshipManager:
    def __init__(self):
        self.app_relationships = ApplicationRelationships()
        self.supplier_relationships = SupplierRelationships()
        self.gateway_relationships = GatewayRelationships()
        self.service_relationships = ServiceRelationships()
        self.session_relationships = SessionRelationships()
    
    def update_relationships(self, changes):
        """Update all relationship mappings based on changes"""
        pass
    
    def get_related_entities(self, entity_type, entity_id, relationship_type):
        """Get entities related to a specific entity"""
        pass
```

#### **5. Data Storage Layer**
```python
class DataStorage:
    def __init__(self, db_connection):
        self.db = db_connection
    
    def store_entity(self, entity_type, entity_id, data):
        """Store entity data"""
        pass
    
    def store_relationship(self, relationship_type, from_id, to_id, data):
        """Store relationship data"""
        pass
    
    def store_transaction(self, tx_hash, block_height, data):
        """Store transaction data"""
        pass
    
    def query_entities(self, entity_type, filters):
        """Query entities with filters"""
        pass
```

### **Data Flow**

```
Block Event → Data Collector → Transaction Parser → State Manager → Relationship Manager → Data Storage
     ↓              ↓              ↓              ↓              ↓              ↓
Block Height → State Changes → Entity Updates → Relationship Updates → Index Updates → Query Interface
```

---

## **Data Models**

### **Core Entity Models**

#### **1. Application Model**
```python
@dataclass
class Application:
    address: str
    stake: Coin
    service_configs: List[ApplicationServiceConfig]
    delegatee_gateway_addresses: List[str]
    pending_undelegations: Dict[int, List[str]]
    unstake_session_end_height: int
    pending_transfer: Optional[PendingTransfer]
    
    # Computed fields
    @property
    def is_active(self) -> bool:
        return self.unstake_session_end_height == 0 and self.pending_transfer is None
    
    @property
    def total_delegated_stake(self) -> int:
        return sum(self.pending_undelegations.values())

@dataclass
class ApplicationServiceConfig:
    service_id: str
    # Additional configuration options can be added here

@dataclass
class PendingTransfer:
    destination_address: str
    session_end_height: int

@dataclass
class UndelegatingGatewayList:
    gateway_addresses: List[str]
```

#### **2. Supplier Model**
```python
@dataclass
class Supplier:
    owner_address: str
    operator_address: str
    stake: Coin
    services: List[SupplierServiceConfig]
    unstake_session_end_height: int
    service_config_history: List[ServiceConfigUpdate]
    
    # Computed fields
    @property
    def is_active(self) -> bool:
        return self.unstake_session_end_height == 0
    
    @property
    def active_services(self) -> List[str]:
        return [s.service_id for s in self.services]

@dataclass
class SupplierServiceConfig:
    service_id: str
    endpoints: List[SupplierEndpoint]
    rev_share: List[ServiceRevenueShare]

@dataclass
class SupplierEndpoint:
    url: str
    rpc_type: RPCType
    configs: List[ConfigOption]

@dataclass
class ServiceRevenueShare:
    address: str
    rev_share_percentage: int

@dataclass
class ServiceConfigUpdate:
    operator_address: str
    service: SupplierServiceConfig
    activation_height: int
    deactivation_height: int

@dataclass
class ConfigOption:
    key: ConfigOptions
    value: str

class RPCType(Enum):
    UNKNOWN_RPC = 0
    GRPC = 1
    WEBSOCKET = 2
    JSON_RPC = 3
    REST = 4
    COMET_BFT = 5

class ConfigOptions(Enum):
    UNKNOWN_CONFIG = 0
    TIMEOUT = 1
```

#### **3. Gateway Model**
```python
@dataclass
class Gateway:
    address: str
    stake: Coin
    unstake_session_end_height: int
    
    # Computed fields
    @property
    def is_active(self) -> bool:
        return self.unstake_session_end_height == 0
```

#### **4. Service Model**
```python
@dataclass
class Service:
    id: str
    name: str
    compute_units_per_relay: int
    owner_address: str
    
    # Computed fields
    @property
    def cost_per_relay(self) -> float:
        # Calculate based on network parameters
        pass
```

#### **5. Session Model**
```python
@dataclass
class Session:
    header: SessionHeader
    session_id: str
    session_number: int
    num_blocks_per_session: int
    application: Application
    suppliers: List[Supplier]
    
    # Computed fields
    @property
    def is_active(self) -> bool:
        current_height = get_current_height()
        return (self.header.session_start_block_height <= current_height <= 
                self.header.session_end_block_height)
    
    @property
    def remaining_blocks(self) -> int:
        current_height = get_current_height()
        return max(0, self.header.session_end_block_height - current_height)

@dataclass
class SessionHeader:
    application_address: str
    service_id: str
    session_id: str
    session_start_block_height: int
    session_end_block_height: int
```

#### **6. Proof and Claim Models**
```python
@dataclass
class Claim:
    supplier_operator_address: str
    session_header: SessionHeader
    root_hash: bytes
    proof_validation_status: ClaimProofStatus

@dataclass
class Proof:
    supplier_operator_address: str
    session_header: SessionHeader
    closest_merkle_proof: bytes

class ClaimProofStatus(Enum):
    PENDING_VALIDATION = 0
    VALIDATED = 1
    INVALID = 2

class ClaimProofStage(Enum):
    CLAIMED = 0
    PROVEN = 1
    SETTLED = 2
    EXPIRED = 3
```

#### **7. Relay Models**
```python
@dataclass
class Relay:
    req: RelayRequest
    res: RelayResponse

@dataclass
class RelayRequest:
    meta: RelayRequestMetadata
    payload: bytes

@dataclass
class RelayRequestMetadata:
    session_header: SessionHeader
    signature: bytes
    supplier_operator_address: str

@dataclass
class RelayResponse:
    meta: RelayResponseMetadata
    payload: bytes
    payload_hash: bytes
    relay_miner_error: Optional[RelayMinerError]

@dataclass
class RelayResponseMetadata:
    session_header: SessionHeader
    supplier_operator_signature: bytes

@dataclass
class RelayMinerError:
    codespace: str
    code: int
    description: str
    message: str
```

#### **8. Relay Mining Difficulty Model**
```python
@dataclass
class RelayMiningDifficulty:
    service_id: str
    difficulty: int
    # Additional fields for difficulty calculation
```

#### **9. Network Parameter Models**
```python
@dataclass
class SharedParams:
    num_blocks_per_session: int
    grace_period_end_offset_blocks: int
    claim_window_open_offset_blocks: int
    claim_window_close_offset_blocks: int
    proof_window_open_offset_blocks: int
    proof_window_close_offset_blocks: int
    supplier_unbonding_period_sessions: int
    application_unbonding_period_sessions: int
    compute_units_to_tokens_multiplier: int
    gateway_unbonding_period_sessions: int
    compute_unit_cost_granularity: int

@dataclass
class TokenomicsParams:
    # Tokenomics-specific parameters
    pass

@dataclass
class SessionParams:
    # Session-specific parameters
    pass
```

#### **10. Migration Models**
```python
@dataclass
class MorseClaimableAccount:
    address: str
    balance: Coin
    # Additional Morse-specific fields

@dataclass
class MigrationParams:
    waive_morse_claim_gas_fees: bool
    # Additional migration parameters
```

### **Relationship Models**

#### **1. Delegation Model**
```python
@dataclass
class Delegation:
    application_address: str
    gateway_address: str
    stake_amount: int
    created_at: datetime
    updated_at: datetime
    
    # Computed fields
    @property
    def is_active(self) -> bool:
        return self.stake_amount > 0

@dataclass
class DelegationHistory:
    application_address: str
    gateway_address: str
    action: str  # "delegate" or "undelegate"
    stake_amount: int
    session_end_height: int
    timestamp: datetime
    transaction_hash: str
```

#### **2. Service Assignment Model**
```python
@dataclass
class ServiceAssignment:
    supplier_address: str
    service_id: str
    endpoints: List[SupplierEndpoint]
    revenue_sharing: List[ServiceRevenueShare]
    created_at: datetime
    updated_at: datetime
    activation_height: int
    deactivation_height: Optional[int]

@dataclass
class ServiceUsage:
    service_id: str
    application_address: str
    supplier_address: str
    session_id: str
    relay_count: int
    total_compute_units: int
    total_cost: int
```

#### **3. Session Assignment Model**
```python
@dataclass
class SessionAssignment:
    session_id: str
    supplier_address: str
    service_id: str
    application_address: str
    assigned_at: datetime
    status: SessionStatus  # ACTIVE, COMPLETED, CLAIMED, PROVEN
    relay_count: int
    total_compute_units: int

class SessionStatus(Enum):
    ACTIVE = "active"
    COMPLETED = "completed"
    CLAIMED = "claimed"
    PROVEN = "proven"
    EXPIRED = "expired"
```

#### **4. Stake History Model**
```python
@dataclass
class StakeHistory:
    address: str
    entity_type: str  # "application", "supplier", "gateway"
    action: str  # "stake" or "unstake"
    amount: int
    session_end_height: Optional[int]
    timestamp: datetime
    transaction_hash: str
    block_height: int
```

#### **5. Economic Activity Model**
```python
@dataclass
class TokenTransfer:
    from_address: str
    to_address: str
    amount: int
    denom: str
    transaction_hash: str
    block_height: int
    timestamp: datetime
    transfer_type: str  # "stake", "reward", "fee", "transfer"

@dataclass
class RewardDistribution:
    recipient_address: str
    amount: int
    reward_type: str  # "relay", "proposal", "validator"
    session_id: Optional[str]
    transaction_hash: str
    block_height: int
    timestamp: datetime
```

### **Block and Transaction Data Models**

#### **1. Block Models**
```python
@dataclass
class Block:
    height: int
    hash: str
    timestamp: datetime
    proposer_address: str
    num_transactions: int
    gas_used: int
    gas_wanted: int
    app_hash: str
    consensus_hash: str
    data_hash: str
    evidence_hash: str
    last_block_id: Optional[BlockID]
    last_commit_hash: str
    last_results_hash: str
    next_validators_hash: str
    validators_hash: str
    
    # Computed fields
    @property
    def block_time(self) -> datetime:
        return self.timestamp
    
    @property
    def is_genesis(self) -> bool:
        return self.height == 1

@dataclass
class BlockID:
    hash: str
    parts: BlockPartSetHeader

@dataclass
class BlockPartSetHeader:
    total: int
    hash: str

@dataclass
class BlockHeader:
    version: Version
    chain_id: str
    height: int
    time: datetime
    last_block_id: Optional[BlockID]
    last_commit_hash: str
    data_hash: str
    validators_hash: str
    next_validators_hash: str
    consensus_hash: str
    app_hash: str
    last_results_hash: str
    evidence_hash: str
    proposer_address: str

@dataclass
class Version:
    block: str
    app: str

@dataclass
class BlockEvidence:
    evidence: List[Evidence]

@dataclass
class Evidence:
    type: str
    validator: Validator
    height: int
    time: datetime
    total_voting_power: int
```

#### **2. Transaction Models**
```python
@dataclass
class Transaction:
    hash: str
    height: int
    timestamp: datetime
    messages: List[Message]
    fee: Coin
    gas_used: int
    gas_wanted: int
    memo: str
    signatures: List[bytes]
    tx_result: Optional[TransactionResult]
    
    # Computed fields
    @property
    def message_types(self) -> List[str]:
        return [msg.type_url for msg in self.messages]
    
    @property
    def signers(self) -> List[str]:
        return [msg.signer for msg in self.messages if hasattr(msg, 'signer')]
    
    @property
    def is_successful(self) -> bool:
        return self.tx_result is not None and self.tx_result.success
    
    @property
    def pocket_messages(self) -> List[Message]:
        return [msg for msg in self.messages if msg.is_pocket_message]

@dataclass
class Coin:
    denom: str
    amount: str  # String representation for precision
    
    # Computed fields
    @property
    def amount_int(self) -> int:
        return int(self.amount)
    
    @property
    def is_upokt(self) -> bool:
        return self.denom == "upokt"

@dataclass
class TransactionResult:
    transaction: Transaction
    success: bool
    error_message: Optional[str]
    gas_used: int
    gas_wanted: int
    events: List[Event]
    logs: List[str]
    info: str
    data: bytes
    codespace: str
    code: int
    
    # Computed fields
    @property
    def is_error(self) -> bool:
        return not self.success
    
    @property
    def error_code(self) -> int:
        return self.code if self.is_error else 0

@dataclass
class TransactionFee:
    amount: List[Coin]
    gas_limit: int
    payer: str
    granter: str

@dataclass
class TransactionSignature:
    pub_key: bytes
    signature: bytes
    sequence: int
    account_number: int
```

#### **3. Message Models**
```python
@dataclass
class Message:
    type_url: str
    data: Dict[str, Any]
    signers: List[str]
    message_index: int
    
    # Computed fields
    @property
    def module(self) -> str:
        return self.type_url.split('.')[1]
    
    @property
    def action(self) -> str:
        return self.type_url.split('.')[-1]
    
    @property
    def is_pocket_message(self) -> bool:
        return self.type_url.startswith('pocket.')
    
    @property
    def is_cosmos_message(self) -> bool:
        return self.type_url.startswith('cosmos.')
    
    @property
    def is_ibc_message(self) -> bool:
        return self.type_url.startswith('ibc.')

@dataclass
class Event:
    type: str
    attributes: List[EventAttribute]
    
    # Computed fields
    @property
    def attribute_dict(self) -> Dict[str, str]:
        return {attr.key: attr.value for attr in self.attributes if attr.index}

@dataclass
class EventAttribute:
    key: str
    value: str
    index: bool
    
    # Computed fields
    @property
    def is_indexed(self) -> bool:
        return self.index
```

#### **4. Block Transaction Data**
```python
@dataclass
class BlockTransactionData:
    block_height: int
    block_hash: str
    block_timestamp: datetime
    transactions: List[TransactionData]
    total_gas_used: int
    total_gas_wanted: int
    total_fees: List[Coin]
    
    # Computed fields
    @property
    def transaction_count(self) -> int:
        return len(self.transactions)
    
    @property
    def successful_transactions(self) -> int:
        return sum(1 for tx in self.transactions if tx.success)
    
    @property
    def failed_transactions(self) -> int:
        return sum(1 for tx in self.transactions if not tx.success)

@dataclass
class TransactionData:
    hash: str
    height: int
    timestamp: datetime
    success: bool
    gas_used: int
    gas_wanted: int
    fee_amount: int
    fee_denom: str
    message_count: int
    memo: str
    error_message: Optional[str]
    events: List[Event]
    
    # Computed fields
    @property
    def gas_efficiency(self) -> float:
        if self.gas_wanted == 0:
            return 0.0
        return self.gas_used / self.gas_wanted
    
    @property
    def fee_value(self) -> Coin:
        return Coin(denom=self.fee_denom, amount=str(self.fee_amount))
```

#### **5. Block Processing Models**
```python
@dataclass
class BlockProcessingStatus:
    height: int
    hash: str
    status: BlockStatus
    processing_started: datetime
    processing_completed: Optional[datetime]
    error_message: Optional[str]
    transaction_count: int
    processed_transactions: int
    failed_transactions: int
    
    # Computed fields
    @property
    def is_completed(self) -> bool:
        return self.status == BlockStatus.COMPLETED
    
    @property
    def is_failed(self) -> bool:
        return self.status == BlockStatus.FAILED
    
    @property
    def processing_duration(self) -> Optional[timedelta]:
        if self.processing_completed:
            return self.processing_completed - self.processing_started
        return None

class BlockStatus(Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    SKIPPED = "skipped"

@dataclass
class BlockProcessingMetrics:
    total_blocks: int
    processed_blocks: int
    failed_blocks: int
    skipped_blocks: int
    total_transactions: int
    successful_transactions: int
    failed_transactions: int
    total_gas_used: int
    total_fees: Dict[str, int]
    average_processing_time: float
    
    # Computed fields
    @property
    def success_rate(self) -> float:
        if self.total_blocks == 0:
            return 0.0
        return self.processed_blocks / self.total_blocks
    
    @property
    def transaction_success_rate(self) -> float:
        if self.total_transactions == 0:
            return 0.0
        return self.successful_transactions / self.total_transactions
```

#### **6. Transaction Parsing Models**
```python
@dataclass
class ParsedTransaction:
    transaction: Transaction
    parsed_messages: List[ParsedMessage]
    state_changes: List[StateChange]
    relationship_changes: List[RelationshipChange]
    economic_impact: EconomicImpact
    
    # Computed fields
    @property
    def has_pocket_messages(self) -> bool:
        return any(msg.is_pocket_message for msg in self.parsed_messages)
    
    @property
    def pocket_message_count(self) -> int:
        return sum(1 for msg in self.parsed_messages if msg.is_pocket_message)

@dataclass
class ParsedMessage:
    message: Message
    parsed_data: Dict[str, Any]
    validation_errors: List[str]
    is_valid: bool
    
    # Computed fields
    @property
    def has_errors(self) -> bool:
        return len(self.validation_errors) > 0

@dataclass
class StateChange:
    entity_type: str  # "application", "supplier", "gateway", "service"
    entity_id: str
    change_type: str  # "create", "update", "delete"
    field_name: str
    old_value: Any
    new_value: Any
    block_height: int
    transaction_hash: str
    
    # Computed fields
    @property
    def is_creation(self) -> bool:
        return self.change_type == "create"
    
    @property
    def is_deletion(self) -> bool:
        return self.change_type == "delete"
    
    @property
    def is_update(self) -> bool:
        return self.change_type == "update"

@dataclass
class RelationshipChange:
    from_entity_type: str
    from_entity_id: str
    to_entity_type: str
    to_entity_id: str
    relationship_type: str  # "delegation", "service", "session"
    action: str  # "create", "update", "delete"
    metadata: Dict[str, Any]
    block_height: int
    transaction_hash: str

@dataclass
class EconomicImpact:
    token_transfers: List[TokenTransfer]
    stake_changes: List[StakeChange]
    fee_payments: List[FeePayment]
    reward_distributions: List[RewardDistribution]
    
    # Computed fields
    @property
    def total_transfer_value(self) -> int:
        return sum(transfer.amount for transfer in self.token_transfers)
    
    @property
    def total_fees_paid(self) -> int:
        return sum(fee.amount for fee in self.fee_payments)

@dataclass
class TokenTransfer:
    from_address: str
    to_address: str
    amount: int
    denom: str
    transfer_type: str  # "stake", "reward", "fee", "transfer"
    transaction_hash: str
    block_height: int

@dataclass
class StakeChange:
    address: str
    entity_type: str
    action: str  # "stake" or "unstake"
    amount: int
    session_end_height: Optional[int]
    transaction_hash: str
    block_height: int

@dataclass
class FeePayment:
    payer: str
    recipient: str
    amount: int
    denom: str
    transaction_hash: str
    block_height: int

@dataclass
class RewardDistribution:
    recipient_address: str
    amount: int
    reward_type: str  # "relay", "proposal", "validator"
    session_id: Optional[str]
    transaction_hash: str
    block_height: int
```

#### **7. Block Chain Models**
```python
@dataclass
class BlockChain:
    genesis_block: Block
    latest_block: Block
    total_blocks: int
    total_transactions: int
    chain_id: str
    consensus_params: ConsensusParams
    
    # Computed fields
    @property
    def chain_age(self) -> timedelta:
        return self.latest_block.timestamp - self.genesis_block.timestamp
    
    @property
    def average_block_time(self) -> float:
        if self.total_blocks <= 1:
            return 0.0
        return self.chain_age.total_seconds() / (self.total_blocks - 1)

@dataclass
class ConsensusParams:
    block_max_bytes: int
    block_max_gas: int
    evidence_max_age_num_blocks: int
    evidence_max_age_duration: timedelta
    max_validators: int
    pub_key_types: List[str]

@dataclass
class BlockValidator:
    address: str
    pub_key: bytes
    voting_power: int
    proposer_priority: int
    is_active: bool
```

#### **8. Transaction Pool Models**
```python
@dataclass
class TransactionPool:
    pending_transactions: List[PendingTransaction]
    failed_transactions: List[FailedTransaction]
    pool_size: int
    max_pool_size: int
    
    # Computed fields
    @property
    def is_full(self) -> bool:
        return self.pool_size >= self.max_pool_size
    
    @property
    def utilization_rate(self) -> float:
        return self.pool_size / self.max_pool_size

@dataclass
class PendingTransaction:
    transaction: Transaction
    received_at: datetime
    priority: int
    gas_price: int
    
    # Computed fields
    @property
    def wait_time(self) -> timedelta:
        return datetime.now() - self.received_at

@dataclass
class FailedTransaction:
    transaction: Transaction
    failed_at: datetime
    error_message: str
    retry_count: int
    max_retries: int
    
    # Computed fields
    @property
    def can_retry(self) -> bool:
        return self.retry_count < self.max_retries
```

#### **2. Message Model**
```python
@dataclass
class Message:
    type_url: str
    data: Dict[str, Any]
    signers: List[str]
    message_index: int
    
    # Computed fields
    @property
    def module(self) -> str:
        return self.type_url.split('.')[1]
    
    @property
    def action(self) -> str:
        return self.type_url.split('.')[-1]
    
    @property
    def is_pocket_message(self) -> bool:
        return self.type_url.startswith('pocket.')

@dataclass
class Event:
    type: str
    attributes: List[EventAttribute]

@dataclass
class EventAttribute:
    key: str
    value: str
    index: bool
```

#### **3. Message Type Models**
```python
# Application Messages
@dataclass
class MsgStakeApplication:
    address: str
    stake: Coin
    service_configs: List[ApplicationServiceConfig]

@dataclass
class MsgUnstakeApplication:
    address: str

@dataclass
class MsgDelegateToGateway:
    application_address: str
    gateway_address: str

@dataclass
class MsgUndelegateFromGateway:
    application_address: str
    gateway_address: str

@dataclass
class MsgTransferApplication:
    from_address: str
    to_address: str

# Supplier Messages
@dataclass
class MsgStakeSupplier:
    operator_address: str
    stake: Coin
    services: List[SupplierServiceConfig]

@dataclass
class MsgUnstakeSupplier:
    operator_address: str

# Gateway Messages
@dataclass
class MsgStakeGateway:
    address: str
    stake: Coin

@dataclass
class MsgUnstakeGateway:
    address: str

# Service Messages
@dataclass
class MsgAddService:
    service_id: str
    name: str
    compute_units_per_relay: int
    owner_address: str

# Proof Messages
@dataclass
class MsgCreateClaim:
    supplier_operator_address: str
    session_header: SessionHeader
    root_hash: bytes

@dataclass
class MsgSubmitProof:
    supplier_operator_address: str
    session_header: SessionHeader
    closest_merkle_proof: bytes

# Migration Messages
@dataclass
class MsgClaimMorseAccount:
    morse_address: str
    shannon_address: str

@dataclass
class MsgClaimMorseApplication:
    morse_address: str
    shannon_address: str
    service_configs: List[ApplicationServiceConfig]

@dataclass
class MsgClaimMorseSupplier:
    morse_address: str
    shannon_address: str
    services: List[SupplierServiceConfig]
```

### **Indexing Models**

#### **1. Block Index Model**
```python
@dataclass
class BlockIndex:
    height: int
    hash: str
    timestamp: datetime
    num_transactions: int
    gas_used: int
    gas_wanted: int
    proposer_address: str
    processed: bool
    processing_started: Optional[datetime]
    processing_completed: Optional[datetime]
    error_message: Optional[str]

@dataclass
class BlockTransaction:
    block_height: int
    transaction_hash: str
    message_count: int
    success: bool
    gas_used: int
    fee_amount: int
    fee_denom: str
```

#### **2. Entity Index Model**
```python
@dataclass
class EntityIndex:
    address: str
    entity_type: str  # "application", "supplier", "gateway", "service"
    first_seen_block: int
    last_updated_block: int
    last_updated_timestamp: datetime
    total_transactions: int
    is_active: bool
    metadata: Dict[str, Any]

@dataclass
class EntityTransaction:
    entity_address: str
    entity_type: str
    transaction_hash: str
    block_height: int
    message_type: str
    timestamp: datetime
```

#### **3. Relationship Index Model**
```python
@dataclass
class RelationshipIndex:
    from_address: str
    to_address: str
    relationship_type: str  # "delegation", "service", "session"
    created_block: int
    created_timestamp: datetime
    last_updated_block: int
    last_updated_timestamp: datetime
    is_active: bool
    metadata: Dict[str, Any]

@dataclass
class RelationshipHistory:
    from_address: str
    to_address: str
    relationship_type: str
    action: str  # "create", "update", "delete"
    block_height: int
    timestamp: datetime
    transaction_hash: str
    metadata: Dict[str, Any]
```

#### **4. Session Index Model**
```python
@dataclass
class SessionIndex:
    session_id: str
    application_address: str
    service_id: str
    start_block: int
    end_block: int
    session_number: int
    num_blocks: int
    supplier_count: int
    status: SessionStatus
    created_timestamp: datetime
    completed_timestamp: Optional[datetime]
    claim_submitted: bool
    proof_submitted: bool
    settled: bool

@dataclass
class SessionSupplier:
    session_id: str
    supplier_address: str
    assigned_block: int
    relay_count: int
    total_compute_units: int
    claim_submitted: bool
    proof_submitted: bool
```

#### **5. Economic Index Model**
```python
@dataclass
class StakeIndex:
    address: str
    entity_type: str
    current_stake: int
    total_staked: int
    total_unstaked: int
    first_stake_block: int
    last_stake_block: int
    last_unstake_block: Optional[int]
    unstake_completion_block: Optional[int]

@dataclass
class RewardIndex:
    address: str
    reward_type: str
    total_rewards: int
    last_reward_block: int
    last_reward_timestamp: datetime
    reward_count: int
```

### **Database Schema Models**

#### **1. Table Definitions**
```sql
-- Applications table
CREATE TABLE applications (
    address VARCHAR(255) PRIMARY KEY,
    stake_amount BIGINT NOT NULL,
    stake_denom VARCHAR(10) NOT NULL,
    unstake_session_end_height BIGINT DEFAULT 0,
    pending_transfer_destination VARCHAR(255),
    pending_transfer_session_end_height BIGINT,
    created_block BIGINT NOT NULL,
    updated_block BIGINT NOT NULL,
    created_timestamp TIMESTAMP NOT NULL,
    updated_timestamp TIMESTAMP NOT NULL,
    is_active BOOLEAN DEFAULT TRUE
);

-- Application service configs table
CREATE TABLE application_service_configs (
    id SERIAL PRIMARY KEY,
    application_address VARCHAR(255) REFERENCES applications(address),
    service_id VARCHAR(255) NOT NULL,
    created_block BIGINT NOT NULL,
    created_timestamp TIMESTAMP NOT NULL
);

-- Suppliers table
CREATE TABLE suppliers (
    operator_address VARCHAR(255) PRIMARY KEY,
    owner_address VARCHAR(255) NOT NULL,
    stake_amount BIGINT NOT NULL,
    stake_denom VARCHAR(10) NOT NULL,
    unstake_session_end_height BIGINT DEFAULT 0,
    created_block BIGINT NOT NULL,
    updated_block BIGINT NOT NULL,
    created_timestamp TIMESTAMP NOT NULL,
    updated_timestamp TIMESTAMP NOT NULL,
    is_active BOOLEAN DEFAULT TRUE
);

-- Supplier services table
CREATE TABLE supplier_services (
    id SERIAL PRIMARY KEY,
    supplier_address VARCHAR(255) REFERENCES suppliers(operator_address),
    service_id VARCHAR(255) NOT NULL,
    endpoint_url TEXT,
    rpc_type VARCHAR(20),
    activation_height BIGINT NOT NULL,
    deactivation_height BIGINT,
    created_timestamp TIMESTAMP NOT NULL
);

-- Gateways table
CREATE TABLE gateways (
    address VARCHAR(255) PRIMARY KEY,
    stake_amount BIGINT NOT NULL,
    stake_denom VARCHAR(10) NOT NULL,
    unstake_session_end_height BIGINT DEFAULT 0,
    created_block BIGINT NOT NULL,
    updated_block BIGINT NOT NULL,
    created_timestamp TIMESTAMP NOT NULL,
    updated_timestamp TIMESTAMP NOT NULL,
    is_active BOOLEAN DEFAULT TRUE
);

-- Delegations table
CREATE TABLE delegations (
    id SERIAL PRIMARY KEY,
    application_address VARCHAR(255) REFERENCES applications(address),
    gateway_address VARCHAR(255) REFERENCES gateways(address),
    stake_amount BIGINT NOT NULL,
    created_block BIGINT NOT NULL,
    updated_block BIGINT NOT NULL,
    created_timestamp TIMESTAMP NOT NULL,
    updated_timestamp TIMESTAMP NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    UNIQUE(application_address, gateway_address)
);

-- Sessions table
CREATE TABLE sessions (
    session_id VARCHAR(255) PRIMARY KEY,
    application_address VARCHAR(255) REFERENCES applications(address),
    service_id VARCHAR(255) NOT NULL,
    start_block BIGINT NOT NULL,
    end_block BIGINT NOT NULL,
    session_number BIGINT NOT NULL,
    num_blocks BIGINT NOT NULL,
    supplier_count INTEGER NOT NULL,
    status VARCHAR(20) DEFAULT 'active',
    created_timestamp TIMESTAMP NOT NULL,
    completed_timestamp TIMESTAMP,
    claim_submitted BOOLEAN DEFAULT FALSE,
    proof_submitted BOOLEAN DEFAULT FALSE,
    settled BOOLEAN DEFAULT FALSE
);

-- Session suppliers table
CREATE TABLE session_suppliers (
    id SERIAL PRIMARY KEY,
    session_id VARCHAR(255) REFERENCES sessions(session_id),
    supplier_address VARCHAR(255) REFERENCES suppliers(operator_address),
    assigned_block BIGINT NOT NULL,
    relay_count INTEGER DEFAULT 0,
    total_compute_units BIGINT DEFAULT 0,
    claim_submitted BOOLEAN DEFAULT FALSE,
    proof_submitted BOOLEAN DEFAULT FALSE,
    UNIQUE(session_id, supplier_address)
);

-- Claims table
CREATE TABLE claims (
    id SERIAL PRIMARY KEY,
    session_id VARCHAR(255) REFERENCES sessions(session_id),
    supplier_address VARCHAR(255) REFERENCES suppliers(operator_address),
    root_hash BYTEA NOT NULL,
    proof_validation_status VARCHAR(20) DEFAULT 'pending',
    submitted_block BIGINT NOT NULL,
    submitted_timestamp TIMESTAMP NOT NULL,
    UNIQUE(session_id, supplier_address)
);

-- Proofs table
CREATE TABLE proofs (
    id SERIAL PRIMARY KEY,
    session_id VARCHAR(255) REFERENCES sessions(session_id),
    supplier_address VARCHAR(255) REFERENCES suppliers(operator_address),
    closest_merkle_proof BYTEA NOT NULL,
    submitted_block BIGINT NOT NULL,
    submitted_timestamp TIMESTAMP NOT NULL,
    UNIQUE(session_id, supplier_address)
);

-- Transactions table
CREATE TABLE transactions (
    hash VARCHAR(255) PRIMARY KEY,
    height BIGINT NOT NULL,
    timestamp TIMESTAMP NOT NULL,
    memo TEXT,
    fee_amount BIGINT NOT NULL,
    fee_denom VARCHAR(10) NOT NULL,
    gas_used BIGINT NOT NULL,
    gas_wanted BIGINT NOT NULL,
    success BOOLEAN NOT NULL,
    error_message TEXT,
    message_count INTEGER NOT NULL
);

-- Transaction messages table
CREATE TABLE transaction_messages (
    id SERIAL PRIMARY KEY,
    transaction_hash VARCHAR(255) REFERENCES transactions(hash),
    message_index INTEGER NOT NULL,
    type_url VARCHAR(255) NOT NULL,
    data JSONB NOT NULL,
    signers JSONB NOT NULL,
    UNIQUE(transaction_hash, message_index)
);

-- Blocks table
CREATE TABLE blocks (
    height BIGINT PRIMARY KEY,
    hash VARCHAR(255) NOT NULL,
    timestamp TIMESTAMP NOT NULL,
    num_transactions INTEGER NOT NULL,
    gas_used BIGINT NOT NULL,
    gas_wanted BIGINT NOT NULL,
    proposer_address VARCHAR(255) NOT NULL,
    processed BOOLEAN DEFAULT FALSE,
    processing_started TIMESTAMP,
    processing_completed TIMESTAMP,
    error_message TEXT
);

-- Network parameters table
CREATE TABLE network_parameters (
    module VARCHAR(100) PRIMARY KEY,
    parameters JSONB NOT NULL,
    last_updated_block BIGINT NOT NULL,
    last_updated_timestamp TIMESTAMP NOT NULL
);

-- Events table for transaction events
CREATE TABLE events (
    id SERIAL PRIMARY KEY,
    block_height BIGINT NOT NULL,
    transaction_hash VARCHAR(255) NOT NULL,
    type VARCHAR(255) NOT NULL,
    created_timestamp TIMESTAMP NOT NULL
);

-- Event attributes table
CREATE TABLE event_attributes (
    id SERIAL PRIMARY KEY,
    event_id INTEGER REFERENCES events(id),
    block_height BIGINT NOT NULL,
    key VARCHAR(255) NOT NULL,
    value TEXT NOT NULL,
    index BOOLEAN DEFAULT FALSE,
    created_timestamp TIMESTAMP NOT NULL
);

-- Block processing status table
CREATE TABLE block_processing_status (
    height BIGINT PRIMARY KEY,
    hash VARCHAR(255) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    processing_started TIMESTAMP,
    processing_completed TIMESTAMP,
    error_message TEXT,
    transaction_count INTEGER DEFAULT 0,
    processed_transactions INTEGER DEFAULT 0,
    failed_transactions INTEGER DEFAULT 0,
    created_timestamp TIMESTAMP NOT NULL,
    updated_timestamp TIMESTAMP NOT NULL
);

-- Transaction processing metrics table
CREATE TABLE transaction_processing_metrics (
    id SERIAL PRIMARY KEY,
    block_height BIGINT NOT NULL,
    total_transactions INTEGER NOT NULL,
    successful_transactions INTEGER NOT NULL,
    failed_transactions INTEGER NOT NULL,
    total_gas_used BIGINT NOT NULL,
    total_fees JSONB NOT NULL,
    processing_duration_ms INTEGER,
    created_timestamp TIMESTAMP NOT NULL
);

-- Message parsing results table
CREATE TABLE message_parsing_results (
    id SERIAL PRIMARY KEY,
    transaction_hash VARCHAR(255) REFERENCES transactions(hash),
    message_index INTEGER NOT NULL,
    type_url VARCHAR(255) NOT NULL,
    parsed_data JSONB,
    validation_errors JSONB,
    is_valid BOOLEAN NOT NULL,
    created_timestamp TIMESTAMP NOT NULL,
    UNIQUE(transaction_hash, message_index)
);

-- State changes table
CREATE TABLE state_changes (
    id SERIAL PRIMARY KEY,
    block_height BIGINT NOT NULL,
    transaction_hash VARCHAR(255) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id VARCHAR(255) NOT NULL,
    change_type VARCHAR(20) NOT NULL,
    field_name VARCHAR(255) NOT NULL,
    old_value JSONB,
    new_value JSONB,
    created_timestamp TIMESTAMP NOT NULL
);

-- Relationship changes table
CREATE TABLE relationship_changes (
    id SERIAL PRIMARY KEY,
    block_height BIGINT NOT NULL,
    transaction_hash VARCHAR(255) NOT NULL,
    from_entity_type VARCHAR(50) NOT NULL,
    from_entity_id VARCHAR(255) NOT NULL,
    to_entity_type VARCHAR(50) NOT NULL,
    to_entity_id VARCHAR(255) NOT NULL,
    relationship_type VARCHAR(50) NOT NULL,
    action VARCHAR(20) NOT NULL,
    metadata JSONB,
    created_timestamp TIMESTAMP NOT NULL
);

-- Economic impact table
CREATE TABLE economic_impact (
    id SERIAL PRIMARY KEY,
    transaction_hash VARCHAR(255) REFERENCES transactions(hash),
    token_transfers JSONB,
    stake_changes JSONB,
    fee_payments JSONB,
    reward_distributions JSONB,
    created_timestamp TIMESTAMP NOT NULL
);

-- Chain metadata table
CREATE TABLE chain_metadata (
    id SERIAL PRIMARY KEY,
    chain_id VARCHAR(255) NOT NULL,
    genesis_block_height BIGINT NOT NULL,
    latest_block_height BIGINT NOT NULL,
    total_blocks BIGINT NOT NULL,
    total_transactions BIGINT NOT NULL,
    consensus_params JSONB,
    last_updated_timestamp TIMESTAMP NOT NULL
);

-- Validator set table
CREATE TABLE validator_set (
    id SERIAL PRIMARY KEY,
    block_height BIGINT NOT NULL,
    address VARCHAR(255) NOT NULL,
    pub_key BYTEA NOT NULL,
    voting_power BIGINT NOT NULL,
    proposer_priority INTEGER NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_timestamp TIMESTAMP NOT NULL
);

-- Indexes for performance
CREATE INDEX idx_applications_active ON applications(is_active);
CREATE INDEX idx_suppliers_active ON suppliers(is_active);
CREATE INDEX idx_gateways_active ON gateways(is_active);
CREATE INDEX idx_sessions_status ON sessions(status);
CREATE INDEX idx_sessions_application ON sessions(application_address);
CREATE INDEX idx_delegations_active ON delegations(is_active);
CREATE INDEX idx_transactions_height ON transactions(height);
CREATE INDEX idx_transactions_timestamp ON transactions(timestamp);
CREATE INDEX idx_blocks_timestamp ON blocks(timestamp);
CREATE INDEX idx_claims_session ON claims(session_id);
CREATE INDEX idx_proofs_session ON proofs(session_id);

-- Additional indexes for block and transaction data
CREATE INDEX idx_blocks_hash ON blocks(hash);
CREATE INDEX idx_blocks_proposer ON blocks(proposer_address);
CREATE INDEX idx_blocks_processed ON blocks(processed);
CREATE INDEX idx_transactions_hash ON transactions(hash);
CREATE INDEX idx_transactions_success ON transactions(success);
CREATE INDEX idx_transactions_message_count ON transactions(message_count);
CREATE INDEX idx_transaction_messages_type ON transaction_messages(type_url);
CREATE INDEX idx_transaction_messages_signers ON transaction_messages USING GIN(signers);
CREATE INDEX idx_events_type ON events(type);
CREATE INDEX idx_event_attributes_key ON event_attributes(key);
CREATE INDEX idx_event_attributes_value ON event_attributes(value);
CREATE INDEX idx_event_attributes_indexed ON event_attributes(index);

-- Composite indexes for common query patterns
CREATE INDEX idx_blocks_height_timestamp ON blocks(height, timestamp);
CREATE INDEX idx_transactions_height_success ON transactions(height, success);
CREATE INDEX idx_transactions_height_timestamp ON transactions(height, timestamp);
CREATE INDEX idx_events_height_type ON events(block_height, type);
CREATE INDEX idx_event_attributes_height_key ON event_attributes(block_height, key);
```

#### **2. View Definitions**
```sql
-- Active applications with delegation info
CREATE VIEW active_applications AS
SELECT 
    a.address,
    a.stake_amount,
    a.stake_denom,
    COUNT(d.gateway_address) as delegated_gateway_count,
    SUM(d.stake_amount) as total_delegated_stake
FROM applications a
LEFT JOIN delegations d ON a.address = d.application_address AND d.is_active = true
WHERE a.is_active = true
GROUP BY a.address, a.stake_amount, a.stake_denom;

-- Active suppliers with service info
CREATE VIEW active_suppliers AS
SELECT 
    s.operator_address,
    s.owner_address,
    s.stake_amount,
    s.stake_denom,
    COUNT(ss.service_id) as active_service_count,
    ARRAY_AGG(DISTINCT ss.service_id) as active_services
FROM suppliers s
LEFT JOIN supplier_services ss ON s.operator_address = ss.supplier_address 
    AND (ss.deactivation_height IS NULL OR ss.deactivation_height > 0)
WHERE s.is_active = true
GROUP BY s.operator_address, s.owner_address, s.stake_amount, s.stake_denom;

-- Session summary with claim/proof status
CREATE VIEW session_summary AS
SELECT 
    s.session_id,
    s.application_address,
    s.service_id,
    s.start_block,
    s.end_block,
    s.status,
    s.supplier_count,
    COUNT(c.session_id) as claims_submitted,
    COUNT(p.session_id) as proofs_submitted,
    s.created_timestamp,
    s.completed_timestamp
FROM sessions s
LEFT JOIN claims c ON s.session_id = c.session_id
LEFT JOIN proofs p ON s.session_id = p.session_id
GROUP BY s.session_id, s.application_address, s.service_id, s.start_block, 
         s.end_block, s.status, s.supplier_count, s.created_timestamp, s.completed_timestamp;

-- Block processing summary
CREATE VIEW block_processing_summary AS
SELECT 
    b.height,
    b.hash,
    b.timestamp,
    b.num_transactions,
    bps.status as processing_status,
    bps.processing_started,
    bps.processing_completed,
    bps.transaction_count,
    bps.processed_transactions,
    bps.failed_transactions,
    CASE 
        WHEN bps.processing_completed IS NOT NULL 
        THEN EXTRACT(EPOCH FROM (bps.processing_completed - bps.processing_started)) * 1000
        ELSE NULL 
    END as processing_duration_ms
FROM blocks b
LEFT JOIN block_processing_status bps ON b.height = bps.height;

-- Transaction success rate by block
CREATE VIEW transaction_success_rate AS
SELECT 
    height,
    COUNT(*) as total_transactions,
    SUM(CASE WHEN success THEN 1 ELSE 0 END) as successful_transactions,
    SUM(CASE WHEN NOT success THEN 1 ELSE 0 END) as failed_transactions,
    ROUND(
        (SUM(CASE WHEN success THEN 1 ELSE 0 END)::DECIMAL / COUNT(*)) * 100, 2
    ) as success_rate_percentage,
    AVG(gas_used) as avg_gas_used,
    SUM(fee_amount) as total_fees
FROM transactions
GROUP BY height
ORDER BY height DESC;

-- Message type distribution
CREATE VIEW message_type_distribution AS
SELECT 
    type_url,
    COUNT(*) as message_count,
    COUNT(DISTINCT transaction_hash) as transaction_count,
    ROUND(
        (COUNT(*)::DECIMAL / (SELECT COUNT(*) FROM transaction_messages)) * 100, 2
    ) as percentage_of_total
FROM transaction_messages
GROUP BY type_url
ORDER BY message_count DESC;

-- Pocket Network message activity
CREATE VIEW pocket_message_activity AS
SELECT 
    DATE(t.created_timestamp) as date,
    tm.type_url,
    COUNT(*) as message_count,
    COUNT(DISTINCT t.hash) as transaction_count,
    SUM(CASE WHEN t.success THEN 1 ELSE 0 END) as successful_transactions
FROM transaction_messages tm
JOIN transactions t ON tm.transaction_hash = t.hash
WHERE tm.type_url LIKE 'pocket.%'
GROUP BY DATE(t.created_timestamp), tm.type_url
ORDER BY date DESC, message_count DESC;

-- Economic activity summary
CREATE VIEW economic_activity_summary AS
SELECT 
    DATE(t.created_timestamp) as date,
    COUNT(DISTINCT t.hash) as transaction_count,
    SUM(t.fee_amount) as total_fees,
    SUM(t.gas_used) as total_gas_used,
    COUNT(DISTINCT CASE WHEN tm.type_url LIKE 'pocket.%' THEN t.hash END) as pocket_transactions,
    COUNT(CASE WHEN tm.type_url LIKE 'pocket.%' THEN 1 END) as pocket_messages
FROM transactions t
LEFT JOIN transaction_messages tm ON t.hash = tm.transaction_hash
GROUP BY DATE(t.created_timestamp)
ORDER BY date DESC;

-- Validator performance
CREATE VIEW validator_performance AS
SELECT 
    vs.address,
    vs.voting_power,
    COUNT(DISTINCT b.height) as blocks_proposed,
    AVG(b.num_transactions) as avg_transactions_per_block,
    AVG(b.gas_used) as avg_gas_used_per_block,
    MIN(b.timestamp) as first_proposal,
    MAX(b.timestamp) as last_proposal
FROM validator_set vs
JOIN blocks b ON vs.address = b.proposer_address
WHERE vs.is_active = true
GROUP BY vs.address, vs.voting_power
ORDER BY blocks_proposed DESC;
```

---

## **API Integration**

### **Endpoint Configuration**

#### **1. Node Selection**
```python
class NodeManager:
    def __init__(self, node_urls):
        self.nodes = node_urls
        self.current_node_index = 0
        self.node_health = {}
    
    def get_healthy_node(self):
        """Get a healthy node for API calls"""
        for i, node in enumerate(self.nodes):
            if self.is_node_healthy(node):
                self.current_node_index = i
                return node
        raise Exception("No healthy nodes available")
    
    def is_node_healthy(self, node_url):
        """Check if a node is healthy"""
        try:
            response = requests.get(f"{node_url}/cosmos/base/tendermint/v1beta1/node_info", timeout=5)
            return response.status_code == 200
        except:
            return False
```

#### **2. Rate Limiting**
```python
class RateLimiter:
    def __init__(self, requests_per_second=10):
        self.rate_limit = requests_per_second
        self.last_request_time = 0
    
    def wait_if_needed(self):
        """Wait if rate limit would be exceeded"""
        current_time = time.time()
        time_since_last = current_time - self.last_request_time
        min_interval = 1.0 / self.rate_limit
        
        if time_since_last < min_interval:
            time.sleep(min_interval - time_since_last)
        
        self.last_request_time = time.time()
```

#### **3. Retry Logic**
```python
class APIClient:
    def __init__(self, node_manager, rate_limiter):
        self.node_manager = node_manager
        self.rate_limiter = rate_limiter
        self.max_retries = 3
    
    def make_request(self, endpoint, params=None):
        """Make API request with retry logic"""
        for attempt in range(self.max_retries):
            try:
                self.rate_limiter.wait_if_needed()
                node_url = self.node_manager.get_healthy_node()
                
                response = requests.get(f"{node_url}{endpoint}", params=params, timeout=30)
                
                if response.status_code == 200:
                    return response.json()
                elif response.status_code == 429:  # Rate limited
                    time.sleep(2 ** attempt)  # Exponential backoff
                    continue
                else:
                    response.raise_for_status()
                    
            except Exception as e:
                if attempt == self.max_retries - 1:
                    raise e
                time.sleep(2 ** attempt)
        
        raise Exception("Max retries exceeded")
```

### **Data Fetching Strategies**

#### **1. Pagination Handling**
```python
class PaginationHandler:
    def __init__(self, api_client):
        self.api_client = api_client
    
    def fetch_all_paginated(self, endpoint, params=None):
        """Fetch all data from a paginated endpoint"""
        all_data = []
        next_key = None
        params = params or {}
        
        while True:
            if next_key:
                params['pagination.key'] = next_key
            else:
                params['pagination.limit'] = 100
            
            response = self.api_client.make_request(endpoint, params)
            
            if 'data' in response:
                all_data.extend(response['data'])
            else:
                all_data.extend(response.get('applications', []))
                all_data.extend(response.get('suppliers', []))
                all_data.extend(response.get('gateways', []))
                all_data.extend(response.get('services', []))
            
            pagination = response.get('pagination', {})
            next_key = pagination.get('next_key')
            
            if not next_key:
                break
        
        return all_data
```

#### **2. Batch Processing**
```python
class BatchProcessor:
    def __init__(self, api_client, batch_size=10):
        self.api_client = api_client
        self.batch_size = batch_size
    
    def process_entities(self, entity_type, entity_ids):
        """Process entities in batches"""
        results = {}
        
        for i in range(0, len(entity_ids), self.batch_size):
            batch = entity_ids[i:i + self.batch_size]
            
            # Process batch in parallel
            with ThreadPoolExecutor(max_workers=self.batch_size) as executor:
                futures = {
                    executor.submit(self.fetch_entity, entity_type, entity_id): entity_id
                    for entity_id in batch
                }
                
                for future in as_completed(futures):
                    entity_id = futures[future]
                    try:
                        results[entity_id] = future.result()
                    except Exception as e:
                        logger.error(f"Failed to fetch {entity_type} {entity_id}: {e}")
                        results[entity_id] = None
        
        return results
```

---

## **Performance Requirements**

### **Throughput Requirements**

#### **1. Block Processing**
- **Target**: Process new blocks within 1 second of availability
- **Peak Capacity**: Handle up to 10 blocks per second during catch-up
- **Latency**: Maximum 100ms delay between block availability and index update

#### **2. Transaction Processing**
- **Target**: Parse and index up to 1000 transactions per second
- **Memory Usage**: Keep memory usage under 2GB during peak processing
- **Storage**: Efficient storage allowing queries to complete within 100ms

#### **3. Query Performance**
- **Simple Queries**: Return results within 50ms
- **Complex Queries**: Return results within 500ms
- **Aggregation Queries**: Return results within 2 seconds

### **Scalability Requirements**

#### **1. Data Volume**
- **Applications**: Support up to 100,000 applications
- **Suppliers**: Support up to 50,000 suppliers
- **Gateways**: Support up to 10,000 gateways
- **Sessions**: Support up to 1,000,000 active sessions
- **Transactions**: Support up to 100,000,000 historical transactions

#### **2. Concurrent Access**
- **Read Operations**: Support up to 1000 concurrent read requests
- **Write Operations**: Support up to 100 concurrent write operations
- **Background Processing**: Support up to 10 concurrent background tasks

### **Resource Requirements**

#### **1. CPU**
- **Minimum**: 4 CPU cores
- **Recommended**: 8 CPU cores
- **Peak Usage**: Efficiently utilize available CPU cores during processing

#### **2. Memory**
- **Minimum**: 8GB RAM
- **Recommended**: 16GB RAM
- **Usage Pattern**: Efficient memory management with minimal garbage collection

#### **3. Storage**
- **Minimum**: 100GB SSD
- **Recommended**: 500GB NVMe SSD
- **I/O Performance**: Support high-throughput read/write operations

---

## **Error Handling & Resilience**

### **Error Types & Handling**

#### **1. API Errors**
```python
class APIErrorHandler:
    def __init__(self):
        self.error_counts = defaultdict(int)
        self.max_errors = 10
    
    def handle_api_error(self, error, endpoint):
        """Handle API errors with appropriate responses"""
        if isinstance(error, requests.exceptions.Timeout):
            return self.handle_timeout_error(error, endpoint)
        elif isinstance(error, requests.exceptions.ConnectionError):
            return self.handle_connection_error(error, endpoint)
        elif isinstance(error, requests.exceptions.HTTPError):
            return self.handle_http_error(error, endpoint)
        else:
            return self.handle_unknown_error(error, endpoint)
    
    def handle_timeout_error(self, error, endpoint):
        """Handle timeout errors"""
        self.error_counts[endpoint] += 1
        
        if self.error_counts[endpoint] > self.max_errors:
            logger.error(f"Too many errors for {endpoint}, marking as unhealthy")
            return "unhealthy"
        
        return "retry"
    
    def handle_connection_error(self, error, endpoint):
        """Handle connection errors"""
        logger.warning(f"Connection error for {endpoint}: {error}")
        return "retry"
    
    def handle_http_error(self, error, endpoint):
        """Handle HTTP errors"""
        if error.response.status_code == 404:
            logger.error(f"Endpoint not found: {endpoint}")
            return "fatal"
        elif error.response.status_code == 500:
            logger.error(f"Server error for {endpoint}: {error}")
            return "retry"
        else:
            logger.warning(f"HTTP error for {endpoint}: {error}")
            return "retry"
```

#### **2. Data Consistency Errors**
```python
class ConsistencyChecker:
    def __init__(self, state_manager, relationship_manager):
        self.state_manager = state_manager
        self.relationship_manager = relationship_manager
    
    def check_consistency(self):
        """Check data consistency across all entities"""
        issues = []
        
        # Check application delegations
        for app_addr, app_data in self.state_manager.applications.items():
            for gateway_addr in app_data.delegatee_gateway_addresses:
                if gateway_addr not in self.state_manager.gateways:
                    issues.append(f"Application {app_addr} delegates to non-existent gateway {gateway_addr}")
        
        # Check supplier services
        for supplier_addr, supplier_data in self.state_manager.suppliers.items():
            for service_config in supplier_data.services:
                if service_config.service_id not in self.state_manager.services:
                    issues.append(f"Supplier {supplier_addr} provides non-existent service {service_config.service_id}")
        
        return issues
    
    def repair_inconsistencies(self, issues):
        """Attempt to repair data inconsistencies"""
        for issue in issues:
            logger.warning(f"Attempting to repair: {issue}")
            # Implement repair logic based on issue type
```

### **Recovery Mechanisms**

#### **1. Automatic Recovery**
```python
class RecoveryManager:
    def __init__(self, state_manager, data_collector):
        self.state_manager = state_manager
        self.data_collector = data_collector
        self.recovery_attempts = 0
        self.max_recovery_attempts = 5
    
    def recover_from_error(self, error, context):
        """Attempt to recover from an error"""
        if self.recovery_attempts >= self.max_recovery_attempts:
            logger.error("Max recovery attempts exceeded, manual intervention required")
            return False
        
        try:
            if isinstance(error, StateInconsistencyError):
                return self.recover_state_inconsistency(error, context)
            elif isinstance(error, RelationshipInconsistencyError):
                return self.recover_relationship_inconsistency(error, context)
            else:
                return self.recover_unknown_error(error, context)
        except Exception as recovery_error:
            logger.error(f"Recovery failed: {recovery_error}")
            self.recovery_attempts += 1
            return False
    
    def recover_state_inconsistency(self, error, context):
        """Recover from state inconsistency"""
        logger.info("Attempting state inconsistency recovery")
        
        # Re-fetch data from blockchain
        fresh_data = self.data_collector.collect_state_data()
        
        # Compare with current state
        differences = self.state_manager.compare_states(
            self.state_manager.get_current_state(),
            fresh_data
        )
        
        # Apply corrections
        for diff in differences:
            self.state_manager.apply_correction(diff)
        
        return True
```

#### **2. Fallback Strategies**
```python
class FallbackManager:
    def __init__(self, primary_node, fallback_nodes):
        self.primary_node = primary_node
        self.fallback_nodes = fallback_nodes
        self.current_node = primary_node
    
    def switch_to_fallback(self):
        """Switch to a fallback node"""
        for fallback_node in self.fallback_nodes:
            if self.is_node_healthy(fallback_node):
                self.current_node = fallback_node
                logger.info(f"Switched to fallback node: {fallback_node}")
                return True
        
        logger.error("No healthy fallback nodes available")
        return False
    
    def restore_primary(self):
        """Attempt to restore primary node"""
        if self.is_node_healthy(self.primary_node):
            self.current_node = self.primary_node
            logger.info("Restored primary node")
            return True
        return False
```

---

## **Monitoring & Alerting**

### **Health Checks**

#### **1. System Health Monitoring**
```python
class HealthMonitor:
    def __init__(self):
        self.health_checks = {
            "block_processing": self.check_block_processing,
            "api_connectivity": self.check_api_connectivity,
            "data_consistency": self.check_data_consistency,
            "storage_health": self.check_storage_health,
            "memory_usage": self.check_memory_usage
        }
    
    def run_health_checks(self):
        """Run all health checks"""
        results = {}
        overall_health = "healthy"
        
        for check_name, check_func in self.health_checks.items():
            try:
                result = check_func()
                results[check_name] = result
                
                if result["status"] != "healthy":
                    overall_health = "unhealthy"
                    
            except Exception as e:
                results[check_name] = {
                    "status": "error",
                    "message": str(e),
                    "timestamp": datetime.now()
                }
                overall_health = "unhealthy"
        
        return {
            "overall_status": overall_health,
            "checks": results,
            "timestamp": datetime.now()
        }
    
    def check_block_processing(self):
        """Check if block processing is healthy"""
        current_height = get_current_block_height()
        last_processed = get_last_processed_height()
        
        if current_height - last_processed > 10:
            return {
                "status": "unhealthy",
                "message": f"Block processing lag: {current_height - last_processed} blocks",
                "current_height": current_height,
                "last_processed": last_processed
            }
        
        return {
            "status": "healthy",
            "message": "Block processing is up to date",
            "current_height": current_height,
            "last_processed": last_processed
        }
```

#### **2. Performance Monitoring**
```python
class PerformanceMonitor:
    def __init__(self):
        self.metrics = defaultdict(list)
        self.start_times = {}
    
    def start_timer(self, operation):
        """Start timing an operation"""
        self.start_times[operation] = time.time()
    
    def end_timer(self, operation):
        """End timing an operation and record metric"""
        if operation in self.start_times:
            duration = time.time() - self.start_times[operation]
            self.metrics[operation].append(duration)
            
            # Keep only last 1000 measurements
            if len(self.metrics[operation]) > 1000:
                self.metrics[operation] = self.metrics[operation][-1000:]
            
            del self.start_times[operation]
    
    def get_performance_stats(self):
        """Get performance statistics"""
        stats = {}
        
        for operation, measurements in self.metrics.items():
            if measurements:
                stats[operation] = {
                    "count": len(measurements),
                    "avg_duration": sum(measurements) / len(measurements),
                    "min_duration": min(measurements),
                    "max_duration": max(measurements),
                    "p95_duration": sorted(measurements)[int(len(measurements) * 0.95)]
                }
        
        return stats
```

### **Alerting System**

#### **1. Alert Configuration**
```python
class AlertManager:
    def __init__(self, alert_config):
        self.config = alert_config
        self.alert_history = []
    
    def send_alert(self, alert_type, message, severity="warning"):
        """Send an alert"""
        alert = {
            "type": alert_type,
            "message": message,
            "severity": severity,
            "timestamp": datetime.now()
        }
        
        self.alert_history.append(alert)
        
        # Send to appropriate channels based on severity
        if severity == "critical":
            self.send_critical_alert(alert)
        elif severity == "warning":
            self.send_warning_alert(alert)
        else:
            self.send_info_alert(alert)
    
    def send_critical_alert(self, alert):
        """Send critical alert (e.g., SMS, phone call)"""
        # Implementation depends on alerting service
        pass
    
    def send_warning_alert(self, alert):
        """Send warning alert (e.g., email, Slack)"""
        # Implementation depends on alerting service
        pass
    
    def send_info_alert(self, alert):
        """Send info alert (e.g., logging, dashboard)"""
        logger.info(f"Alert: {alert['message']}")
```

#### **2. Alert Triggers**
```python
class AlertTriggers:
    def __init__(self, alert_manager):
        self.alert_manager = alert_manager
    
    def check_block_processing_alerts(self, current_height, last_processed):
        """Check for block processing alerts"""
        lag = current_height - last_processed
        
        if lag > 100:
            self.alert_manager.send_alert(
                "block_processing",
                f"Critical: Block processing lag is {lag} blocks",
                "critical"
            )
        elif lag > 50:
            self.alert_manager.send_alert(
                "block_processing",
                f"Warning: Block processing lag is {lag} blocks",
                "warning"
            )
    
    def check_api_health_alerts(self, node_health):
        """Check for API health alerts"""
        unhealthy_nodes = [node for node, health in node_health.items() if not health]
        
        if len(unhealthy_nodes) == len(node_health):
            self.alert_manager.send_alert(
                "api_health",
                "Critical: All nodes are unhealthy",
                "critical"
            )
        elif unhealthy_nodes:
            self.alert_manager.send_alert(
                "api_health",
                f"Warning: {len(unhealthy_nodes)} nodes are unhealthy: {unhealthy_nodes}",
                "warning"
            )
    
    def check_data_consistency_alerts(self, consistency_issues):
        """Check for data consistency alerts"""
        if consistency_issues:
            self.alert_manager.send_alert(
                "data_consistency",
                f"Warning: {len(consistency_issues)} data consistency issues detected",
                "warning"
            )
```

---

## **Implementation Checklist**

### **Phase 1: Core Infrastructure**
- [x] Set up project structure and dependencies
- [x] Implement basic API client with retry logic
- [x] Create data models for all entities
- [x] Implement basic state manager
- [x] Set up database schema

### **Phase 2: Data Collection**
- [x] Implement block monitoring
- [x] Create transaction parser for all message types
- [x] Implement state data collection
- [x] Add pagination handling
- [x] Implement batch processing

### **Phase 3: Relationship Management**
- [x] Implement relationship tracking
- [x] Create relationship update logic
- [ ] Add consistency checking
- [x] Implement relationship queries

### **Phase 4: Performance & Reliability**
- [x] Add caching layer
- [x] Implement connection pooling
- [ ] Add rate limiting
- [x] Implement error recovery
- [x] Add performance monitoring

### **Phase 5: Monitoring & Operations**
- [x] Implement health checks
- [ ] Add alerting system
- [x] Create operational dashboards
- [x] Add logging and metrics
- [ ] Implement backup and recovery

### **Phase 6: Testing & Validation**
- [ ] Unit tests for all components
- [ ] Integration tests with testnet
- [ ] Performance testing
- [ ] Data consistency validation
- [ ] Error scenario testing

---

## **Conclusion**

This document provides a comprehensive guide for building a Pocket Network indexer. The key success factors are:

1. **Understanding the relationships** between different network actors
2. **Efficient transaction parsing** to detect state changes
3. **Robust error handling** and recovery mechanisms
4. **Performance optimization** for real-time processing
5. **Comprehensive monitoring** and alerting

The indexer should be designed as a modular, scalable system that can handle the dynamic nature of the Pocket Network while maintaining data consistency and providing fast access to network information.

Remember to start with the core functionality and gradually add features based on actual usage patterns and requirements.
