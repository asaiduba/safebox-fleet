FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

ENV NODE_ENV=production
ENV MQTT_BROKER=${MQTT_BROKER:-wss://safebox.onrender.com}

EXPOSE 1883

CMD ["node", "index.js"]
