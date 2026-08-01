# PerumNet Mailcow branding

Mailcow supports update-persistent CSS overrides through:

`data/web/css/build/0081-custom-mailcow.css`

The PerumNet login theme is scoped to pages containing Mailcow's
`#login_user` field. It does not replace the login form, authentication
handlers, CSRF token, FIDO2/WebAuthn controls, language selector, dark-mode
switch, or password-recovery routes.

The production CMS now generates and deploys the active theme through a
restricted SSH forced command. The deployer only accepts a signed-shape JSON
manifest containing the three exact destinations below:

- `data/web/css/build/0081-custom-mailcow.css`
- `data/web/img/perumnet-mail-brand.png`
- `data/web/favicon.png`

`TITLE_NAME` and `MAIN_NAME` are updated through Mailcow's Redis container so
the browser and accessible native heading match the CMS configuration.

## One-time restricted deployer setup

1. On the Enterprise application server, create a dedicated Ed25519 key and a
   separate `known_hosts` file. Store both outside the repository with mode
   `0600`.
2. Copy only the public key and this `deploy/mailcow` directory to the Mailcow
   host.
3. On the Mailcow host run:

   `sudo ./install-branding-deployer.sh 'ssh-ed25519 AAAA... mailcow-branding'`

The installer creates `mailcow-branding`, locks password login, applies
`restrict` plus a forced command to its authorized key, and grants sudo only
for `/usr/local/sbin/perumnet-mail-branding-deploy`. It does not grant a shell,
port forwarding, PTY, or general Docker access.

Production application variables:

- `MAIL_BRANDING_MODE=ssh`
- `MAIL_BRANDING_SSH_TARGET=mailcow-branding@perumnet-mail`
- `MAIL_BRANDING_SSH_KEY_PATH=/absolute/secret/key/path`
- `MAIL_BRANDING_KNOWN_HOSTS_PATH=/absolute/known_hosts/path`

Demo must use `MAIL_BRANDING_MODE=capture`. A production save stages the CSS,
logo, favicon, and Redis labels; backs up the previous state; verifies checksums
and the public login; then automatically restores the backup on failure.

After deployment, confirm `/`, `/admin`, `/domainadmin`, and `/reset-password`
still use Mailcow's existing handlers. Test desktop, tablet, and mobile
viewports, keyboard focus, dark mode, language selection, invalid credentials,
and the forgot-password link.
