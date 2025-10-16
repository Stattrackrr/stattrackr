# Scheduled Cache Refresh System

This system provides automated cache refreshing for your NBA stats dashboard, allowing you to maintain fresh data without manual intervention.

## Overview

The cache refresh system consists of:

1. **API Endpoint**: `/api/cache/scheduled-refresh` - Handles refresh requests
2. **Utility Script**: `scripts/cache-refresh.js` - Command-line tool for triggering refreshes
3. **Updated TTL Configuration**: Longer cache lifetimes with scheduled refreshes

## Setup

### 1. Environment Variables

Add the following to your `.env.local` file:

```bash
# Cache refresh authorization token (generate a secure random string)
CACHE_REFRESH_TOKEN=your-secure-token-here

# Optional: Custom refresh URL (defaults to http://localhost:3000)
CACHE_REFRESH_URL=https://your-app.vercel.app
```

**Generate a secure token:**
```bash
# Using Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Using OpenSSL
openssl rand -hex 32
```

### 2. Make Script Executable

```bash
chmod +x scripts/cache-refresh.js
```

## Usage

### Manual Testing

Test the system locally:

```bash
# Dry run to see what would be refreshed
node scripts/cache-refresh.js --dry-run

# Refresh all enabled caches
node scripts/cache-refresh.js

# Refresh only player stats
node scripts/cache-refresh.js --job player_stats

# Refresh multiple specific caches
node scripts/cache-refresh.js --jobs player_stats,player_search
```

### Production Usage

For production deployments:

```bash
# Set environment variables
export CACHE_REFRESH_TOKEN="your-production-token"
export CACHE_REFRESH_URL="https://your-app.vercel.app"

# Run refresh
node scripts/cache-refresh.js --job player_stats
```

## Scheduling

### Option 1: Cron Jobs (Linux/macOS)

Edit your crontab:
```bash
crontab -e
```

Add these entries:
```bash
# Refresh player stats at 3:30 AM ET (8:30 AM UTC) daily
30 8 * * * cd /path/to/your/project && /usr/bin/node scripts/cache-refresh.js --job player_stats

# Refresh all caches at 5:30 AM ET (10:30 AM UTC) daily
30 10 * * * cd /path/to/your/project && /usr/bin/node scripts/cache-refresh.js

# Optional: Refresh odds more frequently during game season
*/17 * * * * cd /path/to/your/project && /usr/bin/node scripts/cache-refresh.js --job odds
```

### Option 2: GitHub Actions (Recommended for Vercel)

Create `.github/workflows/cache-refresh.yml`:

```yaml
name: Scheduled Cache Refresh

on:
  schedule:
    # Player stats at 3:30 AM ET (8:30 AM UTC)
    - cron: '30 8 * * *'
    # All caches at 5:30 AM ET (10:30 AM UTC)  
    - cron: '30 10 * * *'
  workflow_dispatch: # Allow manual triggering

jobs:
  refresh-cache:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'

      - name: Refresh Player Stats (3:30 AM ET run)
        if: github.event.schedule == '30 8 * * *'
        env:
          CACHE_REFRESH_TOKEN: ${{ secrets.CACHE_REFRESH_TOKEN }}
          CACHE_REFRESH_URL: ${{ secrets.CACHE_REFRESH_URL }}
        run: node scripts/cache-refresh.js --job player_stats

      - name: Refresh All Caches (5:30 AM ET run)
        if: github.event.schedule == '30 10 * * *'
        env:
          CACHE_REFRESH_TOKEN: ${{ secrets.CACHE_REFRESH_TOKEN }}
          CACHE_REFRESH_URL: ${{ secrets.CACHE_REFRESH_URL }}
        run: node scripts/cache-refresh.js

      - name: Manual Refresh (workflow_dispatch)
        if: github.event_name == 'workflow_dispatch'
        env:
          CACHE_REFRESH_TOKEN: ${{ secrets.CACHE_REFRESH_TOKEN }}
          CACHE_REFRESH_URL: ${{ secrets.CACHE_REFRESH_URL }}
        run: node scripts/cache-refresh.js
```

