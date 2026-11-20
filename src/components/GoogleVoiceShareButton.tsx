import { useState } from "react";
import { Copy, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { googleVoiceUrl } from "@/lib/trackingCopy";
import { rateconPhone } from "@/lib/rateconDelivery";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function GoogleVoiceShareButton({ phone, message }: { phone: string; message: string }) {
  const [open, setOpen] = useState(false);
  const number = rateconPhone(phone);
  const url = googleVoiceUrl(phone);
  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied`);
    } catch {
      toast.error(`Couldn't copy ${label.toLowerCase()} — select it below and copy.`);
    }
  };
  const launch = () => {
    if (!url || !number) return toast.error("Enter a complete driver phone number.");
    // Open while the click is still active, before asynchronous clipboard work.
    window.open(url, "_blank", "noopener,noreferrer");
    setOpen(true);
    void copy(message, "Tracking text");
  };
  return <>
    <Button size="sm" variant="outline" title="Open the Google Voice conversation and copy the message" onClick={launch}>
      <MessageSquare className="mr-1 h-3.5 w-3.5" />Google Voice
    </Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[90dvh] overflow-auto">
        <DialogHeader><DialogTitle>Google Voice message</DialogTitle><DialogDescription>{number}</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <label className="block text-xs">To<Input aria-label="Google Voice recipient" readOnly value={number ?? phone} onFocus={(e) => e.currentTarget.select()} /></label>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => void copy(number ?? phone, "Phone number")}><Copy className="mr-1 h-3.5 w-3.5" />Copy phone</Button>
            {url && <Button size="sm" variant="outline" asChild><a href={url} target="_blank" rel="noopener noreferrer"><MessageSquare className="mr-1 h-3.5 w-3.5" />Open Google Voice</a></Button>}
          </div>
          <label className="block text-xs">Message<Textarea aria-label="Google Voice message" rows={10} readOnly value={message} onFocus={(e) => e.currentTarget.select()} /></label>
          <Button size="sm" onClick={() => void copy(message, "Message")}><Copy className="mr-1 h-3.5 w-3.5" />Copy message</Button>
        </div>
      </DialogContent>
    </Dialog>
  </>;
}