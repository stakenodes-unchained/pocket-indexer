# Log Viewer API Documentation

## Overview

The Log Viewer API provides real-time log streaming from Docker containers via WebSocket connections, along with REST endpoints for container management and historical log retrieval. This API enables frontend applications to monitor and filter logs from any Docker container in real-time.

## Architecture

```
Browser (Frontend)
    ↕ WebSocket Connection
Node.js Backend (api-server.js)
    ↕ Docker Engine API (via dockerode)
Docker Engine (Unix socket /var/run/docker.sock)
```

The API uses:
- **REST endpoints** for container listing and historical log retrieval
- **WebSocket connections** for real-time log streaming
- **Docker Engine API** for accessing container logs

## Prerequisites

- Docker must be running and accessible
- Docker socket must be accessible at `/var/run/docker.sock` (or configured via `DOCKER_HOST` environment variable)
- The API server must have permissions to access the Docker socket

## Port and Network Configuration

### WebSocket Port

The WebSocket server runs on the **same port as the HTTP server**:
- **Default port:** `3006` (configurable via `PORT` environment variable)
- **WebSocket path:** `/api/v1/logs/stream`
- **Full WebSocket URL:** `ws://localhost:3006/api/v1/logs/stream` (or `wss://` for SSL)

### Behind Nginx Reverse Proxy

If you're using nginx as a reverse proxy, you **must** configure it to handle WebSocket upgrades. See `nginx-websocket.conf.example` for a complete configuration.

**Key nginx requirements:**
1. **WebSocket upgrade headers:**
   ```nginx
   proxy_set_header Upgrade $http_upgrade;
   proxy_set_header Connection "upgrade";
   ```

2. **Extended timeouts** (WebSocket connections can be long-lived):
   ```nginx
   proxy_connect_timeout 7d;
   proxy_send_timeout 7d;
   proxy_read_timeout 7d;
   ```

3. **Disable buffering:**
   ```nginx
   proxy_buffering off;
   ```

4. **Use HTTP/1.1:**
   ```nginx
   proxy_http_version 1.1;
   ```

**Example nginx location block:**
```nginx
location /api/v1/logs/stream {
    proxy_pass http://localhost:3006;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_connect_timeout 7d;
    proxy_send_timeout 7d;
    proxy_read_timeout 7d;
    proxy_buffering off;
}
```

### Docker Socket Configuration

When running the API server in a Docker container (via `docker-compose`), the Docker socket is automatically mounted as a read-only volume:

```yaml
volumes:
  - /var/run/docker.sock:/var/run/docker.sock:ro
```

If you're running the API server directly (not in Docker), ensure:
- Docker socket exists at `/var/run/docker.sock`
- Your user has read permissions to the socket (usually requires `docker` group membership)

For TCP connections (not recommended for containers), set:
- `DOCKER_HOST=tcp://host:port`
- `DOCKER_PORT=2375` (if different from default)

## REST API Endpoints

### List All Containers

Get a list of all available Docker containers (running and stopped).

**Endpoint:** `GET /api/v1/logs/containers`

**Query Parameters:**
- `all` (optional): Include stopped containers. Values: `true`, `1`, `false`, `0`. Default: `false`

**Response:**
```json
{
  "data": [
    {
      "id": "abc123def456...",
      "name": "pocket_indexer_api",
      "image": "pocket-indexer:latest",
      "status": "Up 2 hours",
      "state": "running",
      "created": 1234567890,
      "ports": []
    }
  ],
  "total": 4
}
```

**Example:**
```bash
curl http://localhost:3006/api/v1/logs/containers?all=true
```

### Get Container Metadata

Get detailed information about a specific container.

**Endpoint:** `GET /api/v1/logs/containers/:containerId`

**Path Parameters:**
- `containerId`: Container ID or name

**Response:**
```json
{
  "data": {
    "id": "abc123def456...",
    "name": "pocket_indexer_api",
    "image": "pocket-indexer:latest",
    "state": "running",
    "startedAt": "2024-01-01T12:00:00.000000000Z",
    "finishedAt": null,
    "restartCount": 0,
    "platform": "linux",
    "env": ["NODE_ENV=production", "PORT=3006"]
  }
}
```

**Example:**
```bash
curl http://localhost:3006/api/v1/logs/containers/pocket_indexer_api
```

### Get Historical Logs

Retrieve historical logs from a container with pagination and filtering.

**Endpoint:** `GET /api/v1/logs/containers/:containerId/history`

**Path Parameters:**
- `containerId`: Container ID or name

