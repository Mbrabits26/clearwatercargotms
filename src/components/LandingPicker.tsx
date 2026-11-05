import { useEffect, useState } from "react";
import { useRouteContext } from "@tanstack/react-router";
import { toast } from "sonner";
import { defaultLanding, getLandingPref, LANDINGS, setLandingPref, type Landing } from "@/lib/landing";

/** Each person picks the screen they open into; "Role default" reverts to the standard. */
export function LandingPicker({ className }: { className?: string }) {
  const { user, isAdmin, isAccountant } = useRouteContext({ from: "/_authenticated" });
  const [v, setV] = useState<string>("");
  useEffect(() => setV(getLandingPref(user.id) ?? ""), [user.id]);
  const def = LANDINGS.find((l) => l.value === defaultLanding({ isAdmin, isAccountant }))?.label;
  return (
    <select
      value={v}
      title="Which screen opens when you sign in or click the logo"
      className={className ?? "rounded border bg-background px-1.5 py-1 text-xs"}
      onChange={(e) => {
        const nv = e.target.value as Landing | "";
        setV(nv); setLandingPref(user.id, nv || null);
        toast.success(`You'll now open into ${nv ? LANDINGS.find((l) => l.value === nv)!.label : `${def} (role default)`}`);
      }}
    >
      <option value="">Start on: {def} (default)</option>
      {LANDINGS.map((l) => <option key={l.value} value={l.value}>Start on: {l.label}</option>)}
    </select>
  );
}
