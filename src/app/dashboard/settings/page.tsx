'use client';

import { useState, useEffect, useCallback } from 'react';
import { Settings, User, Bell, Key, Plug, Shield, Check, RefreshCw, Sparkles } from 'lucide-react';
import { Pending, Skeleton, SkeletonCard } from '@/components/ui/Skeleton';

const SECTIONS = ['Profile', 'Brand', 'Notifications', 'Integrations', 'API Keys', 'Security'] as const;
type Section = typeof SECTIONS[number];

const NOTIFICATION_LABELS: Record<string, [string, string]> = {
  hotLead:        ['Hot Lead Detected',     'When a lead score exceeds 80 or replies with intent'],
  demoBooked:     ['Demo Booked',           'When the receptionist or Hunter books a meeting'],
  reviewAlert:    ['Negative Review Alert', 'When a 1 or 2-star review is received'],
  weeklyBrief:    ['Monday WARE Brief',     'Weekly performance summary every Monday morning'],
  agentFailure:   ['Agent Failure Alert',   'When any agent run fails or exceeds error threshold'],
  approvalNeeded: ['Approval Required',     'When an agent action needs your approval to proceed'],
};

const TIMEZONES = [
  'UTC', 'America/New_York', 'America/Chicago', 'America/Los_Angeles',
  'Europe/London', 'Asia/Karachi', 'Asia/Dubai', 'Asia/Singapore',
];

interface Profile {
  name: string;
  email: string;
  company: string;
  website: string;
  timezone: string;
}

interface Integration {
  name: string;
  desc: string;
  connected: boolean;
  configured?: boolean;
  /** Whether any code calls this provider. False means the key does nothing. */
  wired?: boolean;
}

