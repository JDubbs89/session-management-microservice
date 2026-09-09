FROM postgres:16

# Bundle initialization scripts so host permissions and SELinux bind-mount
# labels cannot prevent the postgres user from reading them.
COPY init.sql /docker-entrypoint-initdb.d/init.sql
COPY tables/ /docker-entrypoint-initdb.d/tables/
COPY procedures/ /docker-entrypoint-initdb.d/procedures/
RUN chmod -R a+rX /docker-entrypoint-initdb.d
