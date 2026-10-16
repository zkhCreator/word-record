export interface Sense { pos: string; meaning: string }
export interface Example { en: string; zh: string }

export interface Entry {
  id: number;
  text: string;
  kind: 'word' | 'phrase';
  lemma: string | null;
  phonetic: string | null;
  pos: string | null;
  meaning: string | null;
  definition_en: string | null;
  form_note: string | null;
  senses: Sense[];
  examples: Example[];
  notes: string;
  enrich_status: 'pending' | 'done' | 'error';
  enrich_error: string | null;
  created_at: number;
  updated_at: number;
  context_count?: number;
  latest_sentence?: string | null;
}

export interface Context {
  id: number;
  entry_id: number;
  sentence: string;
  url: string | null;
  title: string | null;
  meaning: string | null;
  explanation: string | null;
  translation: string | null;
  created_at: number;
}

export type Grade = 'again' | 'hard' | 'good';

export interface ReviewState {
  stage: number;
  due_at: number;
  reps: number;
  lapses: number;
  last_reviewed_at: number | null;
}

export interface ReviewItem {
  entry: Entry;
  contexts: Context[];
  review: ReviewState;
  preview: Record<Grade, number>;
}

export interface ReviewStats {
  total: number;
  due: number;
  mastered: number;
  reviewedToday: number;
  nextDueAt: number | null;
  forecast: { day: number; count: number }[];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `请求失败（HTTP ${res.status}）`);
  return body as T;
}

export const api = {
  list: (params: { q?: string; kind?: string; limit?: number }) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) qs.set(k, String(v));
    return request<{ items: Entry[]; total: number }>(`/api/entries?${qs}`);
  },
  get: (id: number) => request<{ entry: Entry; contexts: Context[]; review?: ReviewState }>(`/api/entries/${id}`),
  update: (id: number, patch: Partial<Entry>) =>
    request<{ entry: Entry }>(`/api/entries/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  remove: (id: number) => request<void>(`/api/entries/${id}`, { method: 'DELETE' }),
  removeContext: (id: number) => request<void>(`/api/contexts/${id}`, { method: 'DELETE' }),
  enrich: (id: number) => request<{ entry: Entry; contexts: Context[] }>(`/api/entries/${id}/enrich`, { method: 'POST' }),
  reviewQueue: () => request<{ items: ReviewItem[]; intervals: number[]; masteredStage: number }>('/api/review/queue'),
  reviewStats: () => request<ReviewStats>('/api/review/stats'),
  grade: (id: number, grade: Grade) =>
    request<{ review: ReviewState; preview: Record<Grade, number> }>(`/api/review/${id}`, { method: 'POST', body: JSON.stringify({ grade }) }),
  capture: (body: { text: string; sentence: string }) =>
    request<{ entry: Entry; context: Context; created: boolean }>('/api/entries', { method: 'POST', body: JSON.stringify(body) }),
};
