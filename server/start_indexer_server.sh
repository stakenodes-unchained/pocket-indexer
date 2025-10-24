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
node indexer-server.js 