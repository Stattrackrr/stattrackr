# Setting Up NEXT_PUBLIC_DEBUG_SECRET

## What is it?

`NEXT_PUBLIC_DEBUG_SECRET` is a secret key **you create yourself** to enable browser logs in production. It's like a password that unlocks the console logs.

---

## Generated Secret Key

Here's a secure random key generated for you:

```
c88UE4cC1jyQddR1pCxmBZKIgk5J3mGFgO0zy60+9hI=
```

---

## Setup Instructions

### Step 1: Add to `.env.local` (Local Development)

Create or edit `.env.local` in your project root and add:

```bash
NEXT_PUBLIC_DEBUG_SECRET=c88UE4cC1jyQddR1pCxmBZKIgk5J3mGFgO0zy60+9hI=
```

### Step 2: Add to Vercel (Production)

1. Go to your Vercel project dashboard
2. Navigate to **Settings** → **Environment Variables**
3. Add a new variable:
   - **Name:** `NEXT_PUBLIC_DEBUG_SECRET`
   - **Value:** `c88UE4cC1jyQddR1pCxmBZKIgk5J3mGFgO0zy60+9hI=`
   - **Environment:** Production, Preview, Development (select all)
4. Click **Save**
5. **Redeploy** your application for the change to take effect

---

## How to Use

After setting up the secret, you can enable logs in production by visiting:

```
https://your-site.com/?debug=c88UE4cC1jyQddR1pCxmBZKIgk5J3mGFgO0zy60+9hI=
```

The logs will be enabled and saved to localStorage, so they'll stay enabled for that browser session.

---

## Generate Your Own Secret (Optional)

If you want to generate a different secret, you can use:

**PowerShell (Windows):**
```powershell
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Minimum 0 -Maximum 256 }))
```

**Bash/Linux/Mac:**
```bash
openssl rand -base64 32
```

**Node.js:**
```javascript
require('crypto').randomBytes(32).toString('base64')
```

---

## Important Notes

- ⚠️ **NEXT_PUBLIC_ prefixed variables are exposed to the browser** - This is safe for a debug secret, but use a strong random value
- ✅ The secret is only used to enable logs - it doesn't give access to any sensitive data
- ✅ You can use the same secret or different secrets for dev/staging/production
- ✅ Without this secret set, logs will be suppressed in production (which is the default behavior)

---

## Quick Alternative (No Secret Needed)

If you don't want to set up the secret, you can also enable logs directly in the browser console:

```javascript
localStorage.setItem('stattrackr_admin_logs', 'true');
// Then refresh the page
```

Or use the global function:
```javascript
window.enableLogs();
```

