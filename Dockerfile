# The servers as an image: compiled when the image is built, so a container starts the executable
# itself (~40 ms) and holds only it. The build stage has Bun, the dependencies and the source; the
# image that runs has the two executables, each with Bun's runtime and the PWA inside
# (scripts/builds.ts), and nothing else. Railway builds it for both services (.railway/railway.ts);
# anyone can run it themselves (docs/self-hosting.md).
#
#   docker build -t scratchpad .
#   docker run -p 7777:7777 -v scratchpad:/data -e PAD_TOKEN=<token> scratchpad
#   docker run -p 7778:7778 -e PAD_URL=<the API> -e PAD_TOKEN=<token> scratchpad /app/pad-mcp

# The Bun this project is developed and tested with.
FROM oven/bun:1.4.4 AS build
WORKDIR /src
COPY package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile
COPY tsconfig.json ./
COPY scripts scripts
COPY public public
COPY src src
RUN bun scripts/build.ts server && bun scripts/build.ts mcp

# The same Debian the build stage is, so the executables find the C library they were linked
# against. A shell stays, for a platform that runs the start command through one.
FROM debian:bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /src/dist/pad-server /src/dist/pad-mcp ./
# Every interface, as a container must; the server still refuses to listen so without PAD_TOKEN.
# The port is PAD_PORT, else the platform's PORT, else 7777, so neither is set here.
ENV NODE_ENV=production PAD_HOST=0.0.0.0 PAD_DB=/data/pad.db
EXPOSE 7777
CMD ["/app/pad-server"]
