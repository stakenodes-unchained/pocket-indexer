const Docker = require('dockerode');
const fs = require('fs');

class DockerService {
  constructor() {
    // Try to connect to Docker socket
    // When running in a container, we MUST use the mounted Unix socket
    // TCP connections to 127.0.0.1 won't work in containers (would connect to container's localhost, not host)
    let dockerOptions = {};
    this.connectionType = 'none';
    
    // Priority 1: Check for Docker socket at standard location (works when mounted in container)
    const socketPath = '/var/run/docker.sock';
    if (fs.existsSync(socketPath)) {
      try {
        // Verify socket is accessible and is actually a socket
        const stats = fs.statSync(socketPath);
        if (stats.isSocket()) {
          dockerOptions = {
            socketPath: socketPath
          };
          this.connectionType = 'socket';
          console.log('Found Docker socket at /var/run/docker.sock');
        } else {
          console.warn('Path /var/run/docker.sock exists but is not a socket');
        }
      } catch (error) {
        console.warn('Docker socket exists but may not be accessible:', error.message);
        console.warn('Check socket permissions. In containers, ensure it is mounted: -v /var/run/docker.sock:/var/run/docker.sock:ro');
      }
    } else {
      console.warn('Docker socket not found at /var/run/docker.sock');
    }
    
    // Priority 2: Check DOCKER_HOST environment variable (for custom socket paths)
    // NOTE: We explicitly avoid TCP connections when running in containers
    if (this.connectionType === 'none' && process.env.DOCKER_HOST) {
      const dockerHost = process.env.DOCKER_HOST;
      
      if (dockerHost.startsWith('unix://')) {
        // Unix socket path from DOCKER_HOST
        const customSocketPath = dockerHost.replace('unix://', '');
        if (fs.existsSync(customSocketPath)) {
          dockerOptions = {
            socketPath: customSocketPath
          };
          this.connectionType = 'socket';
          console.log(`Using Docker socket from DOCKER_HOST: ${customSocketPath}`);
        }
      } else if (dockerHost.startsWith('tcp://')) {
        // TCP connection - WARNING: This won't work in containers unless pointing to host IP
        const url = new URL(dockerHost);
        // Check if it's trying to use localhost/127.0.0.1 (won't work in containers)
        if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
          console.error('ERROR: DOCKER_HOST is set to TCP with localhost/127.0.0.1');
          console.error('This will NOT work in containers. Use Unix socket instead.');
          console.error('Remove DOCKER_HOST or set it to unix:///var/run/docker.sock');
          this.connectionType = 'none';
        } else {
          // Only allow TCP if it's explicitly set to a non-localhost address
          dockerOptions = {
            host: url.hostname,
            port: parseInt(url.port) || 2375
          };
          this.connectionType = 'tcp';
          console.warn('Using TCP connection to Docker at', `${url.hostname}:${url.port}`);
          console.warn('This is not recommended for containers. Use Unix socket instead.');
        }
      }
    }

