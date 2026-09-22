#!/bin/bash
# markvee.org deployment script
# Run this on your local machine after cloning the repo

set -e

GITHUB_USER="mvlabsbiz"
GITHUB_REPO="markvee.org"
GITHUB_TOKEN="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"
GIT_EMAIL="mv@markvee.org"
GIT_NAME="MVLabs Admin"

echo "=== Setting up markvee.org deployment ==="

# 1. Configure git
echo "1. Configuring git..."
git config --global user.name "$GIT_NAME"
git config --global user.email "$GIT_EMAIL"
git config --global credential.helper store

# 2. Initialize local repo
echo "2. Initializing git repo..."
git init
git add .
git commit -m "Initial commit: markvee.org homepage"

# 3. Add remote
echo "3. Adding GitHub remote..."
git remote add origin "https://github.com/$GITHUB_USER/$GITHUB_REPO.git"
git branch -M main

# 4. Store credentials
echo "4. Storing git credentials..."
echo "https://$GITHUB_USER:$GITHUB_TOKEN@github.com" | git credential approve

# 5. Create repo if it doesn't exist (via API)
echo "5. Creating GitHub repository..."
curl -s -X POST \
  -H "Authorization: token $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github.v3+json" \
  "https://api.github.com/user/repos" \
  -d "{
    \"name\": \"$GITHUB_REPO\",
    \"description\": \"markvee.org - Personal homepage with streaming dashboard\",
    \"private\": false,
    \"auto_init\": false
  }" > /dev/null 2>&1 || echo "  (repo may already exist)"

# 6. Push to GitHub
echo "6. Pushing to GitHub..."
git push -u origin main

echo ""
echo "✓ Deployment complete!"
echo ""
echo "Repository: https://github.com/$GITHUB_USER/$GITHUB_REPO"
echo "Vercel will auto-deploy on push. Check: https://vercel.com/dashboard"
