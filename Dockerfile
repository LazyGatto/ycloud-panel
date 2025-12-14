FROM node:18-alpine AS base
WORKDIR /app
COPY package*.json ./
RUN npm ci --legacy-peer-deps
COPY . .
RUN npm run build:web

EXPOSE 3000
CMD ["npm", "run", "start:web"]
