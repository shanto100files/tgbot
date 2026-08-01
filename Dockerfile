FROM node:20-slim

RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install vega providers
RUN git clone --depth 1 https://github.com/vega-org/vega-providers.git _providers
RUN cd _providers && npm install && npm run build

# Install server dependencies
COPY package.json .
RUN npm install

# Copy server files
COPY . .

# Create logs dir
RUN mkdir -p logs

EXPOSE 3000

CMD ["npm", "start"]
