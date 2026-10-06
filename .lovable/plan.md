# Gmail-friendly emails + internal team chat and notes

## Short answer on email
Google Workspace works, and you don't need Outlook. Right now the invite, packet and rate con "Email" buttons open your computer's default mail program. If that default isn't set to Gmail, the buttons may open Outlook or Apple Mail instead.

## 1. "Send with Gmail" option
- Add a **Gmail** button next to every current Email button (carrier packet invite, invite resend, rate con send-for-signature).
- It opens a Gmail compose window in a new tab with the To, subject and body already filled in, sent from whichever Google Workspace account you're signed into.
- Add a small setting on your profile, **Preferred email app: Gmail / Default mail app**. The main button then uses your choice.

## 2. Internal team chat and notes
- **Chat bubble** in the bottom-right corner on every page after login, with an unread count.
- **Channels:** one shared "Team" channel plus 1-on-1 direct messages between users.
- **Load-linked notes:** a Notes tab in the dispatch cockpit for each load. Notes are timestamped and show the author. Typing @name notifies that person.
- **Pop-up on login:** if you have unread messages or mentions, the chat panel opens automatically with a "You have X unread" summary. New messages show a toast while you work.
- **Privacy:** brokers only see notes on loads they can already see. Direct messages are visible only to the two people in them. Nothing in chat exposes pay or margins.

## Technical details
- New tables: `chat_channels` (team/dm), `chat_members`, `chat_messages` (channel_id, author_id, body, load_id nullable, mentions uuid[]), `chat_reads` (user, channel, last_read_at), and `load_notes` (load_id, author_id, body). All have GRANTs and RLS: chat requires channel membership plus is_staff, and load_notes follow the same visibility as loads.
- Realtime is turned on for chat_messages and load_notes so updates appear live.
- New components: `ChatWidget` mounted in AppShell, and a `LoadNotes` panel in the cockpit.
- Gmail compose URL: `https://mail.google.com/mail/?view=cm&to=..&su=..&body=..`. Add a shared `composeEmail()` helper that replaces the direct mailto calls.
- The preference is stored in a new `profiles.email_client` column.
