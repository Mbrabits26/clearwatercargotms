import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

/** Warns in the Load Builder when the picked customer has invoiced loads unpaid more than 30 days after delivery. */
export function CustomerCreditWarning({ customerId }: { customerId: string | null | undefined }) {
  const { data } = useQuery({
    queryKey: ["loads", "customer-past-due", customerId],
    enabled: !!customerId,
    queryFn: async () => {
      const cutoff = new Date(Date.now() - 30 * 86400_000).toISOString();
      const { data } = await supabase.from("loads").select("id, customer_rate")
        .eq("customer_id", customerId!).eq("status", "invoiced").lt("delivery_at", cutoff).limit(1000);
      return data ?? [];
    },
  });
  if (!data?.length) return null;
  const total = data.reduce((a, l) => a + Number(l.customer_rate || 0), 0);
  return (
    <p className="mt-1 flex items-start gap-1 text-[11px] text-warning">
      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
      {data.length} invoiced load{data.length === 1 ? "" : "s"} over 30 days past delivery, about ${total.toLocaleString()} unpaid.
    </p>
  );
}
