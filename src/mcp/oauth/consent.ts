// The page a person sees when a connector asks for their scratchpad: who is asking, where the
// answer goes, and a field for PAD_TOKEN, which is how the owner proves it is them.

const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );

/** The page's headers: nothing loads, nothing frames it, the form posts here and to the client. */
export const consentHeaders = (redirectUri: string) => ({
  "content-security-policy": [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    // Browsers check form-action against the redirect that answers the form, too.
    `form-action 'self' ${new URL(redirectUri).origin}`,
    "frame-ancestors 'none'",
    "base-uri 'none'",
  ].join("; "),
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
});

export const consentPage = ({
  clientName,
  redirectUri,
  params,
  error,
}: {
  clientName: string | undefined;
  redirectUri: string;
  /** The authorization request, carried through the form unchanged. */
  params: Record<string, string>;
  error?: string;
}) => {
  const who = escape(clientName?.trim() || "An MCP client");
  const where = escape(new URL(redirectUri).host);
  const hidden = Object.entries(params)
    .map(([name, value]) => `<input type="hidden" name="${escape(name)}" value="${escape(value)}">`)
    .join("\n      ");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>Connect to Scratchpad</title>
  <style>
    :root { --bg: #fafaf9; --fg: #1c1917; --muted: #57534e; --card: #fff; --border: #e7e5e4; --primary: #1c1917; --on-primary: #fafaf9; --danger: #b91c1c; }
    @media (prefers-color-scheme: dark) { :root { --bg: #0c0a09; --fg: #fafaf9; --muted: #a8a29e; --card: #1c1917; --border: #292524; --primary: #fafaf9; --on-primary: #1c1917; --danger: #f87171; } }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100dvh; display: grid; place-items: center; padding: 1rem; background: var(--bg); color: var(--fg); font: 1rem/1.5 system-ui, sans-serif; }
    main { width: 100%; max-width: 26rem; background: var(--card); border: 1px solid var(--border); border-radius: 0.75rem; padding: 1.5rem; }
    h1 { font-size: 1.25rem; margin: 0 0 0.5rem; }
    p { margin: 0 0 1rem; color: var(--muted); }
    strong { color: var(--fg); }
    label { display: block; font-weight: 600; margin-bottom: 0.25rem; }
    input[type=password] { width: 100%; font: inherit; padding: 0.5rem 0.75rem; border: 1px solid var(--border); border-radius: 0.5rem; background: var(--bg); color: var(--fg); }
    .error { color: var(--danger); margin: 0.5rem 0 0; }
    .actions { display: flex; gap: 0.5rem; margin-top: 1rem; }
    button { flex: 1; font: inherit; font-weight: 600; min-height: 2.5rem; border-radius: 0.5rem; border: 1px solid var(--border); background: transparent; color: var(--fg); cursor: pointer; }
    button[value=allow] { background: var(--primary); color: var(--on-primary); border-color: var(--primary); }
  </style>
</head>
<body>
  <main>
    <h1>Connect to your scratchpad?</h1>
    <p><strong>${who}</strong> wants to search, read and write your notes. If you allow it, you'll be sent back to <strong>${where}</strong>.</p>
    <form method="post" action="/authorize">
      ${hidden}
      <label for="token">Your PAD_TOKEN</label>
      <input id="token" name="token" type="password" autocomplete="current-password" autofocus${error ? ' aria-invalid="true" aria-describedby="error"' : ""}>
      ${error ? `<p class="error" id="error" role="alert">${escape(error)}</p>` : ""}
      <div class="actions">
        <button type="submit" name="decision" value="deny">Deny</button>
        <button type="submit" name="decision" value="allow">Allow</button>
      </div>
    </form>
  </main>
</body>
</html>`;
};

/** A request that can't go back to the client (an unknown client, a redirect it didn't register). */
export const errorPage = (message: string) => `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><title>Scratchpad</title></head>
<body style="font: 1rem/1.5 system-ui, sans-serif; max-width: 32rem; margin: 3rem auto; padding: 0 1rem">
  <h1 style="font-size: 1.25rem">This connection request can't be completed</h1>
  <p>${escape(message)}</p>
</body>
</html>`;
