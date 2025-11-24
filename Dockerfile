FROM node:20

WORKDIR /app

# Copy all source code first
COPY backend/ ./backend/
COPY frontend/ ./frontend/

# Install backend dependencies
WORKDIR /app/backend
RUN npm install --only=production

# Install frontend dependencies and build
WORKDIR /app/frontend
RUN npm install --legacy-peer-deps
RUN npm run build

# Copy built frontend to backend's public directory
WORKDIR /app
RUN mkdir -p ./backend/public && cp -r ./frontend/dist/* ./backend/public/

ENV NODE_ENV=production

# Set working directory to backend
WORKDIR /app/backend

# Expose ports
EXPOSE 3000 1883

# Start the server
CMD ["node", "server.js"]