FROM node:22-slim
# Fonts for the headless browser. The flyer's own fonts (Telugu included) are web fonts loaded from
# Google Fonts; these are the offline fallback so Telugu never renders as empty boxes.
RUN apt-get update && apt-get install -y --no-install-recommends fonts-noto-core fontconfig \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev
COPY . .
ENV PORT=8080
EXPOSE 8080
CMD ["node","server.js"]
