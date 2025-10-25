// Lightweight local vector store with cosine similarity and chrome.storage persistence

export interface VectorItem<TMeta = any> {
  id: string;
  vector: number[]; // normalized
  meta: TMeta;
}

type SearchOptions = { topK?: number; threshold?: number };

const STORAGE_KEY = 'vector_store_v1';

function l2Normalize(vec: number[]): number[] {
  let sumSq = 0;
  for (let i = 0; i < vec.length; i++) sumSq += vec[i] * vec[i];
  const inv = sumSq > 0 ? 1 / Math.sqrt(sumSq) : 1;
  for (let i = 0; i < vec.length; i++) vec[i] *= inv;
  return vec;
}

function cosineSim(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < n; i++) dot += a[i] * b[i];
  return dot; // both assumed normalized
}

// Ultra-lightweight text embedding (hash-based) for local/offline usage
// Produces 256-dim vector; good enough for small KB retrieval
export function embedTextLocal(text: string, dims: number = 256): number[] {
  const vec = new Array(dims).fill(0);
  const tokens = (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  for (const tok of tokens) {
    let h = 2166136261;
    for (let i = 0; i < tok.length; i++) {
      h ^= tok.charCodeAt(i);
      h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
    }
    const idx = Math.abs(h) % dims;
    vec[idx] += 1;
  }
  return l2Normalize(vec);
}

export class VectorService {
  private static items: VectorItem[] = [];
  private static loaded = false;

  static async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const stored = await chrome.storage?.local?.get(STORAGE_KEY);
      const arr = stored?.[STORAGE_KEY] || [];
      this.items = Array.isArray(arr) ? arr : [];
    } catch {
      // ignore storage errors; keep memory-only
    } finally {
      this.loaded = true;
    }
  }

  private static async persist(): Promise<void> {
    try {
      await chrome.storage?.local?.set({ [STORAGE_KEY]: this.items });
    } catch {
      // ignore persistence errors
    }
  }

  static async clear(): Promise<void> {
    await this.load();
    this.items = [];
    await this.persist();
  }

  static async upsertMany(items: VectorItem[]): Promise<void> {
    await this.load();
    const map = new Map(this.items.map((i) => [i.id, i]));
    for (const it of items) {
      const normalized = Array.isArray(it.vector) ? l2Normalize([...it.vector]) : [];
      map.set(it.id, { ...it, vector: normalized });
    }
    this.items = Array.from(map.values());
    await this.persist();
  }

  static async search(queryVector: number[], options: SearchOptions = {}) {
    await this.load();
    const topK = options.topK ?? 5;
    const threshold = options.threshold ?? 0.35;
    const q = l2Normalize([...queryVector]);
    const scored = this.items.map((it) => ({ it, score: cosineSim(q, it.vector) }));
    scored.sort((a, b) => b.score - a.score);
    return scored.filter((s) => s.score >= threshold).slice(0, topK);
  }

  // Seed minimal KB
  static async seedIfEmpty(): Promise<void> {
    await this.load();
    if (this.items.length > 0) return;
    const patterns = [
      {
        id: 'pat_false_urgency',
        meta: {
          kind: 'pattern',
          pattern: 'false_urgency',
          description: 'Countdowns or stock warnings that pressure quick purchase.'
        },
        text: 'only a few left in stock limited time offer countdown timer hurry ends soon',
      },
      {
        id: 'pat_hidden_costs',
        meta: {
          kind: 'pattern',
          pattern: 'hidden_costs',
          description: 'Fees revealed late in checkout (shipping, handling, taxes).'
        },
        text: 'shipping calculated at checkout extra fees handling tax added later',
      },
      {
        id: 'pat_trick_questions',
        meta: {
          kind: 'pattern',
          pattern: 'trick_questions',
          description: 'Confusing opt-outs or preselected consents.'
        },
        text: 'preselected checkbox subscribe opt out confusing double negative',
      },
    ];

    const cases = [
      {
        id: 'legit_old_secure',
        meta: {
          kind: 'legitimacy_case',
          label: 'established_secure',
          notes: 'Old domain, HTTPS, contact present, multiple protection flags.'
        },
        text: 'https contact page present domain age years registrar reputable multiple protection flags',
      },
      {
        id: 'legit_new_risky',
        meta: {
          kind: 'legitimacy_case',
          label: 'new_minimal_signals',
          notes: 'New domain, no social, missing contact, low protection.'
        },
        text: 'new domain days no social media missing contact low protection flags',
      },
    ];

    const items: VectorItem[] = [...patterns, ...cases].map((r) => ({
      id: r.id,
      vector: embedTextLocal(r.text),
      meta: r.meta,
    }));
    await this.upsertMany(items);
  }
}

export type { SearchOptions };



