// Lightweight local vector store with cosine similarity and chrome.storage persistence

export interface VectorMetadata {
  kind: 'pattern' | 'legitimacy_case';
  pattern?: string;
  description?: string;
  label?: string;
  notes?: string;
}

export interface VectorItem<TMeta = VectorMetadata> {
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
      // Check if Chrome storage is available
      if (!chrome?.storage?.local) {
        console.warn('Chrome storage not available, using memory-only vector store');
        this.loaded = true;
        return;
      }

      const stored = await chrome.storage.local.get(STORAGE_KEY);
      const arr = stored?.[STORAGE_KEY];

      if (!Array.isArray(arr) || !arr.every(item => 
        typeof item === 'object' && 
        item !== null && 
        typeof item.id === 'string' && 
        Array.isArray(item.vector) && 
        typeof item.meta === 'object'
      )) {
        console.warn('Invalid vector store data, initializing empty store');
        this.items = [];
      } else {
        this.items = arr;
      }
    } catch (error) {
      console.error('Failed to load vector store:', error);
      // Keep memory-only on error
      this.items = [];
    } finally {
      this.loaded = true;
    }
  }

  private static async persist(): Promise<void> {
    try {
      // Check if Chrome storage is available
      if (!chrome?.storage?.local) {
        console.warn('Chrome storage not available, skipping vector store persistence');
        return;
      }

      // Check data size before persisting (Chrome storage limit is ~5MB)
      const dataSize = JSON.stringify(this.items).length;
      const maxSize = 4 * 1024 * 1024; // 4MB limit to be safe

      if (dataSize > maxSize) {
        console.warn(`Vector store too large (${dataSize} bytes), clearing old items`);
        // Keep only the most recent items
        this.items = this.items.slice(-50);
      }

      await chrome.storage.local.set({ [STORAGE_KEY]: this.items });
    } catch (error) {
      console.error('Failed to persist vector store:', error);
      // Continue without persistence rather than failing
    }
  }

  static async clear(): Promise<void> {
    try {
      await this.load();
      this.items = [];
      await this.persist();
    } catch (error) {
      console.error('Failed to clear vector store:', error);
      // Reset in memory even if persistence fails
      this.items = [];
    }
  }

  static async upsertMany(items: VectorItem[]): Promise<void> {
    try {
      await this.load();

      if (!Array.isArray(items)) {
        throw new Error('Items must be an array');
      }

      const map = new Map(this.items.map((i) => [i.id, i]));

      for (const it of items) {
        if (!it.id || typeof it.id !== 'string') {
          console.warn('Skipping item with invalid ID:', it);
          continue;
        }

        if (!Array.isArray(it.vector) || it.vector.length === 0) {
          console.warn('Skipping item with invalid vector:', it);
          continue;
        }

        const normalized = l2Normalize([...it.vector]);
        map.set(it.id, { ...it, vector: normalized });
      }

      this.items = Array.from(map.values());
      await this.persist();
    } catch (error) {
      console.error('Failed to upsert vector items:', error);
      throw error; // Re-throw for caller to handle
    }
  }

  static async search(queryVector: number[], options: SearchOptions = {}): Promise<Array<{ it: VectorItem; score: number }>> {
    try {
      await this.load();

      if (!Array.isArray(queryVector) || queryVector.length === 0) {
        throw new Error('Query vector must be a non-empty array');
      }

      const topK = Math.max(1, Math.min(options.topK ?? 5, 50)); // Reasonable bounds
      const threshold = Math.max(0, Math.min(options.threshold ?? 0.35, 1)); // 0-1 range

      const q = l2Normalize([...queryVector]);
      const scored = this.items.map((it) => ({
        it,
        score: cosineSim(q, it.vector)
      }));

      scored.sort((a, b) => b.score - a.score);
      return scored.filter((s) => s.score >= threshold).slice(0, topK);
    } catch (error) {
      console.error('Failed to search vector store:', error);
      return []; // Return empty results on error
    }
  }

  // Seed minimal KB
  static async seedIfEmpty(): Promise<void> {
    try {
      await this.load();
      if (this.items.length > 0) return;

      const patterns = [
        {
          id: 'pat_false_urgency',
          meta: {
            kind: 'pattern' as const,
            pattern: 'false_urgency',
            description: 'Countdowns or stock warnings that pressure quick purchase.'
          },
          text: 'only a few left in stock limited time offer countdown timer hurry ends soon',
        },
        {
          id: 'pat_hidden_costs',
          meta: {
            kind: 'pattern' as const,
            pattern: 'hidden_costs',
            description: 'Fees revealed late in checkout (shipping, handling, taxes).'
          },
          text: 'shipping calculated at checkout extra fees handling tax added later',
        },
        {
          id: 'pat_trick_questions',
          meta: {
            kind: 'pattern' as const,
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
            kind: 'legitimacy_case' as const,
            label: 'established_secure',
            notes: 'Old domain, HTTPS, contact present, multiple protection flags.'
          },
          text: 'https contact page present domain age years registrar reputable multiple protection flags',
        },
        {
          id: 'legit_new_risky',
          meta: {
            kind: 'legitimacy_case' as const,
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
      console.log('✅ Vector store seeded with', items.length, 'items');
    } catch (error) {
      console.error('Failed to seed vector store:', error);
      // Continue without seeding rather than failing
    }
  }
}

export type { SearchOptions };



