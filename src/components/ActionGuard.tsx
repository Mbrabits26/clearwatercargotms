import { createContext, useCallback, useContext, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** What the warning box says before an accounting action runs. */
export type ConfirmSpec = { title: string; body?: ReactNode; points?: ReactNode[]; confirmLabel?: string; danger?: boolean };
type Ask = (spec: ConfirmSpec) => Promise<boolean>;
const Ctx = createContext<Ask | null>(null);

/** Mount once near the root: hover hints + the shared "about to do this" warning box. */
export function ActionGuardProvider({ children }: { children: ReactNode }) {
  const [spec, setSpec] = useState<ConfirmSpec | null>(null);
  const resolver = useRef<(ok: boolean) => void>(() => {});
  const ask = useCallback<Ask>((s) => new Promise<boolean>((res) => { resolver.current(false); resolver.current = res; setSpec(s); }), []);
  const done = (ok: boolean) => { const r = resolver.current; resolver.current = () => {}; setSpec(null); r(ok); };
  return (
    <TooltipProvider delayDuration={300}>
      <Ctx.Provider value={ask}>
        {children}
        <AlertDialog open={!!spec} onOpenChange={(o) => { if (!o) done(false); }}>
          <AlertDialogContent className="max-h-[85vh] overflow-auto">
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 shrink-0 text-warning" />{spec?.title}</AlertDialogTitle>
              {spec?.body ? <AlertDialogDescription asChild><div className="text-sm">{spec.body}</div></AlertDialogDescription> : <AlertDialogDescription className="sr-only">Confirm this action</AlertDialogDescription>}
            </AlertDialogHeader>
            {!!spec?.points?.length && (
              <ul className="list-disc space-y-1 pl-5 text-sm">{spec.points.map((p, i) => <li key={i}>{p}</li>)}</ul>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel>Go back</AlertDialogCancel>
              <AlertDialogAction className={spec?.danger ? buttonVariants({ variant: "destructive" }) : undefined} onClick={() => done(true)}>{spec?.confirmLabel ?? "Yes, continue"}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </Ctx.Provider>
    </TooltipProvider>
  );
}

/** `if (!(await confirm({ title, points }))) return;` — shows the shared warning box. */
export function useConfirm(): Ask {
  const ask = useContext(Ctx);
  return ask ?? (async (s) => window.confirm(s.title));
}

/** Hover explanation for any button. Works on disabled buttons too (the wrapper takes the hover). */
export function Hint({ text, children, side = "top", className }: { text?: ReactNode; children: ReactNode; side?: "top" | "bottom" | "left" | "right"; className?: string }) {
  if (!text) return <>{children}</>;
  return (
    <Tooltip>
      <TooltipTrigger asChild><span className={cn("inline-flex", className)}>{children}</span></TooltipTrigger>
      <TooltipContent side={side} className="max-w-xs text-left leading-snug">{text}</TooltipContent>
    </Tooltip>
  );
}

type ActionButtonProps = Omit<ComponentProps<typeof Button>, "onClick"> & {
  /** Shown on hover. */
  hint?: ReactNode;
  /** Warning box shown on click; return null to skip it (e.g. nothing selected). */
  confirm?: ConfirmSpec | (() => ConfirmSpec | null);
  onClick?: () => unknown;
  hintClassName?: string;
};

/** Button with a hover explanation and, optionally, a warning box before it runs. */
export function ActionButton({ hint, confirm, onClick, hintClassName, ...props }: ActionButtonProps) {
  const ask = useConfirm();
  const click = async () => {
    const spec = typeof confirm === "function" ? confirm() : confirm;
    if (spec && !(await ask(spec))) return;
    await onClick?.();
  };
  return <Hint text={hint} className={hintClassName}><Button {...props} onClick={click} /></Hint>;
}
