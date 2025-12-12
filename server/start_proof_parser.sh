#!/bin/sh

# Start script for proof parser service

echo "Starting proof parser service..."

# Default to all chains if no argument provided
CHAINS=${1:-"--all-chains"}

# Set Node.js memory limit (8GB) to prevent heap out of memory errors
export NODE_OPTIONS="--max-old-space-size=8192"
node proof-parser-server.js $CHAINS

