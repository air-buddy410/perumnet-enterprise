#!/usr/bin/env bash
set -euo pipefail

if [ "${EUID}" -ne 0 ]; then
  echo "Jalankan sebagai root." >&2
  exit 1
fi

public_key="${1:-}"
if [[ ! "${public_key}" =~ ^ssh-ed25519\  ]]; then
  echo "Pemakaian: $0 'ssh-ed25519 AAAA... mailcow-branding'" >&2
  exit 1
fi

user_name="mailcow-branding"
home_dir="/home/${user_name}"
script_source="$(cd "$(dirname "$0")" && pwd)/mailcow-branding-deploy.py"
script_target="/usr/local/sbin/perumnet-mail-branding-deploy"

if ! id "${user_name}" >/dev/null 2>&1; then
  useradd --create-home --home-dir "${home_dir}" --shell /bin/bash "${user_name}"
fi
passwd --lock "${user_name}" >/dev/null 2>&1 || true

install -o root -g root -m 0755 "${script_source}" "${script_target}"
install -d -o root -g root -m 0700 /var/backups/perumnet-mail-branding
install -d -o "${user_name}" -g "${user_name}" -m 0700 "${home_dir}/.ssh"

forced_key="restrict,command=\"sudo -n ${script_target}\" ${public_key}"
printf '%s\n' "${forced_key}" > "${home_dir}/.ssh/authorized_keys"
chown "${user_name}:${user_name}" "${home_dir}/.ssh/authorized_keys"
chmod 0600 "${home_dir}/.ssh/authorized_keys"

cat > /etc/sudoers.d/perumnet-mail-branding <<EOF
${user_name} ALL=(root) NOPASSWD: ${script_target}
EOF
chmod 0440 /etc/sudoers.d/perumnet-mail-branding
visudo -cf /etc/sudoers.d/perumnet-mail-branding >/dev/null

echo "Restricted Mailcow branding deployer installed for ${user_name}."
