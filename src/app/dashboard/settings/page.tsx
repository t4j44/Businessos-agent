'use client';

import { useState, useEffect, useCallback } from 'react';
import { Settings, User, Bell, Key, Plug, Shield, Check, RefreshCw } from 'lucide-react';

const SECTIONS = ['Profile', 'Notifications', 'Integrations', 'API Keys', 'Security'] as const;
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
}

function SectionNav({ active, onChange }: { active: Section; onChange: (s: Section) => void }) {
  const ICONS: Record<Section, React.ElementType> = {
    Profile:       User,
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
                ? 'bg-[#2563EB]/15 text-[#2563EB] font-medium'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'
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
      className={`relative w-10 h-5 rounded-full transition-colors disabled:opacity-50 ${checked ? 'bg-[#2563EB]' : 'bg-slate-700'}`}
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

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/dashboard/settings');
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setProfile(json.profile);
      setNotifications(json.notifications || {});
      setIntegrations(json.integrations || []);
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
        <div className="h-8 w-40 bg-slate-800 rounded mb-6 animate-pulse" />
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          <div className="h-72 rounded-xl border border-slate-700/50 bg-[#1E293B] animate-pulse" />
          <div className="lg:col-span-3 h-72 rounded-xl border border-slate-700/50 bg-[#1E293B] animate-pulse" />
        </div>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="p-6 text-slate-200">
        <div className="bg-[#1E293B] rounded-xl border border-slate-700/50 p-6">
          <p className="text-sm text-red-400">Couldn&apos;t load settings — {error ?? 'no data returned'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 text-slate-200">
      <h1 className="text-2xl font-bold text-white mb-6 flex items-center gap-2">
        <Settings className="w-6 h-6 text-slate-400" />
        Settings
      </h1>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">

        {/* Sidebar nav */}
        <div className="bg-[#1E293B] rounded-xl border border-slate-700/50 p-3 h-fit">
          <SectionNav active={activeSection} onChange={setActiveSection} />
        </div>

        {/* Content panel */}
        <div className="lg:col-span-3 bg-[#1E293B] rounded-xl border border-slate-700/50 p-6">

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
                    <label className="block text-xs font-medium text-slate-400 mb-1.5">{label}</label>
                    <input
                      type={type}
                      value={profile[field]}
                      placeholder={placeholder}
                      onChange={(e) => setProfile((p) => p ? ({ ...p, [field]: e.target.value }) : p)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:border-[#2563EB] focus:outline-none transition-colors"
                    />
                  </div>
                ))}
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">Timezone</label>
                  <select
                    value={profile.timezone}
                    onChange={(e) => setProfile((p) => p ? ({ ...p, timezone: e.target.value }) : p)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:border-[#2563EB] focus:outline-none"
                  >
                    {TIMEZONES.map((tz) => (
                      <option key={tz} value={tz}>{tz}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="pt-4 border-t border-slate-700/50 flex items-center justify-end gap-4">
                {saveError && <p className="text-xs text-red-400">{saveError}</p>}
                <button
                  onClick={handleSaveProfile}
                  disabled={saving}
                  className="flex items-center gap-2 px-5 py-2 bg-[#2563EB] hover:bg-blue-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : saved ? <Check className="w-4 h-4" /> : null}
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
                  <div key={key} className="flex items-center justify-between py-3 border-b border-slate-700/40 last:border-0">
                    <div>
                      <p className="text-slate-200 text-sm font-medium">{title}</p>
                      <p className="text-slate-500 text-xs mt-0.5">{desc}</p>
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
                <p className="text-slate-500 text-xs mt-1">
                  Status reflects which API credentials are configured on this deployment.
                </p>
              </div>
              <div className="space-y-3">
                {integrations.map((intg) => (
                  <div key={intg.name} className="flex items-center gap-4 p-4 rounded-xl bg-slate-800/40 border border-slate-700/50">
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${intg.connected ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                    <div className="flex-1">
                      <p className="text-slate-200 text-sm font-medium">{intg.name}</p>
                      <p className="text-slate-500 text-xs">{intg.desc}</p>
                    </div>
                    <span className={`text-xs font-medium ${intg.connected ? 'text-emerald-400' : 'text-slate-500'}`}>
                      {intg.connected ? 'connected' : 'not configured'}
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
              <div className="flex flex-col items-center gap-3 px-6 py-14 text-center rounded-xl bg-slate-800/40 border border-slate-700/50">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#2563EB]/10">
                  <Key className="h-6 w-6 text-[#2563EB]" />
                </div>
                <p className="text-sm text-slate-300">No API keys yet.</p>
                <p className="text-xs text-slate-500 max-w-sm">
                  Programmatic access isn&apos;t available on your account yet. Keys you
                  issue will be listed here.
                </p>
              </div>
            </div>
          )}

          {/* Security */}
          {activeSection === 'Security' && (
            <div className="space-y-6">
              <h2 className="text-white font-semibold">Security</h2>
              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-slate-800/40 border border-slate-700/50">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-slate-200 text-sm font-medium">Sign out everywhere</p>
                      <p className="text-slate-500 text-xs mt-0.5">
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

                <div className="p-4 rounded-xl bg-slate-800/40 border border-slate-700/50">
                  <p className="text-slate-200 text-sm font-medium">Sign-in method</p>
                  <p className="text-slate-500 text-xs mt-0.5">
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