**Query Parameters:**
- `tail` (optional): Number of lines to fetch. Default: `100`
- `since` (optional): Start timestamp (ISO 8601 format). Example: `2024-01-01T00:00:00Z`
- `until` (optional): End timestamp (ISO 8601 format)
- `logLevel` (optional): Filter by log level. Values: `debug`, `info`, `warn`, `error`
- `filter` (optional): Regex pattern to filter logs
- `search` (optional): Simple text search in log messages
- `page` (optional): Page number for pagination. Default: `1`
- `limit` (optional): Items per page. Default: `100`

**Response:**
```json
{
  "data": [
    {
      "timestamp": "2024-01-01T12:00:00.123456789Z",
      "stream": "stdout",
      "level": "info",
      "message": "Server started on port 3006"
    }
  ],
  "meta": {
    "total": 150,
    "page": 1,
    "limit": 100,
    "totalPages": 2
  }
}
```

**Example:**
```bash
curl "http://localhost:3006/api/v1/logs/containers/pocket_indexer_api/history?tail=50&logLevel=error&page=1&limit=25"
```

## WebSocket API

### Connection

**Endpoint:** `ws://localhost:3006/api/v1/logs/stream`

The WebSocket server accepts connections and sends/receives JSON messages.

### Message Protocol

#### Client → Server Messages

##### Start Log Stream

Start streaming logs from a container.

```json
{
  "action": "start",
  "containerId": "pocket_indexer_api",
  "options": {
    "tail": 100,
    "follow": true,
    "since": "2024-01-01T00:00:00Z",
    "until": "2024-01-02T00:00:00Z",
    "filter": "error|warn",
    "logLevel": "error",
    "search": "database"
  }
}
```

**Parameters:**
- `action`: Must be `"start"`
- `containerId`: Container ID or name (required)
- `options` (optional):
  - `tail`: Number of lines to fetch initially. Default: `0`
  - `follow`: Stream new logs as they arrive. Default: `true`
  - `since`: Start timestamp (ISO 8601 format)
  - `until`: End timestamp (ISO 8601 format)
  - `filter`: Regex pattern to filter logs
  - `logLevel`: Filter by log level (`debug`, `info`, `warn`, `error`)
  - `search`: Simple text search in log messages

##### Stop Log Stream

Stop an active log stream.

```json
{
  "action": "stop",
  "streamId": "unique-stream-id"
}
```

**Parameters:**
- `action`: Must be `"stop"`
- `streamId`: Stream ID returned from the start action (required)

#### Server → Client Messages

##### Connection Established

Sent when WebSocket connection is established.

```json
{
  "type": "connected",
  "connectionId": "abc-123-def",
  "message": "WebSocket log viewer connected"
}
```

##### Stream Started

Sent when a log stream is successfully started.

```json
{
  "type": "stream_started",
  "streamId": "unique-stream-id",
  "containerId": "pocket_indexer_api"
}
```

##### Log Data

Sent for each log line that matches the filters.

```json
{
  "type": "log",
  "streamId": "unique-stream-id",
  "containerId": "pocket_indexer_api",
  "timestamp": "2024-01-01T12:00:00.123456789Z",
  "level": "info",
  "stream": "stdout",
  "message": "Server started on port 3006"
}
```

##### Stream Stopped

Sent when a log stream is stopped.

```json
{
  "type": "stream_stopped",
  "streamId": "unique-stream-id"
}
```

##### Error

Sent when an error occurs.

```json
{
  "type": "error",
  "streamId": "unique-stream-id",
  "message": "Container not found"
}
```

## Frontend Integration

### JavaScript/TypeScript Example

