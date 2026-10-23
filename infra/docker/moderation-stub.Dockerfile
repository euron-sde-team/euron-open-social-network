# syntax=docker/dockerfile:1.7
# Fake moderation provider for local development and the test matrix
# (MODERATION_PROVIDER=stub). A single dependency-free script, port 5099. The health
# check only needs the server to answer HTTP, whatever the path returns.
#   docker build -f infra/docker/moderation-stub.Dockerfile -t open-social-moderation-stub .
FROM node:22.23.4-alpine
ENV NODE_ENV=production PORT=5099
WORKDIR /app
COPY --chown=node:node apps/moderation-stub/ ./
USER node
EXPOSE 5099
HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=10 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5099)+'/').then(()=>process.exit(0)).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