function SectionNav({ active, onChange }: { active: Section; onChange: (s: Section) => void }) {
  const ICONS: Record<Section, React.ElementType> = {
    Profile:       User,
    Brand:         Sparkles,
    Notifications: Bell,
    Integrations:  Plug,
    'API Keys':    Key,
    Security:      Shield,
  };
  return (
    <nav className="space-y-0.5">
      {SECTIONS.map((s) => {
        const Icon = ICONS[s];
        return (
          <button
            key={s}
            onClick={() => onChange(s)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
              active === s
                ? 'bg-accent/15 text-accent font-medium'
                : 'text-muted hover:text-text hover:bg-line/50'
            }`}
          >
            <Icon className="w-4 h-4" />
            {s}
          </button>
        );
      })}
    </nav>
  );
}

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      disabled={disabled}
      className={`relative w-10 h-5 rounded-full transition-colors disabled:opacity-50 ${checked ? 'bg-accent' : 'bg-line'}`}
    >
      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${checked ? 'left-5' : 'left-0.5'}`} />
    </button>
  );
}

export default function SettingsPage() {
  const [activeSection, setActiveSection] = useState<Section>('Profile');

  const [profile, setProfile] = useState<Profile | null>(null);
  const [notifications, setNotifications] = useState<Record<string, boolean>>({});
  const [integrations, setIntegrations] = useState<Integration[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  // Brand voice, stored on brand_profiles rather than clients.
  const [brand, setBrand] = useState<{ icp_summary: string; tone_description: string }>({
    icp_summary: '',
    tone_description: '',
  });
  const [planTier, setPlanTier] = useState('starter');
  const [website, setWebsite] = useState('');
  const [brandSaving, setBrandSaving] = useState(false);
  const [brandSaved, setBrandSaved] = useState(false);
  const [brandError, setBrandError] = useState<string | null>(null);
  const [rescanning, setRescanning] = useState(false);
  const [rescanDone, setRescanDone] = useState(false);
  const [clientId, setClientId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/dashboard/settings');
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setProfile(json.profile);
      setNotifications(json.notifications || {});
      setIntegrations(json.integrations || []);
      setBrand({
        icp_summary: json.brand?.icp_summary || '',
        tone_description: json.brand?.tone_description || '',
      });
      setPlanTier(json.plan_tier || 'starter');
      setWebsite(json.profile?.website || '');
      setClientId(json.client_id || null);
      setError(null);
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const persist = async (payload: Record<string, any>) => {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch('/api/dashboard/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      return true;
    } catch (err: any) {
      setSaveError(err?.message || String(err));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleSaveProfile = () => profile && persist({ profile });

  // Brand voice writes to brand_profiles, which /api/dashboard/settings does
  // not touch — /api/settings/update spans both tables.
  const saveBrand = async () => {
    setBrandSaving(true);
    setBrandError(null);
    setBrandSaved(false);
    try {
      const res = await fetch('/api/settings/update', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          icp_summary: brand.icp_summary,
          tone_description: brand.tone_description,
          url: website,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setBrandSaved(true);
      setTimeout(() => setBrandSaved(false), 3000);
    } catch (err: any) {
      setBrandError(err?.message || String(err));
    } finally {
      setBrandSaving(false);
    }
  };

  const reanalyzeBrand = async () => {
    if (!website || !clientId) {
      setBrandError('A website URL is required before Brand Scout can run.');
      return;
    }
    setRescanning(true);
    setBrandError(null);
    setRescanDone(false);
    try {
      const res = await fetch('/api/agents/brand-scout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // No client_id: brand-scout reads only `url` and takes the tenant
        // from the session.
        body: JSON.stringify({ url: website }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setRescanDone(true);
      setTimeout(() => setRescanDone(false), 3000);
      load();
    } catch (err: any) {
      setBrandError(err?.message || String(err));
    } finally {
      setRescanning(false);
    }
  };

  const handleToggleNotification = async (key: string, value: boolean) => {
    const previous = notifications;
    setNotifications((n) => ({ ...n, [key]: value }));
    const ok = await persist({ notifications: { [key]: value } });
    if (!ok) setNotifications(previous);
  };

  const handleSignOutEverywhere = async () => {
    setSigningOut(true);
    try {
      const { createBrowserClient } = await import('@supabase/ssr');
      const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      );
      await supabase.auth.signOut({ scope: 'global' });
      window.location.href = '/login';
    } catch (err: any) {
      setSaveError(err?.message || String(err));
      setSigningOut(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6">
        <Skeleton className="mb-6 h-8 w-40" />
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          <div className="space-y-1.5 rounded-lg bg-surface/60 p-2">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}
          </div>
          <SkeletonCard className="lg:col-span-3" rows={5} />
        </div>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="p-6 text-text">
        <div className="rounded-lg bg-surface/60 p-6">
          <p className="text-sm text-red-400">Couldn&apos;t load settings — {error ?? 'no data returned'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 text-text">
      <h1 className="text-[32px] font-semibold leading-10 tracking-tight text-text mb-6 flex items-center gap-2">
        <Settings className="w-6 h-6 text-muted" />
        Settings
      </h1>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">

        {/* Sidebar nav */}
        <div className="rounded-lg bg-surface/60 p-3 h-fit">
          <SectionNav active={activeSection} onChange={setActiveSection} />
        </div>

        {/* Content panel */}
        <div className="lg:col-span-3 bg-surface rounded-xl border border-line/50 p-6">

          {/* Profile */}
          {activeSection === 'Profile' && (
            <div className="space-y-6">
              <h2 className="text-white font-semibold">Profile Settings</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {([
                  ['Full Name', 'name',    'text',  'Your name'],
                  ['Email',     'email',   'email', 'you@company.com'],
                  ['Company',   'company', 'text',  'Your business name'],
                  ['Website',   'website', 'url',   'https://yourbusiness.com'],
                ] as const).map(([label, field, type, placeholder]) => (
                  <div key={field}>
                    <label className="block text-xs font-medium text-muted mb-1.5">{label}</label>
                    <input
                      type={type}
                      value={profile[field]}
                      placeholder={placeholder}
                      onChange={(e) => setProfile((p) => p ? ({ ...p, [field]: e.target.value }) : p)}
                      className="w-full bg-surface border border-line rounded-lg px-3 py-2 text-sm text-text placeholder-faint focus:border-accent focus:outline-none transition-colors"
                    />
                  </div>
                ))}
                <div>
                  <label className="block text-xs font-medium text-muted mb-1.5">Timezone</label>
                  <select
                    value={profile.timezone}
                    onChange={(e) => setProfile((p) => p ? ({ ...p, timezone: e.target.value }) : p)}
                    className="w-full bg-surface border border-line rounded-lg px-3 py-2 text-sm text-text focus:border-accent focus:outline-none"
                  >
                    {TIMEZONES.map((tz) => (
                      <option key={tz} value={tz}>{tz}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="pt-4 border-t border-line/50 flex items-center justify-end gap-4">
                {saveError && <p className="text-xs text-red-400">{saveError}</p>}
                <button
                  onClick={handleSaveProfile}
                  disabled={saving}
                  className="flex items-center gap-2 px-5 py-2 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  {saving ? <Pending /> : saved ? <Check className="w-4 h-4" /> : null}
                  {saved ? 'Saved!' : saving ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </div>
          )}

          {/* Notifications */}
          {activeSection === 'Notifications' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-white font-semibold">Notification Preferences</h2>
                {saveError && <p className="text-xs text-red-400 mt-1">{saveError}</p>}
              </div>
              <div className="space-y-4">
                {Object.entries(NOTIFICATION_LABELS).map(([key, [title, desc]]) => (
                  <div key={key} className="flex items-center justify-between py-3 border-b border-line/40 last:border-0">
                    <div>
                      <p className="text-text text-sm font-medium">{title}</p>
                      <p className="text-dim text-xs mt-0.5">{desc}</p>
                    </div>
                    <Toggle
                      checked={!!notifications[key]}
                      disabled={saving}
                      onChange={(v) => handleToggleNotification(key, v)}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Integrations */}
          {activeSection === 'Integrations' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-white font-semibold">Connected Integrations</h2>
                <p className="text-dim text-xs mt-1">
                  Status reflects which providers this build actually calls, and which credentials are configured. "Not built yet" means adding a key changes nothing.
                </p>
              </div>
              <div className="space-y-3">
                {integrations.map((intg) => (
                  <div key={intg.name} className="flex items-center gap-4 p-4 rounded-xl bg-raised/40 border border-line/50">
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${intg.connected ? 'bg-emerald-400' : 'bg-line-strong'}`} />
                    <div className="flex-1">
                      <p className="text-text text-sm font-medium">{intg.name}</p>
                      <p className="text-dim text-xs">{intg.desc}</p>
                    </div>
                    <span className={`text-xs font-medium ${intg.connected ? 'text-emerald-400' : 'text-dim'}`}>
                      {intg.wired === false
                        ? 'Not built yet'
                        : intg.connected
                          ? 'Verified connection'
                          : intg.configured
                            ? 'Configured · verification needed'
                            : 'Not configured'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* API Keys */}
          {activeSection === 'API Keys' && (
            <div className="space-y-6">
              <h2 className="text-white font-semibold">API Keys</h2>
              <div className="flex flex-col items-center gap-3 px-6 py-14 text-center rounded-xl bg-raised/40 border border-line/50">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent/10">
                  <Key className="h-6 w-6 text-accent" />
                </div>
                <p className="text-sm text-muted">No API keys yet.</p>
                <p className="text-xs text-dim max-w-sm">
                  Programmatic access isn&apos;t available on your account yet. Keys you
                  issue will be listed here.
                </p>
              </div>
            </div>
          )}

          {/* Brand */}
          {activeSection === 'Brand' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-white font-semibold">Brand</h2>
                <span className="inline-flex items-center gap-2 text-xs text-dim">
                  Plan
                  <span className="rounded-full border border-accent/25 bg-accent/10 px-2 py-0.5 font-semibold uppercase tracking-wide text-accent">
                    {planTier}
                  </span>
                  <a href="/dashboard/billing" className="text-accent hover:underline">
                    Change
                  </a>
                </span>
              </div>

              <div className="space-y-4">
                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-dim">Website URL</span>
                  <input
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                    placeholder="https://yourbusiness.com"
                    className="w-full rounded-lg border border-line bg-raised px-3 py-2 text-sm text-text placeholder:text-faint focus:border-accent/50 focus:outline-none"
                  />
                </label>

                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-dim">Who you sell to (ICP)</span>
                  <textarea
                    rows={3}
                    value={brand.icp_summary}
                    onChange={(e) => setBrand({ ...brand, icp_summary: e.target.value })}
                    placeholder="e.g. dental clinic owners in the US"
                    className="w-full rounded-lg border border-line bg-raised px-3 py-2 text-sm text-text placeholder:text-faint focus:border-accent/50 focus:outline-none"
                  />
                </label>

                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-dim">Brand tone</span>
                  <textarea
                    rows={3}
                    value={brand.tone_description}
                    onChange={(e) => setBrand({ ...brand, tone_description: e.target.value })}
                    placeholder="How your brand sounds"
                    className="w-full rounded-lg border border-line bg-raised px-3 py-2 text-sm text-text placeholder:text-faint focus:border-accent/50 focus:outline-none"
                  />
                </label>

                {brandError && <p className="text-xs text-crit">{brandError}</p>}
                {brandSaved && <p className="text-xs text-good">Settings saved.</p>}
                {rescanDone && <p className="text-xs text-good">Brand DNA updated.</p>}

                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={saveBrand}
                    disabled={brandSaving}
                    className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {brandSaving ? 'Saving…' : 'Save changes'}
                  </button>

                  <button
                    onClick={reanalyzeBrand}
                    disabled={rescanning || !website}
                    title={website ? undefined : 'Add a website URL first'}
                    className="inline-flex items-center gap-2 rounded-lg border border-line bg-transparent px-4 py-2 text-sm font-medium text-muted transition-colors hover:border-line-strong hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {rescanning ? 'Analyzing…' : 'Re-analyze Brand'}
                  </button>
                </div>
                {rescanning && (
                  <p className="text-xs text-dim">
                    Brand Scout is reading your website — this takes about 20 seconds.
                  </p>
                )}
              </div>

              {/* Danger zone */}
              <div className="rounded-lg border border-crit/25 bg-crit/5 p-4">
                <p className="text-sm font-semibold text-crit">Danger zone</p>
                <p className="mt-1 text-sm text-muted">
                  To cancel your subscription or delete your account, contact support.
                </p>
              </div>
            </div>
          )}

          {/* Security */}
          {activeSection === 'Security' && (
            <div className="space-y-6">
              <h2 className="text-white font-semibold">Security</h2>
              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-raised/40 border border-line/50">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-text text-sm font-medium">Sign out everywhere</p>
                      <p className="text-dim text-xs mt-0.5">
                        Ends every active session for your account on all devices.
                      </p>
                    </div>
                    <button
                      onClick={handleSignOutEverywhere}
                      disabled={signingOut}
                      className="px-3 py-1.5 text-xs font-medium border border-red-500/20 text-red-400 rounded-lg hover:bg-red-500/10 disabled:opacity-50 transition-colors"
                    >
                      {signingOut ? 'Signing out…' : 'Sign out all'}
                    </button>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-raised/40 border border-line/50">
                  <p className="text-text text-sm font-medium">Sign-in method</p>
                  <p className="text-dim text-xs mt-0.5">
                    Your account uses passwordless magic links and Google sign-in. There
                    is no password to rotate.
                  </p>
                </div>

                {saveError && <p className="text-xs text-red-400">{saveError}</p>}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
