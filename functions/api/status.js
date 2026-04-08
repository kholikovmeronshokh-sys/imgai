export async function onRequestGet(context) {
  return json({
    ok: true,
    configured: Boolean(context.env.HF_TOKEN),
    limit: 2,
    provider: "huggingface",
    model: context.env.HF_IMAGE_MODEL || "black-forest-labs/FLUX.1-schnell",
  });
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
