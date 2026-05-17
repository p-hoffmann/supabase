// Constants specific to self-hosted environments

// Schemas exposed via PostgREST Data API, read from the PGRST_DB_SCHEMAS env var
// that is passed to the Studio container via docker-compose / CLI.
export const DEFAULT_EXPOSED_SCHEMAS =
  process.env.PGRST_DB_SCHEMAS ?? 'public,storage,graphql_public'

// Trex deviation from upstream Supabase: PG_META_CRYPTO_KEY is required.
// In the trex stack the trex-init container derives it from TREX_ROOT_KEY
// and writes it to ./secrets/derived.env, which the Studio service consumes
// via env_file. A missing value would silently fall back to a hardcoded
// 'SAMPLE_KEY' upstream — refuse to start instead.
const _PG_META_CRYPTO_KEY = process.env.PG_META_CRYPTO_KEY
if (!_PG_META_CRYPTO_KEY) {
  throw new Error(
    'PG_META_CRYPTO_KEY is required. The trex-init container sets it via ' +
      './secrets/derived.env; ensure that env_file is mounted on the studio service.',
  )
}
export const ENCRYPTION_KEY = _PG_META_CRYPTO_KEY
export const POSTGRES_PORT = parseInt(process.env.POSTGRES_PORT || '5432', 10)
export const POSTGRES_HOST = process.env.POSTGRES_HOST || 'db'
export const POSTGRES_DATABASE = process.env.POSTGRES_DB || 'postgres'
export const POSTGRES_PASSWORD = process.env.POSTGRES_PASSWORD || 'postgres'
export const POSTGRES_USER_READ_WRITE = process.env.POSTGRES_USER_READ_WRITE || 'supabase_admin'
export const POSTGRES_USER_READ_ONLY =
  process.env.POSTGRES_USER_READ_ONLY || 'supabase_read_only_user'
