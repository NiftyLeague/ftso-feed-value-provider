#!/bin/bash

# FTSO Feed Value Provider - Run from Registry
# This script pulls and runs the latest image from GitHub Container Registry

set -e

echo "🐳 FTSO Feed Value Provider - Registry Deployment"
echo "=================================================="
echo ""

# Configuration
REGISTRY="ghcr.io"
IMAGE_NAME="niftyleague/ftso-feed-value-provider"
TAG="${1:-latest}"
CONTAINER_NAME="ftso-provider"
API_PORT="3101"
METRICS_PORT="9090"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if already logged in
echo "🔐 Checking authentication..."
if ! docker info 2>/dev/null | grep -q "Username"; then
    echo -e "${YELLOW}⚠️  Not logged in to Docker registry${NC}"
    echo ""
    echo "To authenticate with GHCR:"
    echo "1. Create a Personal Access Token at: https://github.com/settings/tokens"
    echo "2. Select scope: read:packages"
    echo "3. Run: echo \"YOUR_TOKEN\" | docker login ghcr.io -u YOUR_USERNAME --password-stdin"
    echo ""
    read -p "Press Enter to continue if you're already logged in, or Ctrl+C to exit..."
fi

# Pull the image
echo ""
echo "📥 Pulling image from registry..."
echo "Image: ${REGISTRY}/${IMAGE_NAME}:${TAG}"
docker pull "${REGISTRY}/${IMAGE_NAME}:${TAG}"

# Check if container already exists
if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo ""
    echo -e "${YELLOW}⚠️  Container '${CONTAINER_NAME}' already exists${NC}"
    read -p "Stop and remove it? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "🛑 Stopping and removing existing container..."
        docker stop "${CONTAINER_NAME}" 2>/dev/null || true
        docker rm "${CONTAINER_NAME}" 2>/dev/null || true
    else
        echo "❌ Aborted"
        exit 1
    fi
fi

# Run the container
echo ""
echo "🚀 Starting container..."
docker run -d \
    --name "${CONTAINER_NAME}" \
    --publish "${API_PORT}:3101" \
    --publish "${METRICS_PORT}:9090" \
    --restart unless-stopped \
    "${REGISTRY}/${IMAGE_NAME}:${TAG}"

# Wait for container to start
echo ""
echo "⏳ Waiting for container to start..."
sleep 5

# Check if container is running
if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo -e "${GREEN}✅ Container started successfully!${NC}"
    echo ""
    echo "📊 Container Status:"
    docker ps --filter "name=${CONTAINER_NAME}" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
    echo ""
    echo "🌐 Service URLs:"
    echo "   • API:     http://localhost:${API_PORT}"
    echo "   • Health:  http://localhost:${API_PORT}/health"
    echo "   • Metrics: http://localhost:${METRICS_PORT}/metrics"
    echo ""
    echo "📝 Useful Commands:"
    echo "   • View logs:    docker logs -f ${CONTAINER_NAME}"
    echo "   • Stop:         docker stop ${CONTAINER_NAME}"
    echo "   • Restart:      docker restart ${CONTAINER_NAME}"
    echo "   • Remove:       docker rm -f ${CONTAINER_NAME}"
    echo ""
    echo "🧪 Test the API:"
    echo "   curl -X POST http://localhost:${API_PORT}/feed-values \\"
    echo "     -H \"Content-Type: application/json\" \\"
    echo "     -d '{\"feeds\":[{\"category\":1,\"name\":\"BTC/USD\"}]}'"
else
    echo -e "${RED}❌ Container failed to start${NC}"
    echo ""
    echo "📋 Container logs:"
    docker logs "${CONTAINER_NAME}"
    exit 1
fi
