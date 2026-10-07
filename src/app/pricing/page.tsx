'use client';

import React, { useState } from 'react';
import { LegalFooter } from '@/components/LegalFooter';

// Only ship a feature name here once the thing exists.
//
// This list sold four agents that have never been built — Sales Agent,
// Contract Generator, Conference Call AI and Scout are all marked "Planned" in
// docs/AGENT_STATUS.md — plus White-label and Multi-client, for which there is
// no code at all (there is not even a client switcher). Taking money for those
// is the problem; the wording below says what each agent actually does today,
// and anything unbuilt is listed separately as not included.
const TIERS = [
  {
    name: 'Starter',
    id: 'starter',
    priceMonthly: 97,
    features: ['Call Center — records and analyses calls', 'AI Scheduler', 'Review replies (drafts)', 'Monday Brief'],
  },
  {
    name: 'Core',
    id: 'core',
    priceMonthly: 197,
    features: ['All Starter features', 'Invoice reminders (drafts — sending coming soon)'],
  },
  {
    name: 'Growth',
    id: 'growth',
    priceMonthly: 397,
    isPopular: true,
    features: ['All Core features', 'Hunter lead discovery', 'Outreach copy (drafts)', 'Creative content (drafts)'],
  },
  {
    name: 'Scale',
    id: 'scale',
    priceMonthly: 797,
    features: ['All Growth features', 'CSV lead import and enrichment', 'Market, Audience and Trend intelligence'],
  },
  {
    name: 'Agency',
    id: 'agency',
    priceMonthly: 1997,
    features: ['Everything above', 'Priority support'],
  }
];

// Named so nobody has to guess whether they are included. Keep this honest
// rather than deleting it: a prospect who was promised these should be able to
// see where they stand.
const NOT_YET_BUILT = [
  'Automatic sending of invoice reminders, review replies, social posts and outbound email — everything above is drafted for your approval',
  'Sales Agent, Contract Generator, Conference Call AI and Scout',
  'White-label and multi-client accounts',
  'CRM, calendar and social publishing integrations (HubSpot, Nylas, Buffer, Instantly)',
];

export default function PricingPage() {
  const [isAnnual, setIsAnnual] = useState(false);
  const [loadingTier, setLoadingTier] = useState<string | null>(null);

  const handleCheckout = async (tierId: string, pilot: boolean) => {
    setLoadingTier(tierId);
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          plan_tier: tierId, 
          billing_period: isAnnual ? 'annual' : 'monthly',
          pilot
        })
      });
      const data = await res.json();
      if (data.checkout_url) {
        window.location.href = data.checkout_url;
      } else {
        alert('Failed to initialize checkout');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingTier(null);
    }
  };

  return (
    <div className="min-h-screen bg-canvas text-text py-16 px-4 font-sans">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-12">
          <h1 className="text-4xl md:text-5xl font-bold text-white mb-4">Simple, transparent pricing</h1>
          <p className="text-lg text-muted max-w-2xl mx-auto">
            Choose the perfect AI team for your business. Pilot any plan for just $1.
          </p>
          
          <div className="flex items-center justify-center gap-3 mt-8">
            <span className={`text-sm font-medium ${!isAnnual ? 'text-white' : 'text-muted'}`}>Monthly</span>
            <button 
              onClick={() => setIsAnnual(!isAnnual)}
              className="relative inline-flex h-6 w-11 items-center rounded-full bg-accent transition-colors focus:outline-none"
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isAnnual ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
            <span className={`text-sm font-medium ${isAnnual ? 'text-white' : 'text-muted'}`}>
              Annual <span className="text-emerald-400 ml-1">(2 months free)</span>
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6 xl:gap-8">
          {TIERS.map((tier) => {
            const price = isAnnual ? tier.priceMonthly * 10 : tier.priceMonthly;
            
            return (
              <div 
                key={tier.name} 
                className={`bg-canvas border rounded-2xl flex flex-col ${tier.isPopular ? 'border-accent shadow-lg shadow-blue-900/20 relative' : 'border-line'}`}
              >
                {tier.isPopular && (
                  <div className="absolute top-0 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-accent text-white text-xs font-bold px-3 py-1 rounded-full whitespace-nowrap">
                    MOST POPULAR
                  </div>
                )}
                
                <div className="p-6 xl:p-8 flex-1">
                  <h3 className="text-lg font-semibold text-white mb-2">{tier.name}</h3>
                  <div className="mb-6 flex items-baseline">
                    <span className="text-4xl font-extrabold text-white">${price}</span>
                    <span className="text-muted ml-2">/{isAnnual ? 'yr' : 'mo'}</span>
                  </div>
                  
                  <button
                    onClick={() => handleCheckout(tier.id, true)}
                    disabled={loadingTier === tier.id}
                    className={`w-full py-2.5 px-4 rounded-lg font-semibold transition-colors mb-6 flex justify-center items-center ${
                      tier.isPopular 
                        ? 'bg-accent hover:bg-blue-600 text-white'
                        : 'bg-surface hover:bg-raised text-white border border-line'
                    }`}
                  >
                    {loadingTier === tier.id ? 'Loading...' : 'Start with $1 pilot'}
                  </button>

                  <div className="space-y-4">
                    {tier.features.map((feature, i) => (
                      <div key={i} className="flex items-start gap-3">
                        <svg className="w-5 h-5 text-emerald-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        <span className="text-sm text-muted">{feature}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Stated plainly rather than left for someone to discover after paying. */}
        <div className="mt-12 rounded-xl border border-line bg-surface p-6">
          <h2 className="text-base font-semibold text-white">Not included yet</h2>
          <p className="mt-1 text-sm text-muted">
            Every agent above writes drafts for you to approve. These are on the roadmap and
            are not part of any plan today:
          </p>
          <ul className="mt-4 space-y-2">
            {NOT_YET_BUILT.map((item, i) => (
              <li key={i} className="flex items-start gap-3 text-sm text-muted">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-line-strong" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        <LegalFooter />
      </div>
    </div>
  );
}
