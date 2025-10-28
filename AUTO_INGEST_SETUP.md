# Auto-Ingest Setup

This system automatically ingests new NBA game data once all games for the day are completed.

## How It Works

1. **Cron job runs every 2 hours** (configured in `vercel.json`)
2. **Checks if all today's games are complete** via BallDontLie API
3. **If all games are final**, triggers the ingest endpoint: `/api/dvp/ingest-nba-all?latest=1`
4. **Only ingests new games** - existing data remains unchanged

## Setup Instructions

### 1. Set Environment Variable

Add to your `.env.local` and Vercel dashboard:

```bash
CRON_SECRET=your-random-secret-key-here
```

Generate a secure random string for production.

### 2. Vercel Deployment

The `vercel.json` file is already configured with:

```json
{
  "crons": [
    {
      "path": "/api/cron/auto-ingest",
      "schedule": "0 */2 * * *"
    }
  ]
}
```

**Schedule**: Every 2 hours (cron format: `minute hour day month weekday`)

### 3. Vercel Dashboard Setup

1. Go to your project settings on Vercel
2. Navigate to **Environment Variables**
3. Add `CRON_SECRET` with a secure random value
4. Deploy your changes

Vercel will automatically handle the cron scheduling.

## Alternative: External Cron Service

If you prefer an external service (non-Vercel):

### Option 1: cron-job.org

1. Visit https://cron-job.org
2. Create a free account
3. Add a new cron job:
   - **URL**: `https://your-domain.com/api/cron/auto-ingest`
   - **Schedule**: Every 2 hours
   - **Headers**: Add `Authorization: Bearer YOUR_CRON_SECRET`

### Option 2: GitHub Actions

Create `.github/workflows/auto-ingest.yml`:

```yaml
name: Auto Ingest NBA Games
on:
  schedule:
    - cron: '0 */2 * * *'  # Every 2 hours
  workflow_dispatch:  # Manual trigger

jobs:
  ingest:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger Auto-Ingest
        run: |
          curl -X GET "https://your-domain.com/api/cron/auto-ingest" \
            -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}"
```

## Testing

Test the endpoint manually:

```bash
curl -X GET "http://localhost:3000/api/cron/auto-ingest" \
  -H "Authorization: Bearer your-secret-key-here"
```

## Schedule Options

Modify `vercel.json` schedule as needed:

- **Every 2 hours**: `0 */2 * * *`
- **Every hour**: `0 * * * *`
- **Every 30 minutes**: `*/30 * * * *`
- **Daily at 2 AM ET**: `0 7 * * *` (UTC)
- **Every 4 hours starting at midnight**: `0 */4 * * *`

## Logs

Check Vercel logs or your hosting platform's logs to monitor:
- When cron runs
- Game completion status
- Ingest results

## Security

The `CRON_SECRET` ensures only authorized requests can trigger the auto-ingest.

Never commit the actual secret to your repository.