Then add secrets to your GitHub repository:
- `CACHE_REFRESH_TOKEN`: Your secure token
- `CACHE_REFRESH_URL`: Your production URL (e.g., `https://your-app.vercel.app`)

### Option 3: Vercel Cron Jobs

If using Vercel Pro, you can use Vercel Cron Jobs by creating `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/cache/scheduled-refresh",
      "schedule": "30 8 * * *"
    },
    {
      "path": "/api/cache/scheduled-refresh", 
      "schedule": "30 10 * * *"
    }
  ]
}
```

**Note**: You'll need to modify the API endpoint to handle GET requests and extract the token from environment variables for Vercel Cron.

### Option 4: External Cron Services

Use services like:
- **EasyCron**: Web-based cron service
- **cron-job.org**: Free online cron job service
- **AWS CloudWatch Events**: If using AWS infrastructure

Configure them to make POST requests to your API endpoint.

## Monitoring

### Logs

The system provides detailed logging:
- Console logs during execution
- Success/failure status for each job
- Cache statistics after refresh
- Execution duration

### Health Check

Create a simple health check endpoint:

```typescript
// pages/api/cache/health.ts
import { NextApiRequest, NextApiResponse } from 'next';
import { cache } from '@/lib/cache';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const stats = {
    totalKeys: cache.keys().length,
    size: cache.size,
    playerStatsKeys: cache.keys().filter(k => k.startsWith('player_stats_')).length,
    playerSearchKeys: cache.keys().filter(k => k.startsWith('player_search_')).length,
    espnPlayerKeys: cache.keys().filter(k => k.startsWith('espn_player_')).length,
    timestamp: new Date().toISOString()
  };

  res.status(200).json(stats);
}
```

## Cache Refresh Jobs

### Available Jobs

1. **player_stats**: Clears player statistics cache
   - Patterns: `player_stats_*`
   - Frequency: Twice daily (3:30 AM and 5:30 AM ET)

2. **player_search**: Clears player search results cache
   - Patterns: `player_search_*`
   - Frequency: Daily (5:30 AM ET)

3. **espn_player**: Clears ESPN player data cache
   - Patterns: `espn_player_*`
   - Frequency: Daily (5:30 AM ET)

### Custom Jobs

To add new refresh jobs, modify the `REFRESH_JOBS` configuration in `/api/cache/scheduled-refresh.ts`:

```typescript
const REFRESH_JOBS: Record<string, RefreshJobConfig> = {
  // ... existing jobs
  
  custom_job: {
    name: 'Custom Job',
    enabled: true,
    cacheKeys: ['custom_*'],
    refreshFunction: async () => {
      // Custom refresh logic here
      console.log('Running custom refresh job');
    }
  }
};
```

## Troubleshooting

### Common Issues

1. **401 Unauthorized**: Check that `CACHE_REFRESH_TOKEN` is set correctly
2. **404 Not Found**: Ensure the API endpoint exists and the URL is correct
3. **Timeout**: Large cache refreshes may take time; consider increasing timeout
4. **Cron not running**: Verify cron service is active and paths are absolute

### Debug Mode

Run with additional logging:

```bash
# Enable debug mode
DEBUG=1 node scripts/cache-refresh.js --dry-run
```

### Testing

Test the API endpoint directly:

```bash
curl -X POST http://localhost:3000/api/cache/scheduled-refresh \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-token-here" \
  -d '{"dryRun": true}'
```

## Performance Considerations

- **Batch Operations**: The system clears cache entries rather than pre-warming them to avoid long execution times
- **Rate Limiting**: Consider implementing rate limiting for the refresh endpoint
- **Memory Usage**: Monitor memory usage during large cache operations
- **Network Timeouts**: Set appropriate timeouts for external API calls

## Security

- **Token Security**: Keep the refresh token secure and rotate it periodically
- **Endpoint Protection**: The API endpoint requires authentication
- **Access Logs**: Monitor access to the refresh endpoint
- **Environment Isolation**: Use different tokens for development and production

This system provides a robust, scalable solution for keeping your NBA stats dashboard cache fresh while minimizing server load and API costs.