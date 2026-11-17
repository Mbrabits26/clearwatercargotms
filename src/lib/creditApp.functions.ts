import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import { CREDIT_SECTIONS, CREDIT_TERMS, requiredMissing } from "./creditApp";

const keys = new Set(CREDIT_SECTIONS.flatMap((s) => s.fields.map((f) => f.key)));

async function load(token: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: app } = await supabaseAdmin.from("credit_applications").select("*").eq("token", token).maybeSingle();
  return { supabaseAdmin, app };
}

/** Public: customer opens their credit application link (token-validated). */
export const getCreditApp = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ token: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { app } = await load(data.token);
    if (!app) return { ok: false as const, problem: "This credit application link is not valid." };
    return { ok: true as const, app: { company_name: app.company_name, status: app.status, submitted: !!app.submitted_at, expired: new Date(app.expires_at).getTime() < Date.now() } };
  });

/** Public: customer submits the signed application. */
export const submitCreditApp = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({
    token: z.string().uuid(),
    answers: z.record(z.string(), z.string().max(500)),
    signer_name: z.string().trim().min(2).max(120),
    signer_title: z.string().trim().min(1).max(120),
    agree: z.literal(true),
  }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin, app } = await load(data.token);
    if (!app) throw new Error("This credit application link is not valid.");
    if (app.submitted_at) throw new Error("This application was already submitted. Call 252-497-7916 with changes.");
    if (new Date(app.expires_at).getTime() < Date.now()) throw new Error("This link has expired. Call 252-497-7916 for a new one.");
    const answers: Record<string, string> = {};
    for (const [k, v] of Object.entries(data.answers)) if (keys.has(k)) answers[k] = v.trim();
    const missing = requiredMissing(answers);
    if (missing.length) throw new Error(`Please fill in: ${missing.join(", ")}`);
    const limit = Number(answers.requested_limit?.replace(/[^0-9.]/g, "")) || null;
    const ip = getRequestHeader("cf-connecting-ip") ?? getRequestHeader("x-forwarded-for")?.split(",")[0] ?? null;
    const { error } = await supabaseAdmin.from("credit_applications").update({
      answers: { ...answers, terms_text: CREDIT_TERMS } as never, requested_limit: limit, status: "submitted",
      company_name: answers.legal_name || app.company_name, signer_name: data.signer_name, signer_title: data.signer_title,
      signer_ip: ip, user_agent: getRequestHeader("user-agent")?.slice(0, 300) ?? null, submitted_at: new Date().toISOString(),
    }).eq("id", app.id).is("submitted_at", null);
    if (error) throw new Error("Could not save your application. Please call 252-497-7916.");
    if (app.created_by) {
      await supabaseAdmin.from("chat_messages").insert({ channel: "team", author_id: app.created_by,
        body: `📝 Credit application submitted by ${data.signer_name} for ${answers.legal_name}${limit ? ` — requesting ${limit.toLocaleString("en-US", { style: "currency", currency: "USD" })}` : ""}. Review it on the customer in Directory.` });
    }
    return { ok: true };
  });
