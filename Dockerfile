FROM node:lts-trixie-slim AS build

# Create app directory
WORKDIR /app

# Install f3d binary and dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl ca-certificates libxcursor1 ffmpeg && \
    curl -L -s -o /tmp/f3d.deb https://github.com/f3d-app/f3d/releases/download/v3.2.0/F3D-3.2.0-Linux-x86_64-raytracing.deb && \
    apt-get install -y /tmp/f3d.deb && \
    apt-get install -f -y && \
    rm /tmp/f3d.deb && \
    rm -rf /var/lib/apt/lists/*

# Get app dependencies
COPY ./package*.json ./
RUN npm ci --omit=dev

# Get code
COPY ./resources ./resources
COPY ./tsconfig.json ./
COPY ./src ./src

# Run
CMD [ "npx", "tsx", "./src/index.ts" ]