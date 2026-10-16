import type { DB } from './db.ts';
import type { Enrichment } from './magpie.ts';
import { initialState, schedule, MASTERED_STAGE, type Grade, type ReviewState } from './srs.ts';

export interface Context {
  id: number;
  entry_id: number;
  sentence: string;
  url: string | null;
  title: string | null;
  form: string | null;
  meaning: string | null;
  explanation: string | null;
  translation: string | null;
  created_at: number;
}

export interface Entry {
  id: number;
  text: string;
  normalized: string;
  kind: 'word' | 'phrase';
  lemma: string | null;
  phonetic: string | null;
  pos: string | null;
  meaning: string | null;
  definition_en: string | null;
  form_note: string | null;
  senses: { pos: string; meaning: string }[];
  examples: { en: string; zh: string }[];
  notes: string;
  enrich_status: 'pending' | 'done' | 'error';
  enrich_error: string | null;
  enrich_model: string | null;
  created_at: number;
  updated_at: number;
  /** Every surface form captured for this entry (running, ran, ...). */
  forms?: string[];
}

type EntryRow = Omit<Entry, 'senses' | 'examples'> & { senses: string; examples: string };

export const normalizeText = (text: string) =>
  text.trim().replace(/\s+/g, ' ').replace(/^[\s"'“”‘’(\[]+|[\s"'“”‘’)\],.;:!?]+$/g, '').toLowerCase();

export const cleanText = (text: string) =>
  text.trim().replace(/\s+/g, ' ').replace(/^[\s"'“”‘’(\[]+|[\s"'“”‘’)\],.;:!?]+$/g, '');

function hydrate(row: EntryRow | undefined): Entry | undefined {
  if (!row) return undefined;
  return { ...row, senses: JSON.parse(row.senses), examples: JSON.parse(row.examples) };
}

export class Repo {
  constructor(readonly db: DB) {}

  getEntry(id: number) {
    const entry = hydrate(this.db.prepare('SELECT * FROM entries WHERE id = ?').get(id) as EntryRow | undefined);
    if (entry) entry.forms = this.forms(id);
    return entry;
  }

  forms(entryId: number) {
    return (this.db.prepare('SELECT form FROM entry_forms WHERE entry_id = ? ORDER BY rowid').all(entryId) as { form: string }[]).map(
      (r) => r.form,
    );
  }

  findByForm(form: string) {
    const row = this.db.prepare('SELECT entry_id FROM entry_forms WHERE form = ?').get(form) as { entry_id: number } | undefined;
    return row ? this.getEntry(row.entry_id) : undefined;
  }

  /** Oldest other entry sharing this lemma (case-insensitive). */
  findByLemma(lemma: string, excludeId: number) {
    const row = this.db
      .prepare('SELECT id FROM entries WHERE lower(lemma) = lower(?) AND id != ? ORDER BY id LIMIT 1')
      .get(lemma, excludeId) as { id: number } | undefined;
    return row ? this.getEntry(row.id) : undefined;
  }

  /** Folds `sourceId` into `targetId`: contexts, forms, notes and review history move; the source is deleted. */
  merge(sourceId: number, targetId: number) {
    if (sourceId === targetId) return this.getEntry(targetId);
    return this.db.transaction(() => {
      const source = this.getEntry(sourceId);
      const target = this.getEntry(targetId);
      if (!source || !target) return undefined;
      for (const table of ['contexts', 'entry_forms', 'review_logs']) {
        this.db.prepare(`UPDATE ${table} SET entry_id = ? WHERE entry_id = ?`).run(targetId, sourceId);
      }
      // Same sentence captured under two forms: keep the earliest copy.
      this.db
        .prepare(
          `DELETE FROM contexts WHERE entry_id = ? AND id NOT IN (
             SELECT MIN(id) FROM contexts WHERE entry_id = ? GROUP BY sentence)`,
        )
        .run(targetId, targetId);
      const notes = [target.notes, source.notes].filter((n) => n.trim()).join('\n\n');
      this.db.prepare('UPDATE entries SET notes = ?, updated_at = ? WHERE id = ?').run(notes, Date.now(), targetId);
      this.db.prepare('DELETE FROM entries WHERE id = ?').run(sourceId);
      return this.getEntry(targetId);
    })();
  }

  /** Merges every group of entries that share a lemma into the oldest one. Returns how many were folded. */
  aggregateByLemma() {
    const groups = this.db
      .prepare(
        `SELECT group_concat(id) AS ids FROM (SELECT id, lower(lemma) AS l FROM entries WHERE lemma IS NOT NULL AND lemma != '' ORDER BY id)
         GROUP BY l HAVING COUNT(*) > 1`,
      )
      .all() as { ids: string }[];
    let merged = 0;
    for (const { ids } of groups) {
      const [target, ...rest] = ids.split(',').map(Number).sort((a, b) => a - b);
      for (const id of rest) {
        this.merge(id, target);
        merged++;
      }
    }
    return merged;
  }

  findByNormalized(normalized: string) {
    return hydrate(this.db.prepare('SELECT * FROM entries WHERE normalized = ?').get(normalized) as EntryRow | undefined);
  }

  contexts(entryId: number) {
    return this.db
      .prepare('SELECT * FROM contexts WHERE entry_id = ? ORDER BY created_at DESC, id DESC')
      .all(entryId) as Context[];
  }

  getContext(id: number) {
    return this.db.prepare('SELECT * FROM contexts WHERE id = ?').get(id) as Context | undefined;
  }

  /** Inserts the entry if new and attaches the sentence as a context (deduped per entry). */
  capture(input: { text: string; sentence: string; url?: string; title?: string }) {
    const now = Date.now();
    const text = cleanText(input.text);
    const normalized = normalizeText(input.text);
    return this.db.transaction(() => {
      let entry = this.findByForm(normalized);
      const created = !entry;
      if (!entry) {
        const kind = /\s/.test(text) ? 'phrase' : 'word';
        const { lastInsertRowid } = this.db
          .prepare('INSERT INTO entries (text, normalized, kind, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
          .run(text, normalized, kind, now, now);
        this.db.prepare('INSERT INTO entry_forms (form, entry_id) VALUES (?, ?)').run(normalized, Number(lastInsertRowid));
        entry = this.getEntry(Number(lastInsertRowid))!;
        const r = initialState(now);
        this.db
          .prepare('INSERT INTO reviews (entry_id, stage, due_at, reps, lapses) VALUES (?, ?, ?, ?, ?)')
          .run(entry.id, r.stage, r.due_at, r.reps, r.lapses);
      }
      const sentence = input.sentence.trim();
      let context = this.db
        .prepare('SELECT * FROM contexts WHERE entry_id = ? AND sentence = ?')
        .get(entry.id, sentence) as Context | undefined;
      if (!context) {
        const { lastInsertRowid } = this.db
          .prepare('INSERT INTO contexts (entry_id, sentence, url, title, form, created_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(entry.id, sentence, input.url ?? null, input.title ?? null, text, now);
        context = this.getContext(Number(lastInsertRowid))!;
        this.touch(entry.id);
      }
      return { entry, context, created };
    })();
  }

  getSetting(key: string) {
    return (this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined)?.value;
  }

  setSetting(key: string, value: string) {
    this.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
  }

  deleteSetting(key: string) {
    this.db.prepare('DELETE FROM settings WHERE key = ?').run(key);
  }

  applyEnrichment(entryId: number, contextId: number | null, e: Enrichment, overwriteEntry: boolean, model: string) {
    const now = Date.now();
    this.db.transaction(() => {
      if (overwriteEntry) {
        this.db
          .prepare(
            `UPDATE entries SET kind = ?, lemma = ?, phonetic = ?, pos = ?, meaning = ?, definition_en = ?,
             form_note = ?, senses = ?, examples = ?, enrich_status = 'done', enrich_error = NULL, enrich_model = ?,
             updated_at = ? WHERE id = ?`,
          )
          .run(e.kind, e.lemma, e.phonetic, e.pos, e.meaning, e.definition_en, e.form_note,
            JSON.stringify(e.senses), JSON.stringify(e.examples), model, now, entryId);
      }
      if (contextId != null) {
        this.db
          .prepare('UPDATE contexts SET meaning = ?, explanation = ?, translation = ? WHERE id = ?')
          .run(e.meaning, e.explanation, e.translation, contextId);
      }
    })();
  }

  markEnrichError(entryId: number, message: string) {
    this.db
      .prepare(`UPDATE entries SET enrich_status = 'error', enrich_error = ?, updated_at = ? WHERE id = ? AND enrich_status != 'done'`)
      .run(message.slice(0, 500), Date.now(), entryId);
  }

  list(opts: { q?: string; kind?: string; limit?: number; offset?: number }) {
    const where: string[] = [];
    const params: unknown[] = [];
    if (opts.q) {
      where.push('(e.lemma LIKE ? OR e.meaning LIKE ? OR e.id IN (SELECT entry_id FROM entry_forms WHERE form LIKE ?))');
      const like = `%${opts.q.toLowerCase()}%`;
      params.push(like, `%${opts.q}%`, like);
    }
    if (opts.kind === 'word' || opts.kind === 'phrase') {
      where.push('e.kind = ?');
      params.push(opts.kind);
    }
    const sqlWhere = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
    const offset = Math.max(opts.offset ?? 0, 0);
    const rows = this.db
      .prepare(
        `SELECT e.*,
           (SELECT COUNT(*) FROM contexts c WHERE c.entry_id = e.id) AS context_count,
           (SELECT c.sentence FROM contexts c WHERE c.entry_id = e.id ORDER BY c.created_at DESC, c.id DESC LIMIT 1) AS latest_sentence,
           (SELECT group_concat(f.form, char(31)) FROM entry_forms f WHERE f.entry_id = e.id) AS forms_joined
         FROM entries e ${sqlWhere}
         ORDER BY e.updated_at DESC, e.id DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as (EntryRow & { context_count: number; latest_sentence: string | null; forms_joined: string | null })[];
    const { total } = this.db.prepare(`SELECT COUNT(*) AS total FROM entries e ${sqlWhere}`).get(...params) as { total: number };
    const items = rows.map(({ forms_joined, ...r }) => ({ ...hydrate(r)!, forms: forms_joined ? forms_joined.split('\x1f') : [] }));
    return { items, total };
  }

  update(id: number, patch: Partial<Pick<Entry, 'notes' | 'meaning' | 'lemma' | 'phonetic' | 'pos' | 'definition_en'>>) {
    const fields = (['notes', 'meaning', 'lemma', 'phonetic', 'pos', 'definition_en'] as const).filter(
      (k) => typeof patch[k] === 'string',
    );
    if (fields.length) {
      this.db
        .prepare(`UPDATE entries SET ${fields.map((f) => `${f} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
        .run(...fields.map((f) => patch[f]), Date.now(), id);
    }
    return this.getEntry(id);
  }

  remove(id: number) {
    return this.db.prepare('DELETE FROM entries WHERE id = ?').run(id).changes > 0;
  }

  removeContext(id: number) {
    return this.db.prepare('DELETE FROM contexts WHERE id = ?').run(id).changes > 0;
  }

  reviewState(entryId: number) {
    return this.db
      .prepare('SELECT stage, due_at, reps, lapses, last_reviewed_at FROM reviews WHERE entry_id = ?')
      .get(entryId) as ReviewState | undefined;
  }

  dueEntries(now: number, limit: number) {
    const ids = this.db
      .prepare('SELECT entry_id FROM reviews WHERE due_at <= ? ORDER BY due_at ASC LIMIT ?')
      .all(now, limit) as { entry_id: number }[];
    return ids.map(({ entry_id }) => ({
      entry: this.getEntry(entry_id)!,
      contexts: this.contexts(entry_id),
      review: this.reviewState(entry_id)!,
    }));
  }

  grade(entryId: number, grade: Grade, now: number) {
    return this.db.transaction(() => {
      const before = this.reviewState(entryId);
      if (!before) return undefined;
      const after = schedule(before, grade, now);
      this.db
        .prepare('UPDATE reviews SET stage = ?, due_at = ?, reps = ?, lapses = ?, last_reviewed_at = ? WHERE entry_id = ?')
        .run(after.stage, after.due_at, after.reps, after.lapses, after.last_reviewed_at, entryId);
      this.db
        .prepare('INSERT INTO review_logs (entry_id, grade, stage_before, stage_after, reviewed_at) VALUES (?, ?, ?, ?, ?)')
        .run(entryId, grade, before.stage, after.stage, now);
      return after;
    })();
  }

  reviewStats(now: number) {
    const startOfDay = new Date(now).setHours(0, 0, 0, 0);
    const DAY = 86_400_000;
    const one = (sql: string, ...p: unknown[]) => (this.db.prepare(sql).get(...p) as { n: number }).n;
    const forecast = Array.from({ length: 7 }, (_, i) => {
      const from = i === 0 ? 0 : startOfDay + i * DAY;
      const to = startOfDay + (i + 1) * DAY;
      return { day: startOfDay + i * DAY, count: one('SELECT COUNT(*) AS n FROM reviews WHERE due_at >= ? AND due_at < ?', from, to) };
    });
    return {
      total: one('SELECT COUNT(*) AS n FROM reviews'),
      due: one('SELECT COUNT(*) AS n FROM reviews WHERE due_at <= ?', now),
      mastered: one('SELECT COUNT(*) AS n FROM reviews WHERE stage >= ?', MASTERED_STAGE),
      reviewedToday: one('SELECT COUNT(*) AS n FROM review_logs WHERE reviewed_at >= ?', startOfDay),
      nextDueAt: (this.db.prepare('SELECT MIN(due_at) AS t FROM reviews WHERE due_at > ?').get(now) as { t: number | null }).t,
      forecast,
    };
  }

  private touch(id: number) {
    this.db.prepare('UPDATE entries SET updated_at = ? WHERE id = ?').run(Date.now(), id);
  }
}
