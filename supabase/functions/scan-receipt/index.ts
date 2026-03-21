const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SYSTEM = `You analyze fuel receipt images. Return only valid JSON — no markdown, no explanation.`

const PROMPT = `Extract all information from this fuel receipt image and return ONLY this JSON structure:

{
  "fields": {
    "date":         {"value": "YYYY-MM-DD or null", "confidence": "high|medium|low"},
    "station":      {"value": "station name or null", "confidence": "high|medium|low"},
    "grade":        {"value": "Regular 87|Plus 89|Premium 91|Premium 93 or null", "confidence": "high|medium|low"},
    "volume_l":     {"value": numeric_litres_or_null, "confidence": "high|medium|low"},
    "price_per_l":  {"value": numeric_price_per_litre_or_null, "confidence": "high|medium|low"},
    "total_cost":   {"value": numeric_total_or_null, "confidence": "high|medium|low"},
    "odometer_km":  {"value": numeric_km_or_null, "confidence": "high|medium|low"}
  },
  "boxes": {
    "fieldName": {"x": 0.0, "y": 0.0, "w": 0.5, "h": 0.05}
  }
}

Rules:
- boxes use normalized 0.0–1.0 coordinates: x/y = top-left corner, w/h = dimensions relative to image size
- only include a box entry for fields with non-null values
- grade: map REG/REGULAR/EREG → "Regular 87", PLUS/MID → "Plus 89", PREM/PREMIUM/SUPER/91/93 → "Premium 91" or "Premium 93"
- volume_l: litres dispensed (e.g. "58.317 L" → 58.317)
- price_per_l: price per litre in dollars (e.g. "1.649/L" → 1.649)
- total_cost: total dollars charged for this fill-up
- odometer_km: only if visible on receipt or odometer photo
- date: fill date on the receipt (YYYY-MM-DD format)`

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  try {
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY secret not set — add it in Supabase project settings under Edge Functions > Secrets' }), {
        status: 500,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    const { image, mediaType } = await req.json()
    if (!image || !mediaType) {
      return new Response(JSON.stringify({ error: 'Missing image or mediaType in request body' }), {
        status: 400,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-6',
        max_tokens: 2048,
        system: SYSTEM,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: mediaType, data: image },
              },
              { type: 'text', text: PROMPT },
            ],
          },
        ],
      }),
    })

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text()
      return new Response(JSON.stringify({ error: `Anthropic API error ${anthropicRes.status}: ${errText}` }), {
        status: anthropicRes.status,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    const data = await anthropicRes.json()
    const text: string = data.content?.[0]?.text ?? ''

    // Extract JSON from response (handle any accidental markdown wrapping)
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return new Response(JSON.stringify({ error: 'Model returned no JSON', raw: text }), {
        status: 422,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    const parsed = JSON.parse(jsonMatch[0])
    return new Response(JSON.stringify(parsed), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
