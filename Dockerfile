FROM oven/bun:1.3.3

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

ENV HOST=0.0.0.0
EXPOSE 3000

CMD ["sh", "-c", "bunx vite preview --host 0.0.0.0 --port ${PORT:-3000}"]
