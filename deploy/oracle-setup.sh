#!/usr/bin/env bash
# One-time setup of an Oracle Cloud instance to serve Silent Contract with nginx.
# Run on the instance as the user CI will deploy with (opc on Oracle Linux, ubuntu on Ubuntu):
#   curl -fsSL https://raw.githubusercontent.com/diyorbekabdulaxatov/secret-contract/main/deploy/oracle-setup.sh | bash
# Safe to run again.
set -euo pipefail

SITE_DIR=/var/www/silent-contract
CONF_URL=https://raw.githubusercontent.com/diyorbekabdulaxatov/secret-contract/main/deploy/nginx-silent-contract.conf
DEPLOY_USER=$(id -un)

echo "==> Installing nginx and rsync"
if command -v apt-get >/dev/null 2>&1; then
  sudo apt-get update -y
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y nginx rsync curl
  CONF_PATH=/etc/nginx/sites-available/silent-contract
  sudo curl -fsSL "$CONF_URL" -o "$CONF_PATH"
  sudo ln -sf "$CONF_PATH" /etc/nginx/sites-enabled/silent-contract
  sudo rm -f /etc/nginx/sites-enabled/default
elif command -v dnf >/dev/null 2>&1; then
  sudo dnf install -y nginx rsync curl
  CONF_PATH=/etc/nginx/conf.d/silent-contract.conf
  sudo curl -fsSL "$CONF_URL" -o "$CONF_PATH"
  # The stock nginx.conf on Oracle Linux has its own default_server on port 80; drop that flag there.
  sudo sed -i 's/listen\(.*\)80 default_server;/listen\180;/' /etc/nginx/nginx.conf
else
  echo "Unsupported OS: need apt-get (Ubuntu) or dnf (Oracle Linux)." >&2
  exit 1
fi

echo "==> Creating $SITE_DIR owned by $DEPLOY_USER"
sudo mkdir -p "$SITE_DIR"
sudo chown -R "$DEPLOY_USER":"$DEPLOY_USER" "$SITE_DIR"
if [ ! -f "$SITE_DIR/index.html" ]; then
  echo '<!doctype html><title>Silent Contract</title><p>Waiting for the first deploy.</p>' > "$SITE_DIR/index.html"
fi

if command -v getenforce >/dev/null 2>&1 && [ "$(getenforce)" != "Disabled" ]; then
  echo "==> Labelling $SITE_DIR for SELinux"
  sudo semanage fcontext -a -t httpd_sys_content_t "$SITE_DIR(/.*)?" 2>/dev/null || true
  sudo restorecon -R "$SITE_DIR" || sudo chcon -R -t httpd_sys_content_t "$SITE_DIR"
fi

echo "==> Opening port 80 in the instance firewall"
if command -v firewall-cmd >/dev/null 2>&1 && sudo firewall-cmd --state >/dev/null 2>&1; then
  sudo firewall-cmd --permanent --add-service=http
  sudo firewall-cmd --reload
elif command -v iptables >/dev/null 2>&1; then
  # Oracle's Ubuntu images ship an iptables REJECT rule; allow HTTP before it.
  # Its position varies between images, so drop any old HTTP rule and insert right above the REJECT.
  while sudo iptables -D INPUT -p tcp --dport 80 -m state --state NEW -j ACCEPT 2>/dev/null; do :; done
  REJECT_AT=$(sudo iptables -L INPUT -n --line-numbers | awk '$2 == "REJECT" { print $1; exit }')
  if [ -n "$REJECT_AT" ]; then
    sudo iptables -I INPUT "$REJECT_AT" -p tcp --dport 80 -m state --state NEW -j ACCEPT
  else
    sudo iptables -A INPUT -p tcp --dport 80 -m state --state NEW -j ACCEPT
  fi
  if command -v netfilter-persistent >/dev/null 2>&1; then sudo netfilter-persistent save; fi
fi

echo "==> Starting nginx"
sudo nginx -t
sudo systemctl enable --now nginx
sudo systemctl reload nginx

echo
echo "Done. nginx serves $SITE_DIR on port 80."
echo "Remaining step in the Oracle Cloud console: add an ingress rule for TCP port 80"
echo "(source 0.0.0.0/0) to the security list or network security group of this instance's subnet."
