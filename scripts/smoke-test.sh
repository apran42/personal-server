#!/usr/bin/env sh

set -eu

REPO_DIR="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
TEST_DIRECTORY="$(mktemp -d)"
LOG_FILE="$TEST_DIRECTORY/server.log"
TEST_NAS="$TEST_DIRECTORY/nas"
TEST_DATABASE="$TEST_DIRECTORY/server.db"
SERVER_PID=""

mkdir -p "$TEST_NAS"

cleanup() {
    if [ -n "$SERVER_PID" ]; then
        kill "$SERVER_PID" 2>/dev/null || true
        wait "$SERVER_PID" 2>/dev/null || true
    fi

    if [ -n "${TEST_DIRECTORY:-}" ] &&
        [ -d "$TEST_DIRECTORY" ]; then
        rm -rf -- "$TEST_DIRECTORY"
    fi
}

trap cleanup EXIT INT TERM

cd "$REPO_DIR"

SERVER_USERNAME="ci-user" \
    SERVER_PASSWORD="ci-password" \
    HOST="127.0.0.1" \
    PORT="18000" \
    NAS_ROOT="$TEST_NAS" \
    DATABASE_PATH="$TEST_DATABASE" \
    node server.js >"$LOG_FILE" 2>&1 &

SERVER_PID="$!"

run_nas_api_tests() {
    BASE_URL="http://127.0.0.1:18000"
    AUTHENTICATION="ci-user:ci-password"

    UPLOAD_FILE="$TEST_DIRECTORY/ci-upload.txt"
    DOWNLOAD_FILE="$TEST_DIRECTORY/ci-download.txt"

    printf 'NAS API test\n' >"$UPLOAD_FILE"

    curl -fs \
        -u "$AUTHENTICATION" \
        -H "Content-Type: application/json" \
        -d '{"path":"","name":"CI Test"}' \
        "$BASE_URL/nas/folder" \
        >/dev/null

    curl -fs \
        -u "$AUTHENTICATION" \
        -F "files=@$UPLOAD_FILE;filename=ci-upload.txt" \
        "$BASE_URL/nas/upload?dir=CI%20Test" \
        >/dev/null

    SEARCH_RESPONSE="$(
        curl -fs \
            -u "$AUTHENTICATION" \
            "$BASE_URL/nas/search?q=ci-upload"
    )"

    printf '%s' "$SEARCH_RESPONSE" |
        grep -q '"name":"ci-upload.txt"'

    curl -fs \
        -u "$AUTHENTICATION" \
        --output "$DOWNLOAD_FILE" \
        "$BASE_URL/nas/download?path=CI%20Test%2Fci-upload.txt"

    cmp "$UPLOAD_FILE" "$DOWNLOAD_FILE"

    curl -fs \
        -u "$AUTHENTICATION" \
        -X PATCH \
        -H "Content-Type: application/json" \
        -d '{
          "path":"CI Test/ci-upload.txt",
          "name":"ci-renamed.txt"
        }' \
        "$BASE_URL/nas/entry" \
        >/dev/null

    curl -fs \
        -u "$AUTHENTICATION" \
        -H "Content-Type: application/json" \
        -d '{"path":"","name":"CI Destination"}' \
        "$BASE_URL/nas/folder" \
        >/dev/null

    curl -fs \
        -u "$AUTHENTICATION" \
        -H "Content-Type: application/json" \
        -d '{
          "path":"CI Test/ci-renamed.txt",
          "destination":"CI Destination"
        }' \
        "$BASE_URL/nas/move" \
        >/dev/null

    TRASH_RESPONSE="$(
        curl -fs \
            -u "$AUTHENTICATION" \
            -X DELETE \
            -G \
            --data-urlencode \
            "path=CI Destination/ci-renamed.txt" \
            "$BASE_URL/nas/entry"
    )"

    TRASH_ID="$(
        node -e '
          const item = JSON.parse(process.argv[1]);
          process.stdout.write(item.id);
        ' "$TRASH_RESPONSE"
    )"

    curl -fs \
        -u "$AUTHENTICATION" \
        "$BASE_URL/nas/trash" |
        grep -q "$TRASH_ID"

    printf '{"id":"%s"}' "$TRASH_ID" |
        curl -fs \
            -u "$AUTHENTICATION" \
            -H "Content-Type: application/json" \
            --data-binary @- \
            "$BASE_URL/nas/trash/restore" \
            >/dev/null

    curl -fs \
        -u "$AUTHENTICATION" \
        --output "$DOWNLOAD_FILE" \
        "$BASE_URL/nas/download?path=CI%20Destination%2Fci-renamed.txt"

    cmp "$UPLOAD_FILE" "$DOWNLOAD_FILE"

    DELETE_RESPONSE="$(
        curl -fs \
            -u "$AUTHENTICATION" \
            -X DELETE \
            -G \
            --data-urlencode \
            "path=CI Destination/ci-renamed.txt" \
            "$BASE_URL/nas/entry"
    )"

    DELETE_ID="$(
        node -e '
          const item = JSON.parse(process.argv[1]);
          process.stdout.write(item.id);
        ' "$DELETE_RESPONSE"
    )"

    curl -fs \
        -u "$AUTHENTICATION" \
        -X DELETE \
        "$BASE_URL/nas/trash/$DELETE_ID"

    if curl -fs \
        -u "$AUTHENTICATION" \
        "$BASE_URL/nas/trash" |
        grep -q "$DELETE_ID"; then
        echo "Permanent deletion test failed."
        exit 1
    fi

    echo "NAS API test passed."
}

