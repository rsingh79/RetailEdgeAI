# Gmail Integration — Google Cloud Setup

Each tenant provides their own Google Cloud OAuth credentials through the RetailEdge Settings UI. This guide walks through creating those credentials.

## 1. Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Click the project dropdown (top-left) → **New Project**
3. Name it (e.g. "RetailEdge Gmail") → **Create**
4. Select the new project from the dropdown

## 2. Enable the Gmail API

1. Go to **APIs & Services → Library**
2. Search for **Gmail API**
3. Click it → **Enable**

## 3. Configure OAuth Consent Screen

1. Go to **APIs & Services → OAuth consent screen**
2. Select **External** user type (or **Internal** if using Google Workspace) → **Create**
3. Fill in:
   - App name: `RetailEdge`
   - User support email: your email
   - Developer contact: your email
4. Click **Add or Remove Scopes**, add:
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/userinfo.email`
5. Save and continue
6. Under **Test Users**, add the Gmail address you want to connect
7. Save and continue

## 4. Create OAuth 2.0 Credentials

1. Go to **APIs & Services → Credentials**
2. Click **Create Credentials → OAuth Client ID**
3. Application type: **Web application**
4. Name: `RetailEdge`
5. Under **Authorized redirect URIs**, add:
   ```
   http://localhost:3001/api/gmail/oauth/callback
   ```
   (For production, use your production API domain.)
6. Click **Create**
7. Copy the **Client ID** and **Client Secret**

## 5. Enter Credentials in RetailEdge

1. Log in to RetailEdge
2. Navigate to **Settings → Integrations**
3. In the **Google Cloud Credentials** section:
   - Paste your **Client ID**
   - Paste your **Client Secret**
   - Click **Save Credentials**
4. Click **Connect Gmail**
5. A popup opens Google's OAuth consent screen
6. Sign in and authorize
7. You'll be redirected back with a "Connected" status

## 6. Configure Polling (Optional)

Once connected:
- Add **sender whitelist** emails to limit which senders are processed
- Set a **Gmail label** filter to only scan a specific label
- Choose a **poll interval** (15 min to 2 hours)
- Click **Save Configuration**

## Server Configuration

The server only needs the redirect URI (same for all tenants):

```env
# In server/.env
GOOGLE_REDIRECT_URI=http://localhost:3001/api/gmail/oauth/callback
```

### Optional: Encryption Key

By default, OAuth tokens and client secrets are encrypted using a key derived from `JWT_SECRET`. For production, generate a dedicated 256-bit key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Add to `server/.env`:
```env
GMAIL_ENCRYPTION_KEY=your-64-char-hex-string
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Google Client ID not configured" | Save credentials in Settings → Integrations first |
| "redirect_uri_mismatch" | Ensure the redirect URI in Google Console matches `GOOGLE_REDIRECT_URI` |
| "access_denied" | Add your email as a test user in the OAuth consent screen |
| "invalid_grant" on refresh | Token was revoked — disconnect and reconnect in Settings |
| Popup blocked | Browser blocked the OAuth popup — allow popups for localhost |
| "Invalid Google Client ID format" | Client ID should end with `.apps.googleusercontent.com` |

## Production Notes

- Move to **Published** status on the OAuth consent screen (requires Google verification)
- Use a proper `GMAIL_ENCRYPTION_KEY` (not derived from JWT_SECRET)
- Update `GOOGLE_REDIRECT_URI` to your production API domain
- Each tenant manages their own Google Cloud project and credentials
