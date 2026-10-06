<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

# AGENTS.md

- App data is read/written from the browser client under RLS; privacy rules (broker pay, load visibility) live in database policies — keep them there, not in UI.
- Roles live in `user_roles` with `has_role()`; first signup becomes admin via the `handle_new_user` trigger.
- Carrier booking compliance is enforced by the `enforce_carrier_compliance` DB trigger so no client can bypass it.
- Shared TMS types/helpers live in `src/lib/tms.ts`; query options in `src/lib/queries.ts`; PDFs generated client-side with jsPDF in `src/lib/`.
