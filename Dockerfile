FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p /app/logs /app/data \
	&& touch /app/leads.csv \
	&& chmod 775 /app/logs /app/data /app/leads.csv

ENV NODE_ENV=production
EXPOSE 3000

CMD ["npm", "start"]
