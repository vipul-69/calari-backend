# Use Bun official image
FROM oven/bun:latest

# Set working directory
WORKDIR /app

# Copy project files
COPY . .

# Install dependencies
RUN bun install

# Expose port
EXPOSE 8080

# Start the server
CMD ["bun", "run", "index.js"]
