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
# Set Node.js memory limit (8GB) to prevent heap out of memory errors
export NODE_OPTIONS="--max-old-space-size=8192"
node indexer-server.js 