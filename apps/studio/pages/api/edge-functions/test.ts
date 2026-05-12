import { IS_PLATFORM } from 'common'
import { NextApiRequest, NextApiResponse } from 'next'

import { isValidEdgeFunctionURL } from '@/lib/api/edgeFunctions'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { method } = req

  switch (method) {
    case 'POST':
      return handlePost(req, res)
    default:
      return new Response(
        JSON.stringify({ data: null, error: { message: `Method ${method} Not Allowed` } }),
        {
          status: 405,
          headers: { 'Content-Type': 'application/json', Allow: 'POST' },
        }
      )
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { url: requestUrl, method, body: requestBody, headers: customHeaders } = req.body
    // In self-hosted mode the browser-side URL points at the public host
    // (e.g. http://localhost:8001) which isn't reachable from inside the
    // sidecar container. Rewrite both the origin AND ensure the SUPABASE_URL
    // base path (e.g. `/trex`) is present — Studio's frontend builds the
    // function URL without the base path in some flows.
    let url = requestUrl
    if (!IS_PLATFORM) {
      try {
        const u = new URL(requestUrl)
        const internal = new URL(process.env.SUPABASE_URL || '')
        u.protocol = internal.protocol
        u.host = internal.host
        const base = internal.pathname.replace(/\/$/, '')
        if (base && !u.pathname.startsWith(base + '/') && u.pathname !== base) {
          u.pathname = base + u.pathname
        }
        url = u.toString()
      } catch {
        url = requestUrl.replace(process.env.SUPABASE_PUBLIC_URL, process.env.SUPABASE_URL)
      }
    }

    const validEdgeFnUrl = isValidEdgeFunctionURL(url, IS_PLATFORM)

    if (!validEdgeFnUrl) {
      return res.status(400).json({
        status: 400,
        error: { message: 'Provided URL is not a valid Supabase edge function URL' },
      })
    }

    // Remove any undefined or null values from custom headers
    const sanitizedCustomHeaders = Object.entries(customHeaders || {}).reduce(
      (acc, [key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          acc[key] = value as string
        }
        return acc
      },
      {} as Record<string, string>
    )

    // Only use custom headers and ensure Content-Type is set.
    // Force identity encoding — trex sends gzip when Accept-Encoding allows
    // it, and Node's fetch can choke on the response in some paths.
    const requestHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept-Encoding': 'identity',
      ...sanitizedCustomHeaders,
    }

    // Use the test authorization header if provided
    if (sanitizedCustomHeaders['x-test-authorization']) {
      requestHeaders['Authorization'] = sanitizedCustomHeaders['x-test-authorization']
      // Remove the x-test-authorization header as we've moved it to Authorization
      delete requestHeaders['x-test-authorization']
    }

    // Prepare the request body based on method and Content-Type
    let finalBody = undefined
    if (method !== 'GET' && method !== 'HEAD') {
      if (requestHeaders['Content-Type'] === 'application/json') {
        finalBody = typeof requestBody === 'string' ? requestBody : JSON.stringify(requestBody)
      } else {
        finalBody = requestBody
      }
    }

    const response = await fetch(url, {
      method,
      headers: requestHeaders,
      body: finalBody,
      redirect: 'manual', // don't follow the redirect and return response as is
    })

    // Handle non-JSON responses
    let responseBody: string
    const contentType = response.headers.get('content-type')
    if (contentType?.includes('application/json')) {
      // If JSON, parse and stringify to ensure it's valid JSON
      const jsonBody = await response.json()
      responseBody = JSON.stringify(jsonBody)
    } else {
      // For non-JSON responses, get raw text
      responseBody = await response.text()
    }

    if (!response.ok) {
      // Try to parse error response if it's JSON
      try {
        const errorBody = JSON.parse(responseBody)

        return res.status(response.status).json({
          status: response.status,
          error: { message: errorBody?.error || 'Edge function returned an error' },
        })
      } catch (parseError) {
        // If not JSON, return the raw error
        return res.status(response.status).json({
          status: response.status,
          error: { message: responseBody || 'Edge function returned an error' },
        })
      }
    }

    const responseHeaders: Record<string, string> = {}
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value
    })

    return res.status(response.status).json({
      status: response.status,
      headers: responseHeaders,
      body: responseBody,
    })
  } catch (error: any) {
    return res.status(500).json({
      status: 500,
      error: {
        message: error.message || 'Failed to test edge function',
      },
    })
  }
}
