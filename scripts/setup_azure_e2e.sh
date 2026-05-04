#!/usr/bin/env bash
# One-shot Azure setup for natures-understory E2E.
#
# Run this AS YOURSELF (Clark), not as the Cowork SP — needs Entra
# admin to create the new app registration.
#
# Prereqs: az CLI installed; you have already run `az login` interactively
# with your cmaine@ycconsulting.biz account.

set -euo pipefail

SUB="4c8cb21c-80d2-4a5b-8e78-bb3d63dd9e12"   # Pay-As-You-Go
RG="ycc-general"
WS_NAME="natures-understory-tests"
WS_ID="1a88742e-ea29-49a4-8ff4-8e7664036e9d"
STORAGE="pwstrgyccgeneral5b0f"
APP_NAME="natures-understory-github"
GH_REPO="DataHippo93/natures-understory"

echo "=== current account ==="
az account show --query "{name:name,id:id}" -o table

echo "=== ensure subscription ==="
az account set --subscription "$SUB"

echo "=== 1. Create app registration ==="
APP_ID=$(az ad app create --display-name "$APP_NAME" --sign-in-audience AzureADMyOrg --query appId -o tsv)
echo "appId: $APP_ID"

echo "=== 2. Create service principal ==="
SP_ID=$(az ad sp create --id "$APP_ID" --query id -o tsv)
echo "spObjectId: $SP_ID"

echo "=== 3. Add federated credentials for GitHub OIDC ==="
# One per environment / branch — production environment for now.
cat > /tmp/fic_prod.json <<JSON
{
  "name": "natures-understory-github-prod",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:${GH_REPO}:environment:production",
  "description": "natures-understory production environment",
  "audiences": ["api://AzureADTokenExchange"]
}
JSON
az ad app federated-credential create --id "$APP_ID" --parameters /tmp/fic_prod.json

# Also allow PR runs (needed if you want PR builds to authenticate)
cat > /tmp/fic_pr.json <<JSON
{
  "name": "natures-understory-github-pr",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:${GH_REPO}:pull_request",
  "description": "natures-understory pull-request runs",
  "audiences": ["api://AzureADTokenExchange"]
}
JSON
az ad app federated-credential create --id "$APP_ID" --parameters /tmp/fic_pr.json

echo "=== 4. Role assignments ==="
echo "  - Contributor on Playwright Workspace"
az role assignment create --assignee "$APP_ID" --role Contributor \
  --scope "/subscriptions/${SUB}/resourceGroups/${RG}/providers/Microsoft.LoadTestService/playwrightworkspaces/${WS_NAME}"

echo "  - Storage Blob Data Contributor on shared trace storage"
az role assignment create --assignee "$APP_ID" --role "Storage Blob Data Contributor" \
  --scope "/subscriptions/${SUB}/resourceGroups/${RG}/providers/Microsoft.Storage/storageAccounts/${STORAGE}"

echo
echo "=== DONE. Values for GitHub Environment 'production': ==="
echo "  AZURE_CLIENT_ID         = $APP_ID"
echo "  AZURE_TENANT_ID         = 7df011e1-eb7e-46bc-b4f8-9ea223936cc6"
echo "  AZURE_SUBSCRIPTION_ID   = $SUB"
echo "  PLAYWRIGHT_SERVICE_URL  = wss://eastus.api.playwright.microsoft.com/playwrightworkspaces/${WS_ID}/browsers"
echo
echo "Next: add those + the Supabase + e2e user secrets to the GitHub"
echo "Environment 'production', then trigger:"
echo "  gh workflow run e2e-azure.yml --ref chore/azure-e2e-setup"
