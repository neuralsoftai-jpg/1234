FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Build the frontend (dist)
RUN npm run build

# Hugging Face Spaces exposes port 7860 by default
ENV PORT=7860
ENV NODE_ENV=production

EXPOSE 7860

# Start server
CMD ["node", "server.js"]
