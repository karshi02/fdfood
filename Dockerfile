FROM php:8.3-apache
# production php.ini: errors go to the log, never to the page
RUN docker-php-ext-install pdo_mysql \
 && cp "$PHP_INI_DIR/php.ini-production" "$PHP_INI_DIR/php.ini" \
 && printf 'date.timezone=Asia/Bangkok\nexpose_php=Off\n' > "$PHP_INI_DIR/conf.d/app.ini" \
 && printf 'ServerTokens Prod\nServerSignature Off\n' > /etc/apache2/conf-enabled/zz-hide-version.conf
ENV TZ=Asia/Bangkok
