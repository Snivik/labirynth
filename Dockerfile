FROM oven/bun:1.3-slim

WORKDIR /app

# only devDependencies exist (types + tsc), so production installs nothing and
# the runtime transpiles the TypeScript itself
COPY package.json bun.lock* ./
RUN bun install --production

COPY . .

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["bun", "src/server/index.ts"]
