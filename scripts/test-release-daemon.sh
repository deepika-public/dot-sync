#!/bin/sh
# Explicit cross-project integration, used only when CI variables request it.
set -eu
: "${DEEPIKA_SYNC_PROJECT_ID:?Set the numeric GitLab project ID of deepika-sync}"
: "${DEEPIKA_SYNC_RELEASE_TAG:?Set the exact deepika-sync release tag, e.g. v0.1.0}"
: "${CI_API_V4_URL:?GitLab API URL is required}"
: "${CI_JOB_TOKEN:?GitLab job token is required}"
case "$DEEPIKA_SYNC_PROJECT_ID" in ''|*[!0-9]*) echo 'Invalid DEEPIKA_SYNC_PROJECT_ID' >&2; exit 1;; esac
printf '%s\n' "$DEEPIKA_SYNC_RELEASE_TAG" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$'
TEST_RELEASE_DIR=$(mktemp -d)
trap 'rm -rf "$TEST_RELEASE_DIR"' EXIT HUP INT TERM
ARCHIVE="deepika-sync-${DEEPIKA_SYNC_RELEASE_TAG}-x86_64-unknown-linux-gnu.tar.gz"
PACKAGE_URL="$CI_API_V4_URL/projects/$DEEPIKA_SYNC_PROJECT_ID/packages/generic/deepika-sync/$DEEPIKA_SYNC_RELEASE_TAG"
for file in "$ARCHIVE" SHA256SUMS; do
  curl --fail-with-body --location --silent --show-error --header "JOB-TOKEN: $CI_JOB_TOKEN" \
    "$PACKAGE_URL/$file" --output "$TEST_RELEASE_DIR/$file" || {
    printf 'Cannot download %s for daemon release %s.\n' "$file" "$DEEPIKA_SYNC_RELEASE_TAG" >&2
    printf 'Check that this tag exists in the deepika-sync project and that its release job published the archive,\n' >&2
    printf 'or point the CI variable DEEPIKA_SYNC_RELEASE_TAG at a published release.\n' >&2
    exit 1
  }
done
(
  cd "$TEST_RELEASE_DIR"
  # Packaging emits exactly one checksum. Never accept a manifest for another file.
  awk -v archive="$ARCHIVE" 'NF != 2 || $2 != archive { exit 1 } END { if (NR != 1) exit 1 }' SHA256SUMS
  sha256sum --strict -c SHA256SUMS
)
tar -xzf "$TEST_RELEASE_DIR/$ARCHIVE" -C "$TEST_RELEASE_DIR"
export DEEPIKA_SYNC_BINARY="$TEST_RELEASE_DIR/deepika-sync-${DEEPIKA_SYNC_RELEASE_TAG}-x86_64-unknown-linux-gnu/deepika-sync"
ACTUAL_VERSION=$("$DEEPIKA_SYNC_BINARY" --version)
if [ "$ACTUAL_VERSION" != "deepika-sync ${DEEPIKA_SYNC_RELEASE_TAG#v}" ]; then
  printf 'Daemon version mismatch: expected %s, received %s\n' "$DEEPIKA_SYNC_RELEASE_TAG" "$ACTUAL_VERSION" >&2
  exit 1
fi
printf '%s\n' "$ACTUAL_VERSION"
# The plugin states the oldest daemon it can talk to. An older release is not a broken
# plugin: say so and leave with a code the pipeline reports as a warning, rather than
# let the tests time out waiting for a session file that release never writes.
MINIMUM=$(sed -n 's/^export const MINIMUM_DAEMON = \[\([0-9]*\), \([0-9]*\), \([0-9]*\)\].*/\1.\2.\3/p' src/session.ts)
[ -n "$MINIMUM" ] || { echo 'Cannot read MINIMUM_DAEMON from src/session.ts' >&2; exit 1; }
OLDEST=$(printf '%s\n%s\n' "$MINIMUM" "${DEEPIKA_SYNC_RELEASE_TAG#v}" | sort -V | head -n 1)
if [ "$OLDEST" != "$MINIMUM" ]; then
  printf 'SKIPPED: daemon release %s is older than the %s this plugin requires.\n' "$DEEPIKA_SYNC_RELEASE_TAG" "$MINIMUM" >&2
  printf 'Publish a compatible daemon and set the CI variable DEEPIKA_SYNC_RELEASE_TAG to its tag.\n' >&2
  exit 78
fi
npm run test:integration
