import type { Config, Context } from '@netlify/functions'

export default async (req: Request, _context: Context): Promise<Response> => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-OCSP-Responder-URL',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  }

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders })
  }

  const urlObj = new URL(req.url)
  const responderUrl = urlObj.searchParams.get('url') || req.headers.get('x-ocsp-responder-url')
  if (!responderUrl) {
    return new Response(JSON.stringify({ error: 'Missing responder URL parameter (?url=...)' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    const requestBytes = req.method === 'GET' ? undefined : await req.arrayBuffer()

    const response = await fetch(responderUrl, {
      method: req.method === 'GET' ? 'GET' : 'POST',
      headers: {
        'Content-Type': 'application/ocsp-request',
        'User-Agent': 'C2PA-Conformance-Tool/1.0',
      },
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
  path: ['/api/ocsp-proxy', '/.netlify/functions/ocsp-proxy']
}
