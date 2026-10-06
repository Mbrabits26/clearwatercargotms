import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { extractLoads } from "./extract.server";

const input = z.object({
  fileName: z.string().max(200),
  mime: z.string().max(100),
  base64: z.string().max(14_000_000).nullable(),
  text: z.string().max(200_000).nullable(),
});

export const extractLoadFromDoc = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => input.parse(d))
  .handler(async ({ data, context }) => {
    const { data: staff } = await context.supabase.rpc("is_staff", { _uid: context.userId });
    if (!staff) throw new Error("Forbidden");
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) throw new Error("Document reader is not configured.");
    const parts: Record<string, unknown>[] = [];
    if (data.text) parts.push({ type: "input_text", text: `File: ${data.fileName}\n\n${data.text}` });
    else if (data.base64 && data.mime === "application/pdf")
      parts.push({ type: "input_file", filename: data.fileName, file_data: `data:application/pdf;base64,${data.base64}` });
    else if (data.base64 && data.mime.startsWith("image/"))
      parts.push({ type: "input_image", image_url: `data:${data.mime};base64,${data.base64}` });
    else throw new Error("Upload a PDF, image, Excel or CSV file.");
    return { loads: await extractLoads(parts, key) };
  });
