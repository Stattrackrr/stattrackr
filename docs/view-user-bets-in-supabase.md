perfect# How to View User Bets in Supabase

## Accessing Supabase Dashboard

1. Go to your Supabase project dashboard: https://supabase.com/dashboard
2. Select your project
3. Navigate to **Table Editor** or **SQL Editor**

## Tables to Check

### 1. `tracked_props` - Watchlist/Tracked Bets
Contains bets that users are tracking (watchlist)

### 2. `bets` - Journal Bets
Contains bets that users have added to their journal

## Finding a User's ID

First, find the user's ID from their email:

```sql
-- Find user by email
SELECT id, email, created_at
FROM auth.users
WHERE email = 'user@example.com';
```

Or list all users:

```sql
-- List all users
SELECT id, email, created_at, last_sign_in_at
FROM auth.users
ORDER BY created_at DESC;
```

## Viewing Tracked Props (Watchlist)

### View all tracked props for a specific user:

```sql
-- Replace 'USER_ID_HERE' with the actual user ID
SELECT 
  id,
  player_name,
  team,
  opponent,
  stat_type,
  line,
  over_under,
  game_date,
  status,
  result,
  actual_value,
  created_at,
  updated_at
FROM tracked_props
WHERE user_id = 'USER_ID_HERE'
ORDER BY game_date DESC, created_at DESC;
```

### View by email (join with auth.users):

```sql
-- View tracked props by user email
SELECT 
  tp.id,
  u.email,
  tp.player_name,
  tp.team,
  tp.opponent,
  tp.stat_type,
  tp.line,
  tp.over_under,
  tp.game_date,
  tp.status,
  tp.result,
  tp.actual_value,
  tp.created_at
FROM tracked_props tp
JOIN auth.users u ON tp.user_id = u.id
WHERE u.email = 'user@example.com'
ORDER BY tp.game_date DESC, tp.created_at DESC;
```

### View completed tracked props with results:

```sql
-- View completed tracked props with results
SELECT 
  u.email,
  tp.player_name,
  tp.team,
  tp.opponent,
  tp.stat_type,
  tp.over_under,
  tp.line,
  tp.actual_value,
  tp.result,
  tp.game_date
FROM tracked_props tp
JOIN auth.users u ON tp.user_id = u.id
WHERE tp.status = 'completed'
  AND tp.result IS NOT NULL
ORDER BY tp.game_date DESC;
```

## Viewing Journal Bets

### View all journal bets for a specific user:

```sql
-- Replace 'USER_ID_HERE' with the actual user ID
SELECT 
  id,
  date,
  sport,
  market,
  selection,
  stake,
  currency,
  odds,
  result,
  player_name,
  team,
  opponent,
  stat_type,
  line,
  over_under,
  actual_value,
  status,
  created_at,
  updated_at
FROM bets
WHERE user_id = 'USER_ID_HERE'
ORDER BY date DESC, created_at DESC;
```

### View by email (join with auth.users):

```sql
-- View journal bets by user email
SELECT 
  b.id,
  u.email,
  b.date,
  b.sport,
  b.market,
  b.selection,
  b.stake,
  b.currency,
  b.odds,
  b.result,
  b.player_name,
  b.team,
  b.opponent,
  b.stat_type,
  b.line,
  b.over_under,
  b.actual_value,
  b.status,
  b.created_at
FROM bets b
JOIN auth.users u ON b.user_id = u.id
WHERE u.email = 'user@example.com'
ORDER BY b.date DESC, b.created_at DESC;
```

### View completed journal bets with results:

```sql
-- View completed journal bets with results
SELECT 
  u.email,
  b.date,
  b.sport,
  b.market,
  b.selection,
  b.player_name,
  b.team,
  b.opponent,
  b.stat_type,
  b.over_under,
  b.line,
  b.actual_value,
  b.result,
  b.stake,
  b.odds
FROM bets b
JOIN auth.users u ON b.user_id = u.id
WHERE b.status = 'completed'
  AND b.result IS NOT NULL
ORDER BY b.date DESC;
```

## Summary Queries

### Get user betting summary:

```sql
-- Get betting summary for a user
SELECT 
  u.email,
  COUNT(DISTINCT tp.id) as tracked_props_count,
  COUNT(DISTINCT CASE WHEN tp.status = 'completed' THEN tp.id END) as completed_tracked,
  COUNT(DISTINCT CASE WHEN tp.result = 'win' THEN tp.id END) as tracked_wins,
  COUNT(DISTINCT CASE WHEN tp.result = 'loss' THEN tp.id END) as tracked_losses,
  COUNT(DISTINCT b.id) as journal_bets_count,
  COUNT(DISTINCT CASE WHEN b.status = 'completed' THEN b.id END) as completed_journal,
  COUNT(DISTINCT CASE WHEN b.result = 'win' THEN b.id END) as journal_wins,
  COUNT(DISTINCT CASE WHEN b.result = 'loss' THEN b.id END) as journal_losses
FROM auth.users u
LEFT JOIN tracked_props tp ON u.id = tp.user_id
LEFT JOIN bets b ON u.id = b.user_id
WHERE u.email = 'user@example.com'
GROUP BY u.email;
```

### View all users' betting activity:

```sql
-- View all users' betting activity summary
SELECT 
  u.email,
  u.created_at as user_created,
  COUNT(DISTINCT tp.id) as tracked_props,
  COUNT(DISTINCT b.id) as journal_bets,
  COUNT(DISTINCT CASE WHEN tp.result = 'win' OR b.result = 'win' THEN 1 END) as total_wins,
  COUNT(DISTINCT CASE WHEN tp.result = 'loss' OR b.result = 'loss' THEN 1 END) as total_losses
FROM auth.users u
LEFT JOIN tracked_props tp ON u.id = tp.user_id
LEFT JOIN bets b ON u.id = b.user_id
GROUP BY u.id, u.email, u.created_at
ORDER BY u.created_at DESC;
```

## Using Table Editor (GUI)

1. Go to **Table Editor** in Supabase dashboard
2. Select the `tracked_props` or `bets` table
3. Use the filter button to filter by `user_id`
4. Or use the search to find specific players/teams

**Note:** Row Level Security (RLS) is enabled, so you may need to:
- Use the SQL Editor with service role key (bypasses RLS)
- Or temporarily disable RLS for admin queries (not recommended for production)

## Important Notes

- **Row Level Security (RLS)**: Users can only see their own bets by default
- To view all users' bets as admin, use the SQL Editor (which uses service role key)
- The `user_id` is a UUID from `auth.users` table
- `status` can be: `'pending'`, `'completed'`, `'void'`
- `result` can be: `'win'`, `'loss'`, `'void'`, `'pending'`

