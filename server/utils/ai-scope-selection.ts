export type SelectedAiScope = {
  kind: 'candidate_fit' | 'cv_summary' | 'opportunity_draft' | 'term_review';
  targetId: string;
  termId: string;
  page: number;
  pageSize: number;
};

/** An explicit operational scope never falls back to scanning all resources. */
export function selectedAutomaticScopes(raw: string | undefined, comparisonSize = 10): SelectedAiScope[] | null {
  if (!Number.isSafeInteger(comparisonSize) || comparisonSize < 1 || comparisonSize > 10) throw new Error('Invalid automatic AI comparison size.');
  if (raw === undefined) return null;
  let values: unknown;
  try { values = JSON.parse(raw); } catch { throw new Error('Automatic AI scopes must be valid JSON.'); }
  if (!Array.isArray(values) || values.length > 64) throw new Error('Automatic AI scopes must be a bounded array.');
  const kinds = ['candidate_fit', 'cv_summary', 'opportunity_draft', 'term_review'];
  const identifier = (value: unknown) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 64 && !/[\u0000-\u001f]/.test(value);
  const unique = new Map<string, SelectedAiScope>();
  for (const value of values) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid automatic AI scope.');
    const item = value as Record<string, unknown>;
    if (Object.keys(item).some(key => !['kind', 'targetId', 'termId', 'page', 'pageSize'].includes(key)) || !kinds.includes(String(item.kind)) || !identifier(item.targetId)) throw new Error('Invalid automatic AI scope.');
    if (item.termId !== undefined && item.termId !== '' && !identifier(item.termId)) throw new Error('Invalid automatic AI semester.');
    if (item.kind === 'term_review' && !identifier(item.termId)) throw new Error('Course AI requires its semester.');
    const candidate = item.kind === 'candidate_fit';
    if ((item.page !== undefined && typeof item.page !== 'number') || (item.pageSize !== undefined && typeof item.pageSize !== 'number')) throw new Error('Automatic AI page values must be numbers.');
    const page = item.page === undefined ? 1 : item.page as number;
    const size = item.pageSize === undefined ? (candidate ? comparisonSize : 50) : item.pageSize as number;
    if (!Number.isSafeInteger(page) || page < 1 || page > 10000 || !Number.isSafeInteger(size) || size !== (candidate ? comparisonSize : 50) || (!candidate && page !== 1)) throw new Error('Invalid automatic AI page.');
    const scope: SelectedAiScope = { kind: item.kind as SelectedAiScope['kind'], targetId: (item.targetId as string).trim(), termId: item.kind === 'term_review' ? (item.termId as string).trim() : '', page, pageSize: size };
    unique.set(JSON.stringify(scope), scope);
  }
  return [...unique.values()];
}
