// Shared between the Brand Review page (which scores it in the browser) and
// /api/subscribe (which re-derives the tier server-side instead of trusting
// whatever label/summary text the client sends — that text goes straight
// into an email from our domain, so it can't be attacker-controlled).

// Same five bands and voice as the original Real Brand Review PDF, scaled to
// this question count (10 questions, 10-50) and routed to the three
// services actually live on the site instead of generic outreach copy.
export const TIERS = [
  {
    id: 'critical',
    min: 10,
    max: 17,
    label: 'Critical',
    summary:
      'Your brand requires immediate attention to address fundamental challenges and redefine its direction.',
    cta: 'foundations',
  },
  {
    id: 'needs-improvement',
    min: 18,
    max: 25,
    label: 'Needs Improvement',
    summary:
      'There are significant opportunities for improvement in your brand strategy and execution.',
    cta: 'foundations',
  },
  {
    id: 'moderate',
    min: 26,
    max: 33,
    label: 'Moderate',
    summary:
      "Your brand has a good foundation. Several areas need attention to elevate your brand's impact.",
    cta: 'alignment',
  },
  {
    id: 'effective',
    min: 34,
    max: 41,
    label: 'Effective',
    summary:
      'Your brand is doing well. There are areas that could benefit from refining and enhancement.',
    cta: 'marketing',
  },
  {
    id: 'highly-effective',
    min: 42,
    max: 50,
    label: 'Highly Effective',
    summary:
      "Your brand is in excellent shape! However, there's always room for improvement and staying ahead of the competition.",
    cta: 'marketing',
  },
];

// Every category has 2 questions scored 1-5.
export const CATEGORY_NAMES = [
  'Brand Identity',
  'Internal Brand Culture',
  'Customer Experience & Perception',
  'Brand Performance',
  'Digital Presence & Marketing',
];
export const CATEGORY_MAX = 10;
export const CATEGORY_MIN = 2;

export interface BrandReviewResult {
  score: number;
  maxScore: number;
  tierLabel: string;
  tierSummary: string;
  ctaBucket: string;
  categories: { name: string; score: number; max: number }[];
}

/**
 * Rebuilds a Brand Review result from just the per-category scores the
 * client sent. Returns null unless every known category is present exactly
 * once with an in-range integer score — anything else is a forged payload.
 */
export function rebuildBrandReviewResult(value: unknown): BrandReviewResult | null {
  if (!value || typeof value !== 'object') return null;
  const raw = (value as Record<string, unknown>).categories;
  if (!Array.isArray(raw) || raw.length !== CATEGORY_NAMES.length) return null;

  const scores = new Map<string, number>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') return null;
    const { name, score } = item as Record<string, unknown>;
    if (typeof name !== 'string' || !CATEGORY_NAMES.includes(name) || scores.has(name)) return null;
    if (!Number.isInteger(score) || (score as number) < CATEGORY_MIN || (score as number) > CATEGORY_MAX) return null;
    scores.set(name, score as number);
  }

  const categories = CATEGORY_NAMES.map((name) => ({ name, score: scores.get(name)!, max: CATEGORY_MAX }));
  const score = categories.reduce((n, c) => n + c.score, 0);
  const tier = TIERS.find((t) => score >= t.min && score <= t.max);
  if (!tier) return null;

  return {
    score,
    maxScore: CATEGORY_NAMES.length * CATEGORY_MAX,
    tierLabel: tier.label,
    tierSummary: tier.summary,
    ctaBucket: tier.cta,
    categories,
  };
}