    // Initialize Docker client
    try {
      if (this.connectionType !== 'none') {
        this.docker = new Docker(dockerOptions);
        this.connected = true;
        const connectionInfo = this.connectionType === 'socket' 
          ? dockerOptions.socketPath 
          : `${dockerOptions.host}:${dockerOptions.port}`;
        console.log(`✅ Docker client initialized via ${this.connectionType} at ${connectionInfo}`);
      } else {
        this.connected = false;
        this.docker = null;
        console.error('❌ Docker service not available');
        console.error('Possible solutions:');
        console.error('  1. If running in a container, mount the socket: -v /var/run/docker.sock:/var/run/docker.sock:ro');
        console.error('  2. Check that /var/run/docker.sock exists and is accessible');
        console.error('  3. Remove DOCKER_HOST if it points to tcp://localhost or tcp://127.0.0.1');
      }
    } catch (error) {
      console.error('Failed to initialize Docker client:', error.message);
      this.connected = false;
      this.docker = null;
    }
  }

  /**
   * Check if Docker service is available
   */
  isAvailable() {
    return this.connected && this.docker !== null;
  }

  /**
   * List all containers (running and stopped)
   */
  async listContainers(all = true) {
    if (!this.isAvailable()) {
      const errorMsg = this.connectionType === 'none' 
        ? 'Docker service is not available. Make sure Docker socket is mounted at /var/run/docker.sock or set DOCKER_HOST environment variable.'
        : 'Docker service is not available';
      throw new Error(errorMsg);
    }

    try {
      const containers = await this.docker.listContainers({ all });
      return containers.map(container => ({
        id: container.Id,
        name: container.Names[0]?.replace(/^\//, '') || container.Id.substring(0, 12),
        image: container.Image,
        status: container.Status,
        state: container.State,
        created: container.Created,
        ports: container.Ports
      }));
    } catch (error) {
      console.error('Error listing containers:', error);
      // Provide more helpful error messages
      if (error.code === 'ECONNREFUSED') {
        throw new Error(`Failed to connect to Docker daemon. ${this.connectionType === 'tcp' ? 'Docker daemon may not be listening on TCP port, or use Unix socket instead.' : 'Make sure Docker socket is mounted at /var/run/docker.sock'}`);
      }
      throw new Error(`Failed to list containers: ${error.message}`);
    }
  }

  /**
   * Get container by ID or name
   */
  getContainer(containerId) {
    if (!this.isAvailable()) {
      throw new Error('Docker service is not available');
    }

    try {
      return this.docker.getContainer(containerId);
    } catch (error) {
      throw new Error(`Failed to get container ${containerId}: ${error.message}`);
    }
  }

  /**
   * Get container metadata
   */
  async getContainerInfo(containerId) {
    if (!this.isAvailable()) {
      throw new Error('Docker service is not available');
    }

    try {
      const container = this.getContainer(containerId);
      const inspect = await container.inspect();
      
      return {
        id: inspect.Id,
        name: inspect.Name.replace(/^\//, ''),
        image: inspect.Config.Image,
        state: inspect.State.Status,
        startedAt: inspect.State.StartedAt,
        finishedAt: inspect.State.FinishedAt,
        restartCount: inspect.RestartCount,
        platform: inspect.Platform,
        env: inspect.Config.Env || []
      };
    } catch (error) {
      if (error.statusCode === 404) {
        throw new Error(`Container ${containerId} not found`);
      }
      throw new Error(`Failed to get container info: ${error.message}`);
    }
  }

  /**
   * Stream logs from a container
   * @param {string} containerId - Container ID or name
   * @param {Object} options - Log options
   * @param {number} options.tail - Number of lines to fetch initially
   * @param {boolean} options.follow - Stream new logs
   * @param {string} options.since - Start from timestamp (ISO 8601)
   * @param {string} options.until - End timestamp (ISO 8601)
   * @param {boolean} options.timestamps - Include timestamps
   * @param {Function} onData - Callback for log data
   * @param {Function} onError - Callback for errors
   * @returns {Promise<Object>} Stream object with stop method
   */
  async streamLogs(containerId, options = {}, onData, onError) {
    if (!this.isAvailable()) {
      throw new Error('Docker service is not available');
    }

    try {
      const container = this.getContainer(containerId);
      
      const logOptions = {
        stdout: true,
        stderr: true,
        timestamps: options.timestamps !== false, // Default to true
        tail: options.tail || 0,
        follow: options.follow !== false, // Default to true
        since: options.since ? Math.floor(new Date(options.since).getTime() / 1000) : undefined,
        until: options.until ? Math.floor(new Date(options.until).getTime() / 1000) : undefined
      };

      const logStream = await container.logs(logOptions);

      let buffer = '';
      let isStopped = false;

      logStream.on('data', (chunk) => {
        if (isStopped) return;
        
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        lines.forEach(line => {
          if (line.trim()) {
            try {
              const parsed = this.parseLogLine(line);
              if (parsed) {
                onData(parsed);
              }
            } catch (error) {
              console.error('Error parsing log line:', error);
            }
          }
        });
      });

      logStream.on('end', () => {
        if (!isStopped && onData) {
          onData({ type: 'end', message: 'Log stream ended' });
        }
      });

      logStream.on('error', (error) => {
        if (!isStopped && onError) {
          onError(error);
        }
      });

      return {
        stop: () => {
          isStopped = true;
          if (logStream && typeof logStream.destroy === 'function') {
            logStream.destroy();
          }
        },
        stream: logStream
      };
    } catch (error) {
      if (error.statusCode === 404) {
        throw new Error(`Container ${containerId} not found`);
      }
      throw new Error(`Failed to stream logs: ${error.message}`);
    }
  }

  /**
   * Get historical logs (non-streaming)
   * @param {string} containerId - Container ID or name
   * @param {Object} options - Log options
   * @returns {Promise<Array>} Array of log entries
   */
  async getLogs(containerId, options = {}) {
    if (!this.isAvailable()) {
      throw new Error('Docker service is not available');
    }

    try {
      const container = this.getContainer(containerId);
      
      const logOptions = {
        stdout: true,
        stderr: true,
        timestamps: true,
        tail: options.tail || 100,
        since: options.since ? Math.floor(new Date(options.since).getTime() / 1000) : undefined,
        until: options.until ? Math.floor(new Date(options.until).getTime() / 1000) : undefined
      };

      const logs = await container.logs(logOptions);
      const logString = logs.toString('utf8');
      const lines = logString.split('\n').filter(line => line.trim());

      return lines.map(line => this.parseLogLine(line)).filter(log => log !== null);
    } catch (error) {
      if (error.statusCode === 404) {
        throw new Error(`Container ${containerId} not found`);
      }
      throw new Error(`Failed to get logs: ${error.message}`);
    }
  }

  /**
   * Parse Docker log line
   * Docker json-file driver format: {"log":"message","stream":"stdout","time":"2024-01-01T12:00:00.123456789Z"}
   */
  parseLogLine(line) {
    try {
      // Try to parse as JSON (json-file driver format)
      const parsed = JSON.parse(line);
      if (parsed.log && parsed.time) {
        return {
          timestamp: parsed.time,
          stream: parsed.stream || 'stdout',
          message: parsed.log.replace(/\n$/, ''), // Remove trailing newline
          level: this.detectLogLevel(parsed.log)
        };
      }
    } catch (e) {
      // Not JSON format, treat as plain text
      // Try to extract timestamp if present
      const timestampMatch = line.match(/^(\d{4}-\d{2}-\d{2}T[\d:\.]+Z)\s+(.*)$/);
      if (timestampMatch) {
        return {
          timestamp: timestampMatch[1],
          stream: 'stdout',
          message: timestampMatch[2],
          level: this.detectLogLevel(timestampMatch[2])
        };
      }
      
      // Plain log line without timestamp
      return {
        timestamp: new Date().toISOString(),
        stream: 'stdout',
        message: line,
        level: this.detectLogLevel(line)
      };
    }
    return null;
  }

  /**
   * Detect log level from message
   */
  detectLogLevel(message) {
    const lowerMessage = message.toLowerCase();
    if (lowerMessage.includes('error') || lowerMessage.includes('fatal') || lowerMessage.includes('exception')) {
      return 'error';
    }
    if (lowerMessage.includes('warn') || lowerMessage.includes('warning')) {
      return 'warn';
    }
    if (lowerMessage.includes('debug') || lowerMessage.includes('trace')) {
      return 'debug';
    }
    return 'info';
  }

  /**
   * Filter logs based on criteria
   */
  filterLogs(logs, filters = {}) {
    return logs.filter(log => {
      // Time range filter
      if (filters.since) {
        const sinceTime = new Date(filters.since).getTime();
        const logTime = new Date(log.timestamp).getTime();
        if (logTime < sinceTime) return false;
      }
      if (filters.until) {
        const untilTime = new Date(filters.until).getTime();
        const logTime = new Date(log.timestamp).getTime();
        if (logTime > untilTime) return false;
      }

      // Log level filter
      if (filters.logLevel) {
        const levels = ['debug', 'info', 'warn', 'error'];
        const filterLevelIndex = levels.indexOf(filters.logLevel.toLowerCase());
        const logLevelIndex = levels.indexOf(log.level);
        if (logLevelIndex < filterLevelIndex) return false;
      }

      // Regex filter
      if (filters.filter) {
        try {
          const regex = new RegExp(filters.filter, 'i');
          if (!regex.test(log.message)) return false;
        } catch (e) {
          // Invalid regex, skip filter
        }
      }

      // Search term filter
      if (filters.search) {
        const searchLower = filters.search.toLowerCase();
        if (!log.message.toLowerCase().includes(searchLower)) return false;
      }

      return true;
    });
  }
}

// Export singleton instance
module.exports = new DockerService();

