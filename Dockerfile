# One image, two processes.
#
# The collector and the gateway are the same build with different entrypoints:
# they share every line of the archive and the codec, and shipping them apart
# would be shipping two copies of one program that have to agree byte for byte
# about how a square is written.
#
# The database is not in here. It is TimescaleDB, it keeps the one thing this
# project cannot recreate, and a recording that lives inside an application
# image is a recording that a rebuild throws away.

FROM node:22-alpine AS build
WORKDIR /app

# The lockfile alone first, so a change to the source does not refetch the
# dependency tree on every build.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

# Never root: the process reads a socket and writes to one database, and needs
# nothing on this filesystem it did not arrive with.
USER node

# The gateway, because it is the half that answers a browser. The collector is
# the same image told to run the other file, which is what compose does.
CMD ["node", "dist/server/main.js"]
