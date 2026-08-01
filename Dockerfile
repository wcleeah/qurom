FROM oven/bun:1

WORKDIR /app

# OpenCode CLI for in-container agent provider
RUN bun install -g opencode-ai \
  && opencode --version

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

ENV VIEW_HOST=0.0.0.0
ENV VIEW_PORT=3000
ENV PORT=3000
ENV OPENCODE_DIRECTORY=/app
ENV QUORUM_WORKSPACE_DIRECTORY=/app
ENV QUORUM_DATA_DIR=/data
ENV OPENCODE_BASE_URL=http://127.0.0.1:4096
ENV QUORUM_OPENCODE_BOOTSTRAP=seed

EXPOSE 3000

# Direct Bun process so Railway SIGTERM reaches the app (not a package-manager wrapper).
# --admin enables shipped-defaults editor (gated externally by Cloudflare Zero Trust).
CMD ["bun", "src/view-server.ts", "--admin"]
