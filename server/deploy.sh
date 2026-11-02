#!/usr/bin/env bash
# Deploy the Polymates API to Cloud Run.
#
# One instance holds the order books in memory and snapshots state to GCS, so the
# service is pinned to exactly one instance with CPU always on (scripts and the
# house market maker run on timers). Roughly $40-50/month at 1 vCPU / 1 GiB.
set -euo pipefail

PROJECT="${PROJECT:-$(gcloud config get-value project 2>/dev/null)}"
REGION="${REGION:-us-east1}"
SERVICE="${SERVICE:-polymates-api}"
BUCKET="${BUCKET:-polymates-state-${PROJECT}}"

cd "$(dirname "$0")"

if ! gcloud storage buckets describe "gs://${BUCKET}" --project "$PROJECT" >/dev/null 2>&1; then
  gcloud storage buckets create "gs://${BUCKET}" --project "$PROJECT" --location "$REGION" --uniform-bucket-level-access
fi

gcloud run deploy "$SERVICE" \
  --source . \
  --project "$PROJECT" \
  --region "$REGION" \
  --allow-unauthenticated \
  --min-instances 1 --max-instances 1 \
  --no-cpu-throttling --cpu 1 --memory 1Gi \
  --timeout 3600 \
  --set-env-vars "STATE_BUCKET=${BUCKET}" \
  --quiet

URL="$(gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" --format 'value(status.url)')"
echo
echo "API: $URL"
echo "Set it for the website:  gh variable set POLYMATES_API_URL --body \"$URL\" --repo acashmoney-aura/polymates"