run_resource_api_tests() {
    BASE_URL="http://127.0.0.1:18000"
    AUTHENTICATION="ci-user:ci-password"
    RESOURCE_DIRECTORY="$TEST_NAS/Resource Test"
    RESOURCE_FILE="$RESOURCE_DIRECTORY/lecture.pdf"

    mkdir -p "$RESOURCE_DIRECTORY"
    printf 'Resource archive test\n' >"$RESOURCE_FILE"

    CREATE_RESPONSE="$(
        curl -fs \
            -u "$AUTHENTICATION" \
            -H "Content-Type: application/json" \
            -d '{
              "filePath":"Resource Test/lecture.pdf",
              "displayName":"Linux server lecture",
              "category":"Operating Systems",
              "semester":"2026-2",
              "tags":["linux","server"],
              "description":"Resource archive API test"
            }' \
            "$BASE_URL/resources"
    )"

    printf '%s' "$CREATE_RESPONSE" |
        grep -q '"file_path":"Resource Test/lecture.pdf"'

    printf '%s' "$CREATE_RESPONSE" |
        grep -q '"tags":\["linux","server"\]'

    RESOURCE_ID="$(
        node -e '
          const resource = JSON.parse(process.argv[1]);
          process.stdout.write(String(resource.id));
        ' "$CREATE_RESPONSE"
    )"

    LIST_RESPONSE="$(
        curl -fs \
            -u "$AUTHENTICATION" \
            "$BASE_URL/resources"
    )"

    printf '%s' "$LIST_RESPONSE" |
        grep -q "\"id\":$RESOURCE_ID"

    UPDATE_RESPONSE="$(
        curl -fs \
            -u "$AUTHENTICATION" \
            -X PATCH \
            -H "Content-Type: application/json" \
            -d '{
            "displayName":"Updated Linux lecture",
            "category":"System Server Operations",
            "tags":["linux","server","ubuntu"],
            "description":"Updated resource metadata"
            }' \
            "$BASE_URL/resources/$RESOURCE_ID"
    )"

    printf '%s' "$UPDATE_RESPONSE" |
        grep -q '"display_name":"Updated Linux lecture"'

    printf '%s' "$UPDATE_RESPONSE" |
        grep -q '"category":"System Server Operations"'

    printf '%s' "$UPDATE_RESPONSE" |
        grep -q '"tags":\["linux","server","ubuntu"\]'

    FILTER_RESPONSE="$(
        curl -fs \
            -u "$AUTHENTICATION" \
            -G \
            --data-urlencode "q=ubuntu" \
            --data-urlencode "category=System Server Operations" \
            --data-urlencode "semester=2026-2" \
            "$BASE_URL/resources"
    )"

    FILTERED_ID="$(
        node -e '
        const result = JSON.parse(process.argv[1]);

        if (result.resources.length !== 1) {
            process.exit(1);
        }

        process.stdout.write(String(result.resources[0].id));
        ' "$FILTER_RESPONSE"
    )"

    if [ "$FILTERED_ID" != "$RESOURCE_ID" ]; then
        echo "Resource filter returned the wrong resource."
        exit 1
    fi

    EMPTY_FILTER_RESPONSE="$(
        curl -fs \
            -u "$AUTHENTICATION" \
            -G \
            --data-urlencode "q=does-not-exist" \
            "$BASE_URL/resources"
    )"

    node -e '
    const result = JSON.parse(process.argv[1]);

    if (result.resources.length !== 0) {
        process.exit(1);
    }
    ' "$EMPTY_FILTER_RESPONSE"

    DUPLICATE_STATUS="$(
        curl \
            --silent \
            --output /dev/null \
            --write-out '%{http_code}' \
            -u "$AUTHENTICATION" \
            -H "Content-Type: application/json" \
            -d '{
              "filePath":"Resource Test/lecture.pdf",
              "displayName":"Duplicate resource"
            }' \
            "$BASE_URL/resources"
    )"

    if [ "$DUPLICATE_STATUS" != "409" ]; then
        echo "Expected 409 for duplicate resource, got $DUPLICATE_STATUS."
        exit 1
    fi
    DELETE_RESPONSE="$(
        curl -fs \
            -u "$AUTHENTICATION" \
            -X DELETE \
            "$BASE_URL/resources/$RESOURCE_ID"
    )"

    printf '%s' "$DELETE_RESPONSE" |
        grep -q '"deleted":true'

    printf '%s' "$DELETE_RESPONSE" |
        grep -q '"file_deleted":false'

    if [ ! -f "$RESOURCE_FILE" ]; then
        echo "Resource deletion removed the NAS file."
        exit 1
    fi

    AFTER_DELETE_RESPONSE="$(
        curl -fs \
            -u "$AUTHENTICATION" \
            "$BASE_URL/resources"
    )"

    node -e '
    const result = JSON.parse(process.argv[1]);
    const deletedId = Number(process.argv[2]);

    if (result.resources.some((resource) => resource.id === deletedId)) {
        process.exit(1);
    }
    ' "$AFTER_DELETE_RESPONSE" "$RESOURCE_ID"

    SECOND_DELETE_STATUS="$(
        curl \
            --silent \
            --output /dev/null \
            --write-out '%{http_code}' \
            -u "$AUTHENTICATION" \
            -X DELETE \
            "$BASE_URL/resources/$RESOURCE_ID"
    )"

    if [ "$SECOND_DELETE_STATUS" != "404" ]; then
        echo "Expected 404 after resource deletion, got $SECOND_DELETE_STATUS."
        exit 1
    fi
    echo "Resource API test passed."
}

