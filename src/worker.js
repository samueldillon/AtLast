/* Sits in front of the static site (index.html, definitions.json, og-image.png)
   via the ASSETS binding — see wrangler.toml's run_worker_first, which routes
   only /api/* through this script and leaves every other path to fall
   straight through to static asset serving untouched.

   Currently handles one thing: forwarding Daily Challenge feedback to
   hello@playatlast.com via Resend, so it lands in a real inbox instead of
   only sitting in Firestore. The client already writes feedback to Firestore
   first and treats this endpoint as best-effort — see submitFeedback() in
   index.html — so every failure path here responds 200 rather than surfacing
   an error to the player; the feedback is never lost, only the email notice
   might not send. */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/feedback" && request.method === "POST") {
      return handleFeedback(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};

async function handleFeedback(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const message = typeof body.message === "string" ? body.message.trim().slice(0, 2000) : "";
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 100) : "";
  const screen = typeof body.screen === "string" ? body.screen.slice(0, 50) : "";
  const mode = typeof body.mode === "string" ? body.mode.slice(0, 20) : "";

  if (!message) {
    return json({ error: "empty_message" }, 400);
  }

  if (!env.RESEND_API_KEY) {
    // Not configured yet — Firestore already has the feedback, so stay quiet.
    return json({ ok: false, reason: "not_configured" });
  }

  const fromAddress = env.FEEDBACK_FROM || "At Last <feedback@playatlast.com>";

  let resendRes;
  try {
    resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromAddress,
        to: "hello@playatlast.com",
        subject: `At Last feedback${name ? " from " + name : ""}`,
        text: [
          message,
          "",
          `Name: ${name || "(none)"}`,
          `Screen: ${screen || "(unknown)"}`,
          `Mode: ${mode || "(unknown)"}`,
        ].join("\n"),
      }),
    });
  } catch (e) {
    console.error("Resend request failed:", e);
    return json({ ok: false, reason: "network_error" });
  }

  if (!resendRes.ok) {
    const errText = await resendRes.text().catch(() => "");
    console.error("Resend send failed:", resendRes.status, errText);
    return json({ ok: false, reason: "send_failed" });
  }

  return json({ ok: true });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}
