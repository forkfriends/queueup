# Cloudflare Turnstile Setup Guide

This guide explains how to set up Cloudflare Turnstile CAPTCHA verification for the QueueUp application.

## What is Turnstile?

Cloudflare Turnstile is a privacy-focused CAPTCHA alternative that helps prevent bots from joining queues. It provides smart verification with minimal user interaction.

## Backend Setup (Already Implemented)

The backend verification is already implemented in `api/worker.ts`. The `handleJoin` function verifies Turnstile tokens on the server side.

### Required Backend Environment Variables

Set these secrets in Cloudflare Workers:

```bash
# Required: Your Turnstile Secret Key
wrangler secret put TURNSTILE_SECRET_KEY

# Required: Host authentication secret
wrangler secret put HOST_AUTH_SECRET

# Optional: Bypass Turnstile in development (set to "true")
wrangler secret put TURNSTILE_BYPASS
```

## Frontend Setup

### 1. Get Your Turnstile Site Key

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Navigate to **Turnstile** section
3. Click **Add Site**
4. Configure your site:
   - **Site name**: QueueUp
   - **Domain**: Add your domains (e.g., `localhost`, `yourdomain.com`)
   - **Widget mode**: Managed (recommended)
5. Copy the **Site Key**

### 2. Configure Environment Variables

Add the site key to your `.env` file:

```bash
EXPO_PUBLIC_TURNSTILE_SITE_KEY=your-site-key-here
```

### 3. How It Works

- The Turnstile widget is displayed on the **Join Queue** screen (web only)
- It only appears when:
  - Running on web platform (`Platform.OS === 'web'`)
  - User is not already in a queue
  - Site key is configured
- The widget automatically handles:
  - Token generation
  - Token expiration (5 minutes)
  - Error recovery
  - Reset after successful join or errors

## Testing

### Development Mode (Bypass Turnstile)

To test without Turnstile during development:

1. Set `TURNSTILE_BYPASS=true` in your backend environment
2. Leave `EXPO_PUBLIC_TURNSTILE_SITE_KEY` empty in `.env`
3. The backend will skip verification

### Production Mode

1. Set up both frontend and backend keys as described above
2. The Turnstile widget will appear on the join screen
3. Users must complete the challenge before joining

## Test Keys (For Development)

Cloudflare provides test keys that always pass or fail:

**Always Passes:**
- Site Key: `1x00000000000000000000AA`
- Secret Key: `1x0000000000000000000000000000000AA`

**Always Fails:**
- Site Key: `2x00000000000000000000AB`
- Secret Key: `2x0000000000000000000000000000000AB`

**Always Shows Interactive Challenge:**
- Site Key: `3x00000000000000000000FF`
- Secret Key: `3x0000000000000000000000000000000FF`

## Security Best Practices

1. **Never commit secrets**: Keep your secret key in Cloudflare Workers secrets
2. **Rotate keys regularly**: Use the Cloudflare dashboard to rotate keys
3. **Restrict domains**: Only allow widgets on domains you control
4. **Always verify server-side**: The backend validation is mandatory (already implemented)

## Troubleshooting

### Widget Not Showing
- Check that `EXPO_PUBLIC_TURNSTILE_SITE_KEY` is set
- Verify you're running on web platform
- Check browser console for errors

### Verification Failing
- Ensure secret key is set in Cloudflare Workers: `wrangler secret put TURNSTILE_SECRET_KEY`
- Check that domains in Cloudflare dashboard match your app URL
- Verify `TURNSTILE_BYPASS` is not set to `"true"` in production

### Token Expired Errors
- Tokens expire after 5 minutes
- The widget automatically resets - user should try again
- Each token can only be used once

## API Reference

### Frontend Props

The Turnstile component accepts these key props:

```typescript
<Turnstile
  siteKey="your-site-key"
  onSuccess={(token) => setTurnstileToken(token)}
  onError={() => setTurnstileToken(null)}
  onExpire={() => setTurnstileToken(null)}
  options={{
    theme: 'auto',  // 'light' | 'dark' | 'auto'
    size: 'normal', // 'normal' | 'compact' | 'flexible'
  }}
/>
```

### Backend Verification

The backend expects this payload on `/api/queue/{code}/join`:

```json
{
  "name": "Party Name",
  "size": 2,
  "turnstileToken": "token-from-widget"
}
```

## Resources

- [Cloudflare Turnstile Documentation](https://developers.cloudflare.com/turnstile/)
- [react-turnstile GitHub](https://github.com/marsidev/react-turnstile)
- [Turnstile Dashboard](https://dash.cloudflare.com/turnstile)
