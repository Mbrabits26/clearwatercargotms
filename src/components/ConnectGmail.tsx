import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Mail, MailCheck, Unplug } from "lucide-react";
import { completeGmailConnection, disconnectGmail, gmailStatus, startGmailConnect } from "@/lib/gmail.functions";
import { Button } from "@/components/ui/button";

function waitForOAuthCompletion(popup: Window) {
  return new Promise<string | null>((resolve, reject) => {
    let poll: number | undefined;
    const cleanup = () => {
      window.removeEventListener("message", onMessage);
      if (poll !== undefined) window.clearInterval(poll);
    };
    const onMessage = (event: MessageEvent) => {
      const type = event.data?.type;
      if (
        event.origin !== window.location.origin ||
        event.source !== popup ||
        event.data?.connectorId !== "google_mail" ||
        (type !== "appUserConnectorOAuthComplete" && type !== "appUserConnectorOAuthFailed")
      ) return;
      cleanup();
      if (type === "appUserConnectorOAuthComplete") {
        resolve(typeof event.data?.code === "string" ? event.data.code : null);
        return;
      }
      popup.close();
      reject(new Error("Google sign-in failed."));
    };
    window.addEventListener("message", onMessage);
    poll = window.setInterval(() => {
      if (!popup.closed) return;
      cleanup();
      reject(new Error("Sign-in window closed before finishing."));
    }, 500);
  });
}

export function ConnectGmail() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const { data: status } = useQuery({ queryKey: ["gmail-status"], queryFn: () => gmailStatus() });

  const connect = async () => {
    const popup = window.open("", "lovable-oauth", "width=600,height=720");
    if (!popup) return toast.error("Popup blocked. Allow popups and try again.");
    setBusy(true);
    try {
      const { authorizationUrl } = await startGmailConnect();
      const completion = waitForOAuthCompletion(popup);
      popup.location.href = authorizationUrl;
      const code = await completion;
      if (code) await completeGmailConnection({ data: { code } });
      await qc.invalidateQueries({ queryKey: ["gmail-status"] });
      toast.success(status?.connected ? "Reconnected to Gmail" : "Gmail connected — emails now send from your address");
    } catch (e) {
      popup.close();
      toast.error(e instanceof Error ? e.message : "Couldn't connect Gmail");
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await disconnectGmail();
      await qc.invalidateQueries({ queryKey: ["gmail-status"] });
      toast.success("Gmail disconnected — emails will open as drafts again");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't disconnect");
    } finally {
      setBusy(false);
    }
  };

  if (status?.connected) {
    return (
      <span className="flex items-center gap-1.5 rounded border border-success/40 px-2 py-0.5 text-xs text-success" title={`Emails send directly from ${status.email ?? "your Gmail"}`}>
        <MailCheck className="h-3.5 w-3.5" />
        {status.email ?? "Gmail connected"}
        <button onClick={disconnect} disabled={busy} className="ml-1 text-muted-foreground hover:text-foreground" aria-label="Disconnect Gmail" title="Disconnect Gmail">
          <Unplug className="h-3 w-3" />
        </button>
      </span>
    );
  }

  return (
    <Button size="sm" variant="outline" onClick={connect} disabled={busy} title="Connect your Google Workspace Gmail to send emails directly from the app">
      <Mail className="mr-1 h-3.5 w-3.5" />
      {status?.reconnectRequired ? "Reconnect Gmail" : "Connect Gmail"}
    </Button>
  );
}