```javascript
class LogViewer {
  constructor(wsUrl = 'ws://localhost:3006/api/v1/logs/stream') {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.activeStreams = new Map();
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
  }

  connect() {
    this.ws = new WebSocket(this.wsUrl);

    this.ws.onopen = () => {
      console.log('WebSocket connected');
      this.reconnectAttempts = 0;
      this.onConnected();
    };

    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      this.handleMessage(message);
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      this.onError(error);
    };

    this.ws.onclose = () => {
      console.log('WebSocket closed');
      this.onDisconnected();
      this.attemptReconnect();
    };
  }

  handleMessage(message) {
    switch (message.type) {
      case 'connected':
        console.log('Connection established:', message.connectionId);
        break;
      
      case 'stream_started':
        console.log('Stream started:', message.streamId);
        this.activeStreams.set(message.streamId, {
          containerId: message.containerId,
          startedAt: new Date()
        });
        break;
      
      case 'log':
        this.onLog(message);
        break;
      
      case 'stream_stopped':
        console.log('Stream stopped:', message.streamId);
        this.activeStreams.delete(message.streamId);
        break;
      
      case 'error':
        console.error('Error:', message.message);
        this.onError(message);
        break;
      
      default:
        console.warn('Unknown message type:', message.type);
    }
  }

  startStream(containerId, options = {}) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not connected');
    }

    const message = {
      action: 'start',
      containerId,
      options: {
        tail: options.tail || 100,
        follow: options.follow !== false,
        since: options.since,
        until: options.until,
        filter: options.filter,
        logLevel: options.logLevel,
        search: options.search
      }
    };

    this.ws.send(JSON.stringify(message));
  }

  stopStream(streamId) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not connected');
    }

    const message = {
      action: 'stop',
      streamId
    };

    this.ws.send(JSON.stringify(message));
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  attemptReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
      console.log(`Reconnecting in ${delay}ms... (attempt ${this.reconnectAttempts})`);
      setTimeout(() => this.connect(), delay);
    } else {
      console.error('Max reconnection attempts reached');
    }
  }

  // Override these methods in your implementation
  onConnected() {}
  onDisconnected() {}
  onLog(message) {
    console.log(`[${message.level}] ${message.message}`);
  }
  onError(error) {}
}

// Usage example
const viewer = new LogViewer();

viewer.onLog = (message) => {
  // Display log in UI
  const logElement = document.createElement('div');
  logElement.className = `log-entry log-${message.level}`;
  logElement.innerHTML = `
    <span class="timestamp">${new Date(message.timestamp).toLocaleString()}</span>
    <span class="level">${message.level}</span>
    <span class="message">${message.message}</span>
  `;
  document.getElementById('log-container').appendChild(logElement);
};

viewer.connect();

// Start streaming logs from a container
viewer.startStream('pocket_indexer_api', {
  tail: 50,
  follow: true,
  logLevel: 'error'
});
```

### React Example

```jsx
import React, { useEffect, useState, useRef } from 'react';

function LogViewer({ containerId, filters = {} }) {
  const [logs, setLogs] = useState([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef(null);
  const streamIdRef = useRef(null);

  useEffect(() => {
    const ws = new WebSocket('ws://localhost:3006/api/v1/logs/stream');
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      // Start streaming
      ws.send(JSON.stringify({
        action: 'start',
        containerId,
        options: {
          tail: 100,
          follow: true,
          ...filters
        }
      }));
    };

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      
      if (message.type === 'stream_started') {
        streamIdRef.current = message.streamId;
      } else if (message.type === 'log') {
        setLogs(prev => [...prev, message].slice(-1000)); // Keep last 1000 logs
      } else if (message.type === 'error') {
        console.error('Log stream error:', message.message);
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      setConnected(false);
    };

    ws.onclose = () => {
      setConnected(false);
    };

    return () => {
      if (streamIdRef.current) {
        ws.send(JSON.stringify({
          action: 'stop',
          streamId: streamIdRef.current
        }));
      }
      ws.close();
    };
  }, [containerId, filters]);

  return (
    <div className="log-viewer">
      <div className="status">
        Status: {connected ? 'Connected' : 'Disconnected'}
      </div>
      <div className="logs">
        {logs.map((log, index) => (
          <div key={index} className={`log-entry log-${log.level}`}>
            <span className="timestamp">
              {new Date(log.timestamp).toLocaleString()}
            </span>
            <span className="level">{log.level}</span>
            <span className="message">{log.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default LogViewer;
```

### Vue.js Example

```vue
<template>
  <div class="log-viewer">
    <div class="status">
      Status: {{ connected ? 'Connected' : 'Disconnected' }}
    </div>
    <div class="logs">
      <div
        v-for="(log, index) in logs"
        :key="index"
        :class="['log-entry', `log-${log.level}`]"
      >
        <span class="timestamp">{{ formatTimestamp(log.timestamp) }}</span>
        <span class="level">{{ log.level }}</span>
        <span class="message">{{ log.message }}</span>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'LogViewer',
  props: {
    containerId: {
      type: String,
      required: true
    },
    filters: {
      type: Object,
      default: () => ({})
    }
  },
  data() {
    return {
      logs: [],
      connected: false,
      ws: null,
      streamId: null
    };
  },
  mounted() {
    this.connect();
  },
  beforeUnmount() {
    this.disconnect();
  },
  methods: {
    connect() {
      this.ws = new WebSocket('ws://localhost:3006/api/v1/logs/stream');

      this.ws.onopen = () => {
        this.connected = true;
        this.startStream();
      };

      this.ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        this.handleMessage(message);
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        this.connected = false;
      };

      this.ws.onclose = () => {
        this.connected = false;
      };
    },
    startStream() {
      this.ws.send(JSON.stringify({
        action: 'start',
        containerId: this.containerId,
        options: {
          tail: 100,
          follow: true,
          ...this.filters
        }
      }));
    },
    handleMessage(message) {
      if (message.type === 'stream_started') {
        this.streamId = message.streamId;
      } else if (message.type === 'log') {
        this.logs.push(message);
        // Keep last 1000 logs
        if (this.logs.length > 1000) {
          this.logs.shift();
        }
      } else if (message.type === 'error') {
        console.error('Log stream error:', message.message);
      }
    },
    disconnect() {
      if (this.streamId) {
        this.ws.send(JSON.stringify({
          action: 'stop',
          streamId: this.streamId
        }));
      }
      if (this.ws) {
        this.ws.close();
      }
    },
    formatTimestamp(timestamp) {
      return new Date(timestamp).toLocaleString();
    }
  }
};
</script>
```

