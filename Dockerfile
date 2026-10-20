FROM php:8.3-apache
RUN docker-php-ext-install pdo_mysql \
 && echo "date.timezone=Asia/Bangkok" > /usr/local/etc/php/conf.d/tz.ini
ENV TZ=Asia/Bangkok
