export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const runtime = 'nodejs';

type Master = { positions: Record<string,'PG'|'SG'|'SF'|'PF'|'C'>, aliases: Record<string,string> };
const filePath = () => path.resolve(process.cwd(), 'data', 'player_positions', 'master.json');
const ensureDir = (p: string) => { const d = path.dirname(p); if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); };
const load = (): Master => { try { const p = filePath(); if (!fs.existsSync(p)) return { positions: {}, aliases: {} }; return JSON.parse(fs.readFileSync(p,'utf8')); } catch { return { positions: {}, aliases: {} }; } };
const save = (m: Master) => { try { const p = filePath(); ensureDir(p); fs.writeFileSync(p, JSON.stringify(m, null, 2)); } catch {} };
const norm = (s: string) => String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z\s]/g,' ').replace(/\b(jr|sr|ii|iii|iv|v)\b/g,' ').replace(/\s+/g,' ').trim();

export async function GET(req: NextRequest){
  try {
    // Authentication check - admin only
    const { authorizeAdminRequest } = await import('@/lib/adminAuth');
    const authResult = await authorizeAdminRequest(req);
    if (!authResult.authorized) {
      return authResult.response;
    }

    // Rate limiting
    const { checkRateLimit, apiRateLimiter } = await import('@/lib/rateLimit');
    const rateResult = checkRateLimit(req, apiRateLimiter);
    if (!rateResult.allowed && rateResult.response) {
      return rateResult.response;
    }

    const m = load();
    return NextResponse.json({ success: true, positions: m.positions, aliases: m.aliases });
  } catch (error: any) {
    console.error('[Player Positions GET] Error:', error);
    const isProduction = process.env.NODE_ENV === 'production';
    return NextResponse.json(
      { 
        success: false, 
        error: isProduction 
          ? 'An error occurred. Please try again later.' 
          : (error.message || 'Failed to load positions')
      },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest){
  try{
    // Authentication check - admin only
    const { authorizeAdminRequest } = await import('@/lib/adminAuth');
    const authResult = await authorizeAdminRequest(req);
    if (!authResult.authorized) {
      return authResult.response;
    }

    // Rate limiting
    const { checkRateLimit, strictRateLimiter } = await import('@/lib/rateLimit');
    const rateResult = checkRateLimit(req, strictRateLimiter);
    if (!rateResult.allowed && rateResult.response) {
      return rateResult.response;
    }
    const { name, pos, alias } = await req.json();
    const p = String(pos||'').toUpperCase();
    if (!name || !['PG','SG','SF','PF','C'].includes(p)) return NextResponse.json({ success:false, error:'name and pos required' }, { status: 400 });
    const m = load();
    m.positions[norm(name)] = p as any;
    if (alias && typeof alias === 'string') m.aliases[norm(alias)] = norm(name);
    save(m);
    return NextResponse.json({ success:true });
  }catch(e:any){
    console.error('[Player Positions PUT] Error:', e);
    const isProduction = process.env.NODE_ENV === 'production';
    return NextResponse.json(
      { 
        success: false, 
        error: isProduction 
          ? 'An error occurred. Please try again later.' 
          : (e?.message || 'bad request')
      },
      { status: 400 }
    );
  }
}

export async function DELETE(req: NextRequest){
  try{
    // Authentication check - admin only
    const { authorizeAdminRequest } = await import('@/lib/adminAuth');
    const authResult = await authorizeAdminRequest(req);
    if (!authResult.authorized) {
      return authResult.response;
    }

    // Rate limiting
    const { checkRateLimit, strictRateLimiter } = await import('@/lib/rateLimit');
    const rateResult = checkRateLimit(req, strictRateLimiter);
    if (!rateResult.allowed && rateResult.response) {
      return rateResult.response;
    }
    const { name } = await req.json();
    if (!name) return NextResponse.json({ success:false, error:'name required' }, { status: 400 });
    const m = load();
    const k = norm(name);
    if (m.positions[k]) delete m.positions[k];
    // also remove any aliases that point to this key
    for (const [ak, to] of Object.entries(m.aliases)) if (to === k) delete m.aliases[ak];
    save(m);
    return NextResponse.json({ success:true });
  }catch(e:any){
    console.error('[Player Positions DELETE] Error:', e);
    const isProduction = process.env.NODE_ENV === 'production';
    return NextResponse.json(
      { 
        success: false, 
        error: isProduction 
          ? 'An error occurred. Please try again later.' 
          : (e?.message || 'bad request')
      },
      { status: 400 }
    );
  }
}
