FROM node:20

WORKDIR /app




# Copy package files for both backend and frontend dependencies
COPY backend/package*.json ./backend/
COPY frontend/package*.json ./frontend/

# Install backend dependencies
WORKDIR /app/backend
RUN npm ci --only=production

# Install frontend dependencies and build
WORKDIR /app/frontend
RUN npm ci
COPY frontend/ .
RUN npm run build

# Go back to root and copy backend code
WORKDIR /app
COPY backend/ ./backend/

# Copy built frontend to backend's public directory
RUN mkdir -p ./backend/public && cp -r ./frontend/dist/* ./backend/public/

ENV NODE_ENV=production

# Set working directory to backend
WORKDIR /app/backend

# Expose ports
EXPOSE 3000 1883

# Start the server
CMD ["node", "server.js"]