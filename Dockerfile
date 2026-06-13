FROM oven/bun:1.3.11

WORKDIR /app

# Copy package files
COPY package.json bun.lock ./

# Install dependencies
RUN bun install --production --frozen-lockfile

# Copy source code
COPY . .

USER bun

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD bun -e "fetch('http://localhost:3000/health')" || exit 1

# Run the app
CMD ["bun", "run", "index.ts"]
