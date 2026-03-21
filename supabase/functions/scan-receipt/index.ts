const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// ── Prompts ──────────────────────────────────────────────────────────────────

const RECEIPT_SYSTEM = `You analyze fuel receipt images. Return only valid JSON — no markdown, no explanation.`

const RECEIPT_PROMPT = `Extract all information from this fuel receipt image and return ONLY this JSON structure:

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
- boxes use normalized 0.0-1.0 coordinates: x/y = top-left corner, w/h = dimensions relative to image size
- only include a box entry for fields with non-null values
- grade: map REG/REGULAR/EREG to Regular 87, PLUS/MID to Plus 89, PREM/PREMIUM/SUPER/91/93 to Premium 91 or Premium 93
- volume_l: litres dispensed (e.g. 58.317 L becomes 58.317)
- price_per_l: price per litre in dollars (e.g. 1.649/L becomes 1.649)
- total_cost: total dollars charged for this fill-up
- odometer_km: only if the odometer reading is printed on the receipt
- date: fill date on the receipt in YYYY-MM-DD format`

const ODO_SYSTEM = `You read vehicle odometer displays from photos. Return only valid JSON — no markdown, no explanation.`

const ODO_PROMPT = `Read the odometer display in this image and return ONLY this JSON:

{
  "odometer_km": {"value": 145230, "confidence": "high|medium|low"}
}

Rules:
- value must be a plain number (no commas or units), or null if unreadable
- read the main odometer (total distance), not the trip meter
- if the display shows miles (mi), convert to km by multiplying by 1.60934 and round to nearest whole number
- if you see both km and mi displays, use km
- confidence: high = clearly readable, medium = partially obscured, low = guessing`

// ── Handler ──────────────────────────────────────────────────────────────────

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
      return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY secret not set' }), {
        status: 500,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    const { image, mediaType, type = 'receipt' } = await req.json()
    if (!image || !mediaType) {
      return new Response(JSON.stringify({ error: 'Missing image or mediaType' }), {
        status: 400,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    const isOdometer = type === 'odometer'
    const system     = isOdometer ? ODO_SYSTEM     : RECEIPT_SYSTEM
    const prompt     = isOdometer ? ODO_PROMPT     : RECEIPT_PROMPT
    const maxTokens  = isOdometer ? 256             : 2048

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-6',
        max_tokens: maxTokens,
        system,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
            { type: 'text', text: prompt },
          ],
        }],
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