run_authentication_limit_test() {
    BASE_URL="http://127.0.0.1:18000"
    ATTEMPT_NUMBER=1

    while [ "$ATTEMPT_NUMBER" -le 9 ]; do
        STATUS_CODE="$(
            curl \
                --silent \
                --output /dev/null \
                --write-out '%{http_code}' \
                -u "ci-user:wrong-password" \
                "$BASE_URL/health"
        )"

        if [ "$STATUS_CODE" != "401" ]; then
            echo \
                "Expected 401 on attempt $ATTEMPT_NUMBER, got $STATUS_CODE."
            exit 1
        fi

        ATTEMPT_NUMBER=$((ATTEMPT_NUMBER + 1))
    done

    STATUS_CODE="$(
        curl \
            --silent \
            --output /dev/null \
            --write-out '%{http_code}' \
            -u "ci-user:wrong-password" \
            "$BASE_URL/health"
    )"

    if [ "$STATUS_CODE" != "429" ]; then
        echo \
            "Expected 429 on attempt 10, got $STATUS_CODE."
        exit 1
    fi

    echo "Authentication rate limit test passed."
}

ATTEMPT=1

while [ "$ATTEMPT" -le 15 ]; do
    if RESPONSE="$(
        curl -fs \
            -u "ci-user:ci-password" \
            "http://127.0.0.1:18000/health"
    )"; then
        echo "$RESPONSE" | grep -q '"status":"ok"'
        echo "Smoke test passed: $RESPONSE"
        run_nas_api_tests
        run_resource_api_tests
        run_authentication_limit_test
        exit 0
    fi

    sleep 1
    ATTEMPT=$((ATTEMPT + 1))
done

echo "Server did not become healthy."
cat "$LOG_FILE"
exit 1
