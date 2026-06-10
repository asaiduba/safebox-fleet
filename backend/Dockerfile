FROM node:18-alpine

# Install build dependencies for native C++ extensions (needed for better-sqlite3)
RUN apk add --no-cache python3 make g++ gcc

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application code
COPY . .

# Expose HTTP port (3000) and TCP Telematics Ingestion port (5000)
EXPOSE 3000 5000

# Start the server
CMD ["node", "server.js"]
