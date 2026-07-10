FROM node:20-alpine

WORKDIR /app

COPY package.json ./
COPY server.js ./server.js
COPY lib ./lib
COPY public ./public
COPY .env.example ./.env.example
COPY outputs/.gitkeep ./outputs/.gitkeep

ENV NODE_ENV=production
ENV PORT=4173

EXPOSE 4173

CMD ["npm", "start"]
