#!/bin/sh

# Start script for proof parser service

echo "Starting proof parser service..."

# Default to all chains if no argument provided
CHAINS=${1:-"--all-chains"}

node proof-parser-server.js $CHAINS

