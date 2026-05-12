import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { type NextApiRequest, type NextApiResponse } from 'next'

import apiWrapper from '@/lib/api/apiWrapper'
import { uuidv4 } from '@/lib/helpers'
import { assertSelfHosted } from '@/lib/api/self-hosted/util'

// Studio's deploy mutation sends a `multipart/form-data` body with a JSON
// `metadata` part and one or more `file` parts. Next.js' default body parser
// would consume the stream as text, breaking multipart — opt out. We do
// enforce a max total body size manually (see DEPLOY_MAX_BYTES below).
export const config = {
  api: { bodyParser: false, sizeLimit: false },
}

// Hard ceiling on a single deploy payload. Studio uploads source files
// (typically tens of KB); 50 MB leaves plenty of headroom for vendored
// dependencies while preventing a runaway upload from filling memory.
const DEPLOY_MAX_BYTES = 50 * 1024 * 1024

export default function handlerWithErrorCatching(req: NextApiRequest, res: NextApiResponse) {
  return apiWrapper(req, res, handler, { withAuth: true })
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    res.status(405).json({ data: null, error: { message: `Method ${req.method} Not Allowed` } })
    return
  }
  assertSelfHosted()

  const folder = process.env.EDGE_FUNCTIONS_MANAGEMENT_FOLDER
  if (!folder) {
    res.status(500).json({ error: { message: 'EDGE_FUNCTIONS_MANAGEMENT_FOLDER is not set' } })
    return
  }

  const slugParam = req.query.slug
  const slug = Array.isArray(slugParam) ? slugParam[0] : slugParam
  if (!slug || !/^[A-Za-z0-9_-]+$/.test(slug) || slug === 'main') {
    res.status(400).json({ error: { message: `Invalid 'slug' parameter` } })
    return
  }

  const targetDir = path.resolve(folder, slug)
  const folderResolved = path.resolve(folder)
  if (!targetDir.startsWith(folderResolved + path.sep)) {
    res.status(400).json({ error: { message: `Invalid 'slug' parameter` } })
    return
  }

  // Read the raw request stream and parse multipart via the Fetch API.
  const headers = new Headers()
  for (const [k, v] of Object.entries(req.headers)) {
    if (!v) continue
    headers.set(k, Array.isArray(v) ? v.join(', ') : String(v))
  }
  const chunks: Buffer[] = []
  let total = 0
  for await (const c of req) {
    const buf = c as Buffer
    total += buf.length
    if (total > DEPLOY_MAX_BYTES) {
      res.status(413).json({
        error: { message: `Deploy payload exceeds ${DEPLOY_MAX_BYTES} bytes` },
      })
      return
    }
    chunks.push(buf)
  }
  const body = Buffer.concat(chunks)
  let form: FormData
  try {
    form = await new Request('http://local/', { method: 'POST', headers, body }).formData()
  } catch (err: any) {
    res.status(400).json({ error: { message: `Failed to parse multipart body: ${err.message}` } })
    return
  }

  const files = form.getAll('file')
  if (files.length === 0) {
    res.status(400).json({ error: { message: `No 'file' parts in request` } })
    return
  }

  let metadata: { entrypoint_path?: string; import_map_path?: string } = {}
  const metadataPart = form.get('metadata')
  if (typeof metadataPart === 'string') {
    try { metadata = JSON.parse(metadataPart) } catch { /* keep defaults */ }
  }

  // Replace the function folder atomically(-ish): wipe + recreate.
  await rm(targetDir, { recursive: true, force: true })
  await mkdir(targetDir, { recursive: true })

  for (const f of files) {
    if (!(f instanceof Blob)) continue
    const filename = (f as File).name || 'index.ts'
    // Prevent path traversal — only allow simple relative paths.
    const safeRel = filename.replace(/^\/+/, '').replace(/\\/g, '/')
    if (safeRel.split('/').some((seg) => seg === '..' || seg === '')) {
      res.status(400).json({ error: { message: `Invalid filename: ${filename}` } })
      return
    }
    const absPath = path.resolve(targetDir, safeRel)
    if (!absPath.startsWith(targetDir + path.sep) && absPath !== targetDir) {
      res.status(400).json({ error: { message: `Invalid filename: ${filename}` } })
      return
    }
    await mkdir(path.dirname(absPath), { recursive: true })
    const buf = Buffer.from(await f.arrayBuffer())
    await writeFile(absPath, buf)
  }

  // Pick the entrypoint: caller-supplied or first file whose basename starts with "index"
  let entrypointAbs: string | undefined
  if (metadata.entrypoint_path) {
    const candidate = path.resolve(targetDir, metadata.entrypoint_path.replace(/^\/+/, ''))
    if (candidate.startsWith(targetDir)) entrypointAbs = candidate
  }
  if (!entrypointAbs) {
    const indexFile = (files as Blob[])
      .map((f) => (f instanceof Blob ? (f as File).name : ''))
      .find((n) => n && path.basename(n).startsWith('index'))
    if (indexFile) entrypointAbs = path.resolve(targetDir, indexFile)
  }
  if (!entrypointAbs) entrypointAbs = path.resolve(targetDir, 'index.ts')

  const now = Date.now()
  res.status(200).json({
    id: uuidv4(),
    slug,
    version: 1,
    name: slug,
    status: 'ACTIVE',
    entrypoint_path: pathToFileURL(entrypointAbs).href,
    created_at: now,
    updated_at: now,
  })
}
