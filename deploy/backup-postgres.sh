#!/usr/bin/env bash
set -euo pipefail

backup_dir="/var/backups/perumnet-enterprise"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
temporary_file="${backup_dir}/.perumnet-enterprise-${timestamp}.dump.tmp"
backup_file="${backup_dir}/perumnet-enterprise-${timestamp}.dump"

umask 077
pg_dump --format=custom --dbname=perumnet_enterprise --file="$temporary_file"
mv "$temporary_file" "$backup_file"
find "$backup_dir" -type f -name 'perumnet-enterprise-*.dump' -mtime +14 -delete
