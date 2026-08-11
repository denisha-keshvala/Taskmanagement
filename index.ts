import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const {
      name,
      email,
      loginId,
      password,
      role,
      department,
      loginUrl,
    } = body || {};

    if (!email || !loginId || !password) {
      return new Response(
        JSON.stringify({ ok: false, message: "name, email, loginId and password are required." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const apiKey = Deno.env.get("RESEND_API_KEY");
    const from = Deno.env.get("WELCOME_EMAIL_FROM");

    if (!apiKey || !from) {
      return new Response(
        JSON.stringify({
          ok: false,
          message: "Email is not configured. Set RESEND_API_KEY and WELCOME_EMAIL_FROM in Supabase Edge Function secrets.",
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:650px;margin:auto;padding:28px;color:#172033">
        <div style="border-radius:18px;padding:24px;background:linear-gradient(135deg,#1677ff,#4318ff);color:#fff">
          <h1 style="margin:0">Welcome to Shakti Technology</h1>
          <p style="margin:8px 0 0">Your Task Command account has been created.</p>
        </div>
        <div style="padding:24px;border:1px solid #e5e7eb;border-top:0">
          <p>Hello <b>${escapeHtml(name || "")}</b>,</p>
          <p>Your account details are:</p>
          <table style="border-collapse:collapse;width:100%">
            <tr><td style="padding:9px;border-bottom:1px solid #eee">Employee ID</td><td style="padding:9px;border-bottom:1px solid #eee"><b>${escapeHtml(loginId)}</b></td></tr>
            <tr><td style="padding:9px;border-bottom:1px solid #eee">Password</td><td style="padding:9px;border-bottom:1px solid #eee"><b>${escapeHtml(password)}</b></td></tr>
            <tr><td style="padding:9px;border-bottom:1px solid #eee">Department</td><td style="padding:9px;border-bottom:1px solid #eee">${escapeHtml(department || "")}</td></tr>
            <tr><td style="padding:9px">Role</td><td style="padding:9px">${escapeHtml(role || "")}</td></tr>
          </table>
          <p style="margin-top:22px">
            <a href="${escapeAttr(loginUrl || "https://denisha-keshvala.github.io/Taskmanagement/")}"
               style="display:inline-block;background:#1677ff;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:700">
              Open Task Command Login
            </a>
          </p>
          <p style="font-size:12px;color:#64748b">Please keep these credentials private.</p>
        </div>
      </div>`;

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [email],
        subject: "Welcome to Shakti Technology – Task Command Login",
        html,
      }),
    });

    const result = await response.json();

    return new Response(
      JSON.stringify({
        ok: response.ok,
        message: response.ok ? "Welcome email sent." : (result?.message || "Email provider rejected the request."),
        provider: result,
      }),
      {
        status: response.ok ? 200 : 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ ok: false, message: error?.message || String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function escapeHtml(value: string) {
  return String(value ?? "").replace(/[&<>"']/g, (m) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" } as Record<string,string>)[m]
  );
}
function escapeAttr(value: string) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}
