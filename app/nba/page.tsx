import { redirect } from 'next/navigation';

/** proxy.ts sends /nba to the NBA research dashboard (keeping the query); this is the fallback. */
export default function NbaPage() {
  redirect('/nba/research/dashboard');
}
