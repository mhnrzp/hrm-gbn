# Supabase setup (development project)

Do these steps yourself in the Supabase dashboard. **Never paste keys or passwords into chat.** They go only into `.env.local`, which git ignores.

## 1. Create the project
1. Go to https://supabase.com/dashboard and select **New project**.
2. Name: `gbn-hrm-dev`. Region: **Central EU (Frankfurt)**. Generate a strong database password and keep it in your password manager.

## 2. Fill `.env.local`
Copy `.env.example` to `.env.local` and fill it in:

| Variable | Where to find it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project Settings → Data API → Project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Project Settings → API Keys → Publishable key (`sb_publishable_…`) |
| `SUPABASE_SECRET_KEY` | Project Settings → API Keys → Secret keys. Create one if none is listed (`sb_secret_…`). |
| `SUPABASE_DB_URL` | **Connect** button (top bar) → Session pooler → URI. Replace `[YOUR-PASSWORD]` with your database password. |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` for local development |

## 3. Authentication settings
1. **Authentication → Sign In / Providers**: turn **off** "Allow new users to sign up". Users only join by invitation. Keep the Email provider enabled.
2. **Authentication → URL Configuration**:
   - Site URL: `http://localhost:3000`
   - Redirect URLs: add `http://localhost:3000/**`. Add the Vercel preview URL later.
3. **Authentication → Emails → Templates**. The links must point at our `/auth/confirm` route so sign-in works with server-side cookies.

**Invite user**. Subject: `دعوت به GBN HRM`

```html
<div dir="rtl" style="font-family:Tahoma,sans-serif">
  <h2>به GBN HRM خوش آمدید</h2>
  <p>برای فعال‌سازی حساب و تعیین رمز عبور روی لینک زیر بزنید:</p>
  <p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/auth/set-password">فعال‌سازی حساب</a></p>
  <p>این لینک فقط یک‌بار و برای مدت محدود معتبر است.</p>
</div>
```

**Reset password**. Subject: `تعیین رمز عبور GBN HRM`

```html
<div dir="rtl" style="font-family:Tahoma,sans-serif">
  <h2>تعیین رمز عبور</h2>
  <p>برای تعیین رمز عبور حساب GBN HRM روی لینک زیر بزنید:</p>
  <p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/auth/set-password">تعیین رمز عبور</a></p>
  <p>اگر این درخواست از طرف شما نبوده، این ایمیل را نادیده بگیرید.</p>
</div>
```

> Supabase's built-in email sender is rate limited to a few emails per hour. That is fine for development. Before real staff use the app, configure custom SMTP in **Authentication → Emails → SMTP Settings**.

## 4. Apply migrations and create the organisation
```bash
pnpm db:push
pnpm bootstrap --name "گسترش بینش نوین" --slug gbn --email you@example.com --manager "Your Name"
```
Open the invitation email, set a password, and you are signed in as the first manager.
