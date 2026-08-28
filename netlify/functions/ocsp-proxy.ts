import type { Handler } from '@netlify/functions'

export const handler: Handler = async (event) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-OCSP-Responder-URL',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' }
  }

  const responderUrl = event.queryStringParameters?.url || event.headers['x-ocsp-responder-url']
  if (!responderUrl) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Missing responder URL parameter (?url=...)' }),
    }
  }

  try {
    const isBase64 = event.isBase64Encoded
    const requestBytes = event.body
      ? (isBase64 ? Buffer.from(event.body, 'base64') : Buffer.from(event.body, 'binary'))
      : Buffer.alloc(0)

    const response = await fetch(responderUrl, {
      method: event.httpMethod === 'GET' ? 'GET' : 'POST',
      headers: {
        'Content-Type': 'application/ocsp-request',
        'User-Agent': 'C2PA-Conformance-Tool/1.0',
      },
      body: event.httpMethod === 'GET' ? undefined : requestBytes,
    })

    const arrayBuffer = await response.arrayBuffer()
    const base64Body = Buffer.from(arrayBuffer).toString('base64')

    return {
      statusCode: response.status,
      headers: {
        ...corsHeaders,
        'Content-Type': response.headers.get('content-type') || 'application/ocsp-response',
      },
      isBase64Encoded: true,
      body: base64Body,
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      statusCode: 502,
      headers: corsHeaders,
      body: JSON.stringify({ error: `Failed to proxy OCSP request: ${msg}` }),
    }
  }
}