## Error Handling

### Common Errors

1. **Docker service not available**
   - **Error:** `Docker service is not available`
   - **Solution:** Ensure Docker is running and the socket is accessible

2. **Container not found**
   - **Error:** `Container {containerId} not found`
   - **Solution:** Verify the container ID/name is correct

3. **WebSocket connection failed**
   - **Error:** Connection refused or timeout
   - **Solution:** Check that the API server is running and WebSocket endpoint is accessible

4. **Invalid message format**
   - **Error:** `Invalid message format`
   - **Solution:** Ensure messages are valid JSON with required fields

### Reconnection Strategy

Implement exponential backoff for reconnections:

```javascript
let reconnectAttempts = 0;
const maxAttempts = 5;

function reconnect() {
  if (reconnectAttempts < maxAttempts) {
    reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
    setTimeout(() => {
      connect();
    }, delay);
  }
}
```

## Security Considerations

1. **Container ID Validation**: The API validates container IDs to prevent path traversal attacks
2. **Rate Limiting**: Consider implementing rate limiting for WebSocket connections
3. **Authentication**: Add authentication/authorization if needed for production use
4. **Log Sanitization**: Log output is sanitized to prevent XSS attacks
5. **Docker Socket Access**: Ensure proper permissions on Docker socket (read-only access recommended)

## Performance Tips

1. **Limit Log History**: Use `tail` parameter to limit initial log fetch
2. **Filter Early**: Apply filters on the server side to reduce network traffic
3. **Pagination**: Use pagination for historical logs to avoid loading too much data
4. **Connection Pooling**: Reuse WebSocket connections when possible
5. **Log Buffer**: Implement client-side log buffering to handle high-frequency logs

## Example Use Cases

### 1. Real-time Error Monitoring

```javascript
viewer.startStream('pocket_indexer_api', {
  tail: 0,
  follow: true,
  logLevel: 'error'
});
```

### 2. Search for Specific Patterns

```javascript
viewer.startStream('pocket_indexer_service', {
  tail: 500,
  follow: true,
  filter: 'database|connection|timeout'
});
```

### 3. Time-bounded Log Retrieval

```javascript
viewer.startStream('pocket_indexer_api', {
  tail: 0,
  follow: false,
  since: '2024-01-01T00:00:00Z',
  until: '2024-01-01T12:00:00Z'
});
```

## Container Names Reference

Based on `docker-compose.yml`, the following containers are available:

- `pocket_indexer_redis` - Redis service
- `pocket_indexer_postgres` - PostgreSQL database
- `pocket_indexer_api` - API server
- `pocket_indexer_service` - Indexer service
- `pocket_proof_parser` - Proof parser service (if enabled)

## Troubleshooting

### Docker Socket Not Accessible

If you get "Docker service is not available" error:

1. Check Docker is running: `docker ps`
2. Check socket permissions: `ls -l /var/run/docker.sock`
3. Set `DOCKER_HOST` environment variable if using TCP connection

### WebSocket Connection Fails

1. Verify API server is running on the correct port
2. Check firewall settings
3. Ensure WebSocket path is correct: `/api/v1/logs/stream`
4. Check browser console for connection errors

### Logs Not Appearing

1. Verify container is running: `docker ps`
2. Check container has logs: `docker logs <container-id>`
3. Verify filters are not too restrictive
4. Check WebSocket connection is established

## API Version

Current API version: `v1`

Base URL: `http://localhost:3006/api/v1`

WebSocket URL: `ws://localhost:3006/api/v1/logs/stream`

