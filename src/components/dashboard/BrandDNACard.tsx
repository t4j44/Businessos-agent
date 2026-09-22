'use client';

import { Palette, Type as TypeIcon, Package, MessageSquareQuote } from 'lucide-react';

type Product = { name?: string; description?: string } | string;

export type BrandDNA = {
  company_name?: string | null;
  tone_description?: string | null;
  tone_type?: string | null;
  brand_color_primary?: string | null;
  brand_color_secondary?: string | null;
  brand_color_accent?: string | null;
  brand_font_primary?: string | null;
  brand_font_secondary?: string | null;
  products_json?: Product[] | null;
  value_proposition?: string | null;
};

// A hex we can actually paint. Brand scout writes whatever the site used, so
// anything that is not a plain hex is skipped rather than rendered as a
// transparent square.
function isHex(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(value.trim());
}

function productName(p: Product, i: number) {
  if (typeof p === 'string') return p;
  return p?.name || 'Product ' + (i + 1);
}

function Swatch({ label, hex }: { label: string; hex: string }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="h-9 w-9 flex-shrink-0 rounded-lg border border-line-strong"
        style={{ backgroundColor: hex }}
        aria-hidden
      />
      <div className="min-w-0">
        <p className="text-xs font-medium text-text">{label}</p>
        <code className="text-xs uppercase text-dim">{hex}</code>
      </div>
    </div>
  );
}

function Section({
  icon: Icon, title, children,
}: { icon: React.ElementType; title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-line px-5 py-4 first:border-0">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-dim">
        <Icon className="h-3.5 w-3.5" />
        {title}
      </p>
      {children}
    </div>
  );
}

// What brand scout extracted from the client's website, in the shape the
// founder can actually check: name, palette, voice, products.
export function BrandDNACard({ brand }: { brand: BrandDNA | null | undefined }) {
  if (!brand) return null;

  const swatches = [
    { label: 'Primary', hex: brand.brand_color_primary },
    { label: 'Secondary', hex: brand.brand_color_secondary },
    { label: 'Accent', hex: brand.brand_color_accent },
  ].filter((s) => isHex(s.hex)) as { label: string; hex: string }[];

  const products = Array.isArray(brand.products_json) ? brand.products_json : [];
  const fonts = [brand.brand_font_primary, brand.brand_font_secondary].filter(Boolean);

  return (
    <div className="rounded-lg border border-line bg-surface">
      <div className="flex items-center justify-between gap-3 px-5 py-4">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wider text-dim">
            Brand DNA
          </p>
          <h2 className="mt-0.5 truncate text-2xl font-semibold leading-8 tracking-tight text-text">
            {brand.company_name || 'Unnamed business'}
          </h2>
        </div>
        {brand.tone_type && (
          <span className="flex-shrink-0 rounded-full border border-accent/20 bg-accent/10 px-2.5 py-1 text-xs font-medium capitalize text-accent">
            {brand.tone_type}
          </span>
        )}
      </div>

      {brand.value_proposition && (
        <Section icon={MessageSquareQuote} title="Value proposition">
          <p className="text-sm leading-relaxed text-muted">{brand.value_proposition}</p>
        </Section>
      )}

      <Section icon={Palette} title="Brand colours">
        {swatches.length === 0 ? (
          <p className="text-sm text-faint">No colours extracted from the site.</p>
        ) : (
          <div className="flex flex-wrap gap-4">
            {swatches.map((s) => <Swatch key={s.label} label={s.label} hex={s.hex} />)}
          </div>
        )}
      </Section>

      {fonts.length > 0 && (
        <Section icon={TypeIcon} title="Typefaces">
          <div className="flex flex-wrap gap-2">
            {fonts.map((f) => (
              <span
                key={String(f)}
                className="rounded-full border border-line bg-raised px-2.5 py-1 text-xs text-muted"
              >
                {f}
              </span>
            ))}
          </div>
        </Section>
      )}

      <Section icon={MessageSquareQuote} title="Tone of voice">
        {brand.tone_description ? (
          <p className="text-sm leading-relaxed text-muted">{brand.tone_description}</p>
        ) : (
          <p className="text-sm text-faint">No tone captured yet.</p>
        )}
      </Section>

      <Section icon={Package} title={'Products (' + products.length + ')'}>
        {products.length === 0 ? (
          <p className="text-sm text-faint">No products extracted from the site.</p>
        ) : (
          <ul className="space-y-2">
            {products.map((p, i) => (
              <li key={i} className="rounded-lg border border-line bg-raised px-3 py-2">
                <p className="text-sm font-medium text-text">{productName(p, i)}</p>
                {typeof p !== 'string' && p?.description && (
                  <p className="mt-0.5 text-sm text-dim">{p.description}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
