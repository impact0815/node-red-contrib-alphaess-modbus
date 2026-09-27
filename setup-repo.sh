#!/usr/bin/env bash
# Prepares the project for GitHub: fills in placeholders, creates the git
# repository with a first commit and - if the GitHub CLI is installed and
# logged in - creates the GitHub repository and pushes.
#
#   ./setup-repo.sh <github-user> "<Your Name>" <email>
set -euo pipefail

if [ $# -ne 3 ]; then
	echo "usage: $0 <github-user> \"<Your Name>\" <email>" >&2
	exit 1
fi
GH_USER="$1"; AUTHOR="$2"; EMAIL="$3"
REPO="node-red-contrib-alphaess-modbus"
cd "$(dirname "$0")"

# placeholders
sed -i.bak \
	-e "s|YOUR-GITHUB-USER|${GH_USER}|g" \
	-e "s|YOUR NAME <you@example.com>|${AUTHOR} <${EMAIL}>|g" package.json
sed -i.bak -e "s|YOUR NAME|${AUTHOR}|g" LICENSE
rm -f package.json.bak LICENSE.bak
if grep -q "YOUR" package.json LICENSE; then
	echo "placeholders left in package.json/LICENSE – please check" >&2
	exit 1
fi

# git
if [ ! -d .git ]; then
	git init -q -b main
fi
git config user.name >/dev/null || git config user.name "$AUTHOR"
git config user.email >/dev/null || git config user.email "$EMAIL"
git add -A
git commit -q -m "Initial version 0.1.0" || echo "nothing to commit"
echo "git repository ready (branch main)"

# GitHub
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
	gh repo create "${GH_USER}/${REPO}" --public --source . --remote origin --push \
		--description "Local Modbus TCP access to Alpha ESS storage systems for Node-RED"
	gh repo edit "${GH_USER}/${REPO}" --add-topic node-red --add-topic alpha-ess --add-topic modbus \
		--add-topic photovoltaic --add-topic mqtt || true
	echo "done: https://github.com/${GH_USER}/${REPO}"
else
	cat <<MSG

GitHub CLI not available or not logged in. Next steps:
  1. Create an EMPTY repository "${REPO}" at https://github.com/new
     (no README, no license, no .gitignore)
  2. Then run:
     git remote add origin https://github.com/${GH_USER}/${REPO}.git
     git push -u origin main
MSG
fi
