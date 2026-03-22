# ---------- build ----------
FROM node:18-alpine AS build

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# ---------- production ----------
FROM nginx:alpine

# Устанавливаем wget для healthcheck
RUN apk add --no-cache wget

# Копируем собранное приложение
COPY --from=build /app/build /usr/share/nginx/html

# Копируем конфигурацию nginx
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Проверяем, что index.html существует
RUN test -f /usr/share/nginx/html/index.html || (echo "ERROR: index.html not found!" && exit 1)

EXPOSE 80

# Проверяем конфигурацию nginx (только синтаксис, без запуска)
RUN nginx -t || (echo "ERROR: nginx configuration is invalid!" && exit 1)

CMD ["nginx", "-g", "daemon off;"]
