FROM node:20-alpine

WORKDIR /app

# 安装依赖
COPY package.json package-lock.json* ./
RUN npm ci --prefer-offline

# 复制代码
COPY . .

# 设置 BACKEND_URL — Docker 内网用 backend 容器名
ENV BACKEND_URL=http://backend:8000

# 在构建前写入 .env.local
RUN echo "BACKEND_URL=http://backend:8000" > .env.local

# 构建生产版本
RUN npm run build

EXPOSE 3000

# 运行时也设置环境变量
ENV HOSTNAME=0.0.0.0
CMD ["npm", "start"]
