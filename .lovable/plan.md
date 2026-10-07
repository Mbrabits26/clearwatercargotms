# Gmail sending from your own Google Workspace account

The FMCSA fix and Sales Leads tab are already built. This plan covers the remaining piece: sending email directly from each person's Gmail inside the app.

## Sending email straight from your Gmail
Today the email buttons open a Gmail draft in a new tab, and you click Send. To send directly from inside the app, each person connects their own Google Workspace account one time:
- A **"Connect Gmail"** button in the top bar. You sign in with Google and allow sending.
- After that, carrier invites, rate cons, load offers and quotes **send right away from your own address**. A copy lands in your Gmail Sent folder.
- If someone hasn't connected, the buttons fall back to today's Gmail draft.

**One-time setup you'll need to do (about 10 minutes):** create a free Google sign-in app in your Google Workspace's Google Cloud console. Skip "Application Default Credentials" — you only need an **OAuth client ID** (Web application) with this redirect URI: `https://connector-gateway.lovable.dev/api/v1/app-users/oauth2/callback`. With the consent screen set to "Internal" for your Workspace, no Google review is needed. Then paste the Client ID and Client Secret into Lovable's workspace settings under App User Connectors → Gmail.

## Technical details
- Gmail: a google_mail App User Connector (each user's own OAuth). Encrypted per-user connection keys go in `app_user_connections`. A `sendGmail` server fn calls `messages/send`, and `composeEmail` uses it when the user is connected, otherwise it falls back to the compose URL.
- Scope: `https://www.googleapis.com/auth/gmail.send` plus basic profile scopes.
