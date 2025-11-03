# Dashboard Paywall Integration Checklist

Quick reference for adding paywall to `app/nba/research/dashboard/page.tsx`

## Step 1: Add Imports (Top of File)

Add these imports after line 23:

```tsx
import { useSubscription } from '@/hooks/useSubscription';
import PaywallModal from '@/components/PaywallModal';
```

## Step 2: Add Hook (Inside Component)

Around line 3700, after your other hooks, add:

```tsx
const { 
  hasPremium, 
  checkFeatureAccess, 
  showPaywall, 
  closePaywall,
  triggerPaywall 
} = useSubscription();
```

## Step 3: Protect Advanced Stats (Line ~4851)

Replace the `fetchAdvancedStats` function:

```tsx
const fetchAdvancedStats = async (playerId: string) => {
  // 🔒 PAYWALL CHECK
  if (!checkFeatureAccess('premium')) {
    return;
  }
  
  setAdvancedStatsLoading(true);
  setAdvancedStatsError(null);
  try {
    const stats = await fetchAdvancedStatsCore(playerId);
    
    if (stats) {
      setAdvancedStats(stats);
    } else {
      setAdvancedStats(null);
      setAdvancedStatsError('No advanced stats found for this player');
    }
  } catch (error: any) {
    setAdvancedStatsError(error.message || 'Failed to fetch advanced stats');
    setAdvancedStats(null);
  } finally {
    setAdvancedStatsLoading(false);
  }
};
```

## Step 4: Protect Shot Charts (Line ~4872)

Replace the `fetchShotDistanceStats` function:

```tsx
const fetchShotDistanceStats = async (playerId: string) => {
  // 🔒 PAYWALL CHECK
  if (!checkFeatureAccess('premium')) {
    return;
  }
  
  setShotDistanceLoading(true);
  try {
    const season = currentNbaSeason();
    const response = await fetch(`/api/bdl/shot-distance?player_id=${playerId}&season=${season}`);
    const data = await response.json();
    
    if (data && Array.isArray(data.data) && data.data.length > 0) {
      setShotDistanceData(data.data[0].stats);
    } else {
      setShotDistanceData(null);
    }
  } catch (error) {
    console.error('Failed to fetch shot distance stats:', error);
    setShotDistanceData(null);
  } finally {
    setShotDistanceLoading(false);
  }
};
```

## Step 5: Add Paywall Modal (End of Component)

Find the very end of your component's return statement (around line 5800+) and add the modal before the final closing tags:

```tsx
return (
  <Suspense fallback={<div>Loading...</div>}>
    <div className="min-h-screen bg-[var(--brand-bg)] text-[var(--brand-fg)]">
      {/* All your existing content */}
      
      {/* 🔒 ADD THIS AT THE END */}
      <PaywallModal
        isOpen={showPaywall}
        onClose={closePaywall}
        title="Upgrade to Premium"
        description="Access advanced stats, shot charts, and unlimited player research with Premium."
      />
      
      {/* Track Player Modal */}
      <TrackPlayerModal
        isOpen={showTrackModal}
        onClose={() => setShowTrackModal(false)}
        selectedPlayer={selectedPlayer}
      />
      
      {/* Add to Journal Modal */}
      <AddToJournalModal
        isOpen={showJournalModal}
        onClose={() => setShowJournalModal(false)}
        selectedPlayer={selectedPlayer}
        selectedStat={selectedStat}
        bettingLine={bettingLines[selectedStat] || 0}
      />
    </div>
  </Suspense>
);
```

## Step 6: Add Premium Badges (Optional but Recommended)

### Option A: Badge on Advanced Stats Section

Find your Advanced Stats section and add a badge:

```tsx
<div className="flex items-center justify-between mb-4">
  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
    Advanced Stats
  </h3>
  {!hasPremium && (
    <button
      onClick={triggerPaywall}
      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-gradient-to-r from-emerald-500 to-emerald-600 rounded-full hover:from-emerald-600 hover:to-emerald-700 transition-all shadow-lg animate-pulse"
    >
      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
      </svg>
      Premium
    </button>
  )}
</div>
```

### Option B: Blur Advanced Stats for Free Users

Wrap your advanced stats content:

```tsx
<div className="relative">
  {/* Your advanced stats content */}
  <div className={!hasPremium ? 'filter blur-md pointer-events-none' : ''}>
    {/* Advanced stats display */}
  </div>
  
  {/* Overlay for free users */}
  {!hasPremium && (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-b from-transparent via-white/80 to-white dark:via-slate-900/80 dark:to-slate-900">
      <div className="text-center p-6 bg-white/90 dark:bg-slate-800/90 rounded-2xl shadow-2xl backdrop-blur-sm border border-emerald-200 dark:border-emerald-800">
        <div className="w-16 h-16 mx-auto mb-4 bg-gradient-to-br from-emerald-400 to-emerald-600 rounded-full flex items-center justify-center shadow-lg">
          <svg className="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
          </svg>
        </div>
        <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
          Premium Feature
        </h3>
        <p className="text-gray-600 dark:text-gray-400 mb-4 max-w-xs">
          Unlock advanced stats including PER, TS%, USG%, and more
        </p>
        <button
          onClick={triggerPaywall}
          className="px-6 py-3 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white font-semibold rounded-lg hover:from-emerald-600 hover:to-emerald-700 transition-all shadow-lg transform hover:scale-105"
        >
          Upgrade to Premium
        </button>
      </div>
    </div>
  )}
</div>
```

## Testing

### Test as Free User:
1. Clear browser storage
2. Log in with a test account (no subscription)
3. Try to view advanced stats → Should show paywall
4. Try to view shot charts → Should show paywall

### Test as Premium User:
Run this in Supabase SQL Editor:

```sql
UPDATE auth.users 
SET raw_user_meta_data = raw_user_meta_data || 
  '{"subscription_status": "active", "subscription_plan": "Premium"}'::jsonb
WHERE email = 'your-email@example.com';
```

Then refresh the page - advanced features should work!

## Summary

✅ **Required Changes:**
1. Import hook and modal
2. Add `useSubscription()` hook
3. Add paywall checks to `fetchAdvancedStats` and `fetchShotDistanceStats`
4. Add `<PaywallModal>` component

⚡ **Optional but Recommended:**
- Add "Premium" badges to locked features
- Blur/overlay locked content
- Add upgrade buttons throughout the UI

That's it! Your paywall is now protecting your premium features. 🎉
