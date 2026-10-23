#!/bin/sh
# Brings the database schema up to date, then starts the server.
set -e
node node_modules/prisma/build/index.js migrate deploy --schema prisma/schema.prisma
exec node server.js
