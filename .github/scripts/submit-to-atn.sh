#!/usr/bin/env bash
# Submits an XPI as a new version of the existing listing on addons.thunderbird.net.
# Usage: submit-to-atn.sh <path-to-xpi>
# Requires ATN_JWT_ISSUER and ATN_JWT_SECRET in the environment.

set -euo pipefail

XPI=$1
API_URL=${ATN_API_URL:-https://addons.thunderbird.net/api/v4}
POLL_ATTEMPTS=30
POLL_SECONDS=10

ADDON_ID=$(jq -r '.browser_specific_settings.gecko.id | @uri' manifest.json)
VERSION=$(jq -r '.version' manifest.json)
VERSION_URL="$API_URL/addons/$ADDON_ID/versions/$VERSION/"

base64url() {
	openssl base64 -A | tr '+/' '-_' | tr -d '='
}

create_jwt() {
	local now header payload signature
	now=$(date +%s)
	header=$(printf '{"alg":"HS256","typ":"JWT"}' | base64url)
	payload=$(jq -cn \
		--arg iss "$ATN_JWT_ISSUER" \
		--arg jti "$(openssl rand -hex 16)" \
		--argjson iat "$now" \
		--argjson exp "$((now + 240))" \
		'{iss: $iss, jti: $jti, iat: $iat, exp: $exp}' | base64url)
	signature=$(printf '%s.%s' "$header" "$payload" \
		| openssl dgst -sha256 -hmac "$ATN_JWT_SECRET" -binary | base64url)
	printf '%s.%s.%s' "$header" "$payload" "$signature"
}

RESPONSE=$(mktemp)
trap 'rm -f "$RESPONSE"' EXIT

STATUS=$(curl --silent --show-error --globoff --request PUT \
	--header "Authorization: JWT $(create_jwt)" \
	--form "upload=@$XPI" \
	--form "channel=listed" \
	--output "$RESPONSE" \
	--write-out '%{http_code}' \
	"$VERSION_URL")

case "$STATUS" in
	202)
		;;
	409)
		echo "::notice::Version $VERSION is already on ATN, so nothing was submitted."
		exit 0
		;;
	201)
		echo "::error::ATN created a new add-on instead of updating the listing. Check the ID in manifest.json."
		exit 1
		;;
	*)
		echo "::error::ATN rejected the upload with HTTP $STATUS: $(jq -r '.error // .detail // "no details"' "$RESPONSE" 2>/dev/null || echo 'no details')"
		exit 1
		;;
esac

UPLOAD_ID=$(jq -r '.pk' "$RESPONSE")

for ((attempt = 1; attempt <= POLL_ATTEMPTS; attempt++)); do
	curl --fail --silent --show-error --globoff --retry 3 \
		--header "Authorization: JWT $(create_jwt)" \
		--output "$RESPONSE" \
		"${VERSION_URL}uploads/$UPLOAD_ID/"

	if jq -e '.processed == true' "$RESPONSE" >/dev/null; then
		if jq -e '.valid == true' "$RESPONSE" >/dev/null; then
			echo "::notice::Version $VERSION passed ATN validation and is waiting for review."
			exit 0
		fi

		echo "::error::ATN validation failed: $(jq -r '.validation_url' "$RESPONSE")"
		exit 1
	fi

	sleep "$POLL_SECONDS"
done

echo "::error::ATN did not finish validating version $VERSION in time. Check the listing, then re-run this workflow."
exit 1
