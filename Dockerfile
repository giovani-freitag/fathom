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
# The migrations and the one script that applies them, so a database can be
# brought up to date by something that was handed this image and no checkout.
COPY database/migrations ./database/migrations
COPY scripts/migrate.mjs ./scripts/migrate.mjs

# The collector writes its log beside itself, and everything else here belongs
# to root. One directory it owns is the whole of what it needs to write.
RUN mkdir -p /app/logs && chown node:node /app/logs

# Never root: the process reads a socket and writes to one database, and needs
# nothing on this filesystem it did not arrive with.
USER node

# The gateway, because it is the half that answers a browser. The collector is
# the same image told to run the other file, which is what compose does.
CMD ["node", "dist/server/main.js"]

# One container that is the whole of Fathom: the database, the recording and
# the chart.
#
# The image above is a part — it needs a database beside it, which is what the
# compose file arranges. That is the right shape for anything that has to be
# backed up, upgraded and watched. It is the wrong shape for somebody who wants
# to see what this is: they should type one command and get a chart, the way
# `docker run` on a mail catcher gets a mailbox.
#
# Both go on shipping. This one is `latest`, because it is the tag somebody
# types without reading; the part is tagged `slim`, and the compose file names
# that one.
FROM timescale/timescaledb:latest-pg17 AS standalone

# The runtime the two processes need. The base is Alpine, and its own package
# is newer than the floor this project sets.
RUN apk add --no-cache nodejs

WORKDIR /app
COPY --from=runtime /app/node_modules ./node_modules
COPY --from=runtime /app/package.json ./package.json
COPY --from=runtime /app/dist ./dist
COPY --from=runtime /app/database/migrations ./database/migrations
COPY --from=runtime /app/scripts/migrate.mjs ./scripts/migrate.mjs
COPY docker-standalone-entrypoint.sh /usr/local/bin/fathom-standalone

# The collector writes its log beside itself.
RUN mkdir -p /app/logs && chown postgres:postgres /app/logs

# The chart. The database is deliberately not published: inside one container
# nothing else needs to reach it, and a Postgres on a laptop's network is not
# something this image should decide to open.
EXPOSE 8787

# The recording is the one thing here that cannot be made again, so the volume
# is declared rather than left to be remembered. Without `-v` it still runs,
# and what it recorded goes when the container does — which is the right
# default for looking, and the wrong one for keeping.
VOLUME ["/var/lib/postgresql/data"]

ENV PORT=8787
ENTRYPOINT ["/usr/local/bin/fathom-standalone"]
