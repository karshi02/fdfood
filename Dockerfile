FROM php:8.3-apache
# production php.ini: errors go to the log, never to the page
RUN docker-php-ext-install pdo_mysql \
 && cp "$PHP_INI_DIR/php.ini-production" "$PHP_INI_DIR/php.ini" \
 && printf 'date.timezone=Asia/Bangkok\nexpose_php=Off\n' > "$PHP_INI_DIR/conf.d/app.ini" \
 && printf 'ServerTokens Prod\nServerSignature Off\n' > /etc/apache2/conf-enabled/zz-hide-version.conf

# Sessions live on a volume (see compose) so recreating the container doesn't log anyone out.
# 30 days idle before a session is collected; the cookie lifetime is set in api.php.
# realpath cache is short so a release switch (symlink swap) is picked up within a second.
RUN mkdir -p /var/lib/php/sessions && chown www-data:www-data /var/lib/php/sessions && chmod 1733 /var/lib/php/sessions \
 && printf 'session.save_path=/var/lib/php/sessions\nsession.gc_maxlifetime=2592000\nsession.gc_probability=1\nsession.gc_divisor=1000\nrealpath_cache_ttl=1\n' > "$PHP_INI_DIR/conf.d/session.ini"

# Document root is switchable: dev serves /var/www/html, prod serves releases/current (a symlink).
ENV APACHE_DOCUMENT_ROOT=/var/www/html
RUN sed -ri 's!/var/www/html!${APACHE_DOCUMENT_ROOT}!g' /etc/apache2/sites-available/*.conf \
 && printf '<Directory /var/www/releases/>\n  Options FollowSymLinks\n  AllowOverride None\n  Require all granted\n</Directory>\n' > /etc/apache2/conf-enabled/zz-releases.conf

ENV TZ=Asia/Bangkok
