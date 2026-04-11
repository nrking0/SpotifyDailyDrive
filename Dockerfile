# Production build for Daily Drive
FROM node:24-slim

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies
RUN npm ci --omit=dev

# Copy application code (but not sensitive config/tokens)
COPY index.js setup.js ./

# Copy entrypoint script
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

ENTRYPOINT ["./entrypoint.sh"]
