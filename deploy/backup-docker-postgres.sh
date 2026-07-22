#!/usr/bin/env bash
set -euo pipefail

container="${POSTGRES_CONTAINER:-perumnet-enterprise-postgres}"
database="${POSTGRES_DATABASE:-perumnet_enterprise}"
database_user="${POSTGRES_USER:-perumnet_enterprise}"
backup_dir="${BACKUP_DIR:-${HOME}/backups/perumnet-enterprise}"
upload_dir="${UPLOAD_DIR:-${HOME}/data/perumnet-enterprise/uploads}"
retention_days="${BACKUP_RETENTION_DAYS:-14}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
database_temporary="${backup_dir}/.database-${timestamp}.dump.tmp"
database_backup="${backup_dir}/database-${timestamp}.dump"
uploads_temporary="${backup_dir}/.uploads-${timestamp}.tar.gz.tmp"
uploads_backup="${backup_dir}/uploads-${timestamp}.tar.gz"

umask 077
install -d -m 700 "$backup_dir"

docker inspect "$container" >/dev/null
docker exec "$container" pg_isready --username="$database_user" --dbname="$database" >/dev/null
docker exec "$container" pg_dump \
  --username="$database_user" \
  --dbname="$database" \
  --format=custom > "$database_temporary"
mv "$database_temporary" "$database_backup"

if [ -d "$upload_dir" ]; then
  tar -C "$upload_dir" -czf "$uploads_temporary" .
  mv "$uploads_temporary" "$uploads_backup"
fi

find "$backup_dir" -type f \( -name 'database-*.dump' -o -name 'uploads-*.tar.gz' \) \
  -mtime "+$retention_days" -delete
