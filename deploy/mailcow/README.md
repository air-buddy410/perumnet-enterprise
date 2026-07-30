# PerumNet Mailcow branding

Mailcow supports update-persistent CSS overrides through:

`data/web/css/build/0081-custom-mailcow.css`

The PerumNet login theme is scoped to pages containing Mailcow's
`#login_user` field. It does not replace the login form, authentication
handlers, CSRF token, FIDO2/WebAuthn controls, language selector, dark-mode
switch, or password-recovery routes.

Required deployed assets:

- `data/web/css/build/0081-custom-mailcow.css`
- `data/web/img/perumnet-enterprise-brand.png`
- `data/web/favicon.png`

Set Mailcow's built-in UI texts to `PerumNet Enterprise Mail` for both
`TITLE_NAME` and `MAIN_NAME`. These values are maintained by Mailcow in Redis
and avoid replacing accessible template text with CSS-generated content.

After deployment, confirm `/`, `/admin`, and `/domainadmin` still post to
Mailcow's existing login handler. Test desktop, tablet, and mobile viewports,
keyboard focus, dark mode, language selection, invalid credentials, and the
forgot-password link.
