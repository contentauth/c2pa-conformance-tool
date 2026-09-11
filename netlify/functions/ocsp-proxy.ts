import type { Config, Context } from '@netlify/functions'

export default async (req: Request, _context: Context): Promise<Response> => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, HEAD',
  }

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders })
  }

  const urlObj = new URL(req.url)
  let responderUrl: string | null = null
  if (req.url.includes('?url=')) {
    const rawParam = req.url.slice(req.url.indexOf('?url=') + 5)
    responderUrl = decodeURIComponent(rawParam.replace(/\+/g, '%2B'))
  } else {
    responderUrl = urlObj.searchParams.get('url') || req.headers.get('x-ocsp-responder-url')
  }

  if (!responderUrl) {
    return new Response(JSON.stringify({ error: 'Missing responder URL parameter (?url=...)' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    const isGet = req.method === 'GET'
    const requestBytes = isGet ? undefined : await req.arrayBuffer()

    const headers: Record<string, string> = {
      'User-Agent': 'C2PA-Conformance-Tool/1.0',
      'Accept': 'application/ocsp-response',
    }

    if (!isGet && requestBytes && requestBytes.byteLength > 0) {
      headers['Content-Type'] = 'application/ocsp-request'
    }

    const response = await fetch(responderUrl, {
      method: isGet ? 'GET' : 'POST',
      headers,
      body: requestBytes,
    })

    const responseBody = await response.arrayBuffer()
    const contentType = response.headers.get('content-type') || 'application/ocsp-response'

    return new Response(responseBody, {
      status: response.status,
      headers: {
        ...corsHeaders,
        'Content-Type': contentType,
      },
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return new Response(JSON.stringify({ error: `Failed to proxy OCSP request: ${msg}` }), {
      status: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
}

export const config: Config = {
  path: '/api/ocsp-proxy'
}
