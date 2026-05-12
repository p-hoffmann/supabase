#!/usr/bin/env bash
set -Eeuo pipefail

# usage: file_env VAR [DEFAULT]
#    ie: file_env 'XYZ_DB_PASSWORD' 'example'
# (will allow for "$XYZ_DB_PASSWORD_FILE" to fill in the value of
#  "$XYZ_DB_PASSWORD" from a file, especially for Docker's secrets feature)
file_env() {
	local var="$1"
	local fileVar="${var}_FILE"
	local def="${2:-}"
	if [ "${!var:-}" ] && [ "${!fileVar:-}" ]; then
		echo >&2 "error: both $var and $fileVar are set (but are exclusive)"
		exit 1
	fi
	local val="$def"
	if [ "${!var:-}" ]; then
		val="${!var}"
	elif [ "${!fileVar:-}" ]; then
		val="$(< "${!fileVar}")"
	fi
	export "$var"="$val"
	unset "$fileVar"
}

# load secrets either from environment variables or files
file_env 'POSTGRES_PASSWORD'
file_env 'SUPABASE_ANON_KEY'
file_env 'SUPABASE_SERVICE_KEY'

# trex integration: when the anon/service keys aren't provided via env, read
# them out of trex.setting (Postgres). Trex auto-generates these at startup.
if [ -z "${SUPABASE_ANON_KEY:-}" ] || [ -z "${SUPABASE_SERVICE_KEY:-}" ]; then
  if [ -f /app/apps/studio/fetch-trex-keys.cjs ]; then
    echo "[entrypoint] fetching SUPABASE_*_KEY from trex.setting..." >&2
    KEY_LINES=$(node /app/apps/studio/fetch-trex-keys.cjs 2>&1 || true)
    if [ -n "$KEY_LINES" ]; then
      while IFS= read -r line; do
        case "$line" in
          SUPABASE_ANON_KEY=*) export SUPABASE_ANON_KEY="${line#SUPABASE_ANON_KEY=}" ;;
          SUPABASE_SERVICE_KEY=*) export SUPABASE_SERVICE_KEY="${line#SUPABASE_SERVICE_KEY=}" ;;
          *) echo "$line" >&2 ;;
        esac
      done <<EOF
$KEY_LINES
EOF
      echo "[entrypoint] keys populated (anon=${SUPABASE_ANON_KEY:+set}, service=${SUPABASE_SERVICE_KEY:+set})" >&2
    fi
  fi
fi

exec "${@}"
