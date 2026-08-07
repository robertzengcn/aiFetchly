gh workflow run "Manual Local AI Runtime Release" \
  --repo robertzengcn/aiFetchly \
  --ref dev \
  -f release_tag=local-ai-runtime-v1.0.0 \
  -f runtime_version=1.0.0 \
  -f min_app_version=1.0.0 \
  -f publish_github_release=true