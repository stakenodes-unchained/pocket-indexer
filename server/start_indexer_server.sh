#!/bin/bash

# Wait for database to be ready
echo "Waiting for database to be ready..."
until pg_isready -h $DB_HOST -p $DB_PORT -U $DB_USER; do
  echo "Database is not ready yet. Waiting..."
  sleep 2
done

echo "Database is ready!"

# Run migrations
echo "Running database migrations..."
node migrate.js

# Start the application
echo "Starting the application..."
# Set Node.js memory limit - use NODE_HEAP_SIZE_MB if set, otherwise default to 32GB
NODE_HEAP_SIZE_MB=${NODE_HEAP_SIZE_MB:-32768}
export NODE_OPTIONS="--max-old-space-size=${NODE_HEAP_SIZE_MB}"
echo "Node.js heap size limit: ${NODE_HEAP_SIZE_MB}MB"
node indexer-server.js 