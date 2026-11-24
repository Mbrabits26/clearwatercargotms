import { supabase } from "@/integrations/supabase/client";

/** A stable path per creation attempt allows retrying attachment without duplicating a load or document. */
export async function attachLoadSource(loadIds: string[], file: File, attempt: string, originals: File[]) {
  const sources = originals.filter(f => /\.(xlsx|xls|csv|txt|eml)$/i.test(f.name));
  for (const id of loadIds) {
    for (const [index, doc] of [file, ...sources].entries()) {
      const name = `other-source-${attempt}-${index}-${doc.name.replace(/[^\w.\-]+/g, "_")}`;
      const { data, error: listError } = await supabase.storage.from("load-docs").list(id, { search: name });
      if (listError) throw new Error(listError.message);
      if (!data?.some(f => f.name === name)) {
        const { error } = await supabase.storage.from("load-docs").upload(`${id}/${name}`, doc, { contentType: doc.type || "application/octet-stream" });
        if (error) throw new Error(error.message);
      }
      const { error } = await supabase.from("load_doc_names").upsert({ path: `${id}/${name}`, display_name: `Customer source document – ${doc.name}` }, { onConflict: "path" });
      if (error) throw new Error(error.message);
    }
  }
}