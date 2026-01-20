# StatTrackr Authentication Setup

## ✅ What's Done
- Beautiful login page created at `/login`
- Supabase authentication integrated
- Email/password signup and login
- Google OAuth ready
- Database schema prepared
- Row Level Security (RLS) configured

## 🔧 Setup Required

### 1. Database Setup
1. Go to your Supabase dashboard: https://supabase.com/dashboard
2. Open the SQL Editor
3. Copy and paste the entire content from `supabase_schema.sql`
4. Click "Run" to create the bets table and security policies

### 2. Authentication Settings (Optional - for Google OAuth)
1. In your Supabase dashboard, go to Authentication > Providers
2. Enable Google provider
3. Add your Google OAuth credentials:
   - Go to Google Cloud Console
   - Create OAuth 2.0 credentials
   - Set authorized redirect URI to: `https://your-project-id.supabase.co/auth/v1/callback`
   - Copy Client ID and Secret to Supabase

### 3. Disable Captcha (Required to fix login issues)
1. In Supabase dashboard, go to Authentication > Settings
2. Scroll down to "Security and Captcha"
3. **Disable "Enable Captcha protection"**
4. Click "Save"

### 4. Email Verification & Production SMTP (Optional)
For **email verification on sign-up** (required in production):
1. **Authentication** → **Providers** → **Email** → enable **Confirm email**
2. For reliable delivery, use **custom SMTP** (Resend recommended): **Project Settings** → **Authentication** → **SMTP Settings**

**Full production steps (Resend + Supabase):** see [`docs/email-auth-production-setup.md`](docs/email-auth-production-setup.md).

## 🚀 How It Works

### Login Flow:
1. User visits `/journal` without being logged in
2. Automatically redirected to `/login`
3. User can sign up or sign in with email/password or Google
4. After successful login, redirected to `/journal`
5. All bets are now tied to the authenticated user

### Security:
- Each user can only see their own bets
- Database automatically filters by user ID
- All operations (create, read, update, delete) are secured
- Session management handled by Supabase

## 🎯 Features

### Login Page Features:
✅ Modern, responsive design matching StatTrackr theme
✅ Email/password authentication
✅ Google OAuth integration
✅ Loading states and error handling
✅ Toggle between Sign In and Sign Up
✅ Password visibility toggle
✅ Feature showcase (left side on desktop)
✅ Mobile-friendly

### Journal Integration:
✅ Automatic login check
✅ Secure data fetching per user
✅ Proper logout functionality
✅ Session persistence

## 🧪 Testing
1. Visit `http://localhost:3001/journal`
2. Should redirect to `/login`
3. Create an account or sign in
4. Should redirect back to journal
5. Add some bets and verify they save
6. Logout and login again - bets should persist

## 🎨 Customization
The login page uses your StatTrackr color scheme:
- Navy blue gradient background
- Emerald green accent colors
- Glass-morphism effects
- Professional card layouts

All styles are in the component and can be easily modified!
