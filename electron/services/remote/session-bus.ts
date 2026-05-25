export type BusEvent = Record<string, unknown>;
type Sub = (event: BusEvent) => void;
type SubAll = (topic: string, event: BusEvent) => void;

interface Ring {
  events: BusEvent[];
  seq: number;
}
const RING_CAP = 256;

export class SessionBus {
  private subs = new Map<string, Set<Sub>>();
  private allSubs = new Set<SubAll>();
  private rings = new Map<string, Ring>();

  publish(topic: string, event: BusEvent): void {
    let ring = this.rings.get(topic);
    if (!ring) { ring = { events: [], seq: 0 }; this.rings.set(topic, ring); }
    ring.seq += 1;
    ring.events.push(event);
    if (ring.events.length > RING_CAP) ring.events.splice(0, ring.events.length - RING_CAP);
    const ts = this.subs.get(topic);
    if (ts) for (const fn of ts) { try { fn(event); } catch { /* isolate one bad sub */ } }
    for (const fn of this.allSubs) { try { fn(topic, event); } catch { /* isolate */ } }
  }

  subscribe(topic: string, fn: Sub): () => void {
    let set = this.subs.get(topic);
    if (!set) { set = new Set(); this.subs.set(topic, set); }
    set.add(fn);
    return () => { set!.delete(fn); };
  }

  subscribeAll(fn: SubAll): () => void {
    this.allSubs.add(fn);
    return () => { this.allSubs.delete(fn); };
  }

  history(topic: string, since: number): { events: BusEvent[]; lastSeq: number } {
    const ring = this.rings.get(topic);
    if (!ring) return { events: [], lastSeq: 0 };
    const startIdx = Math.max(0, ring.events.length - (ring.seq - since));
    return { events: ring.events.slice(startIdx), lastSeq: ring.seq };
  }
}
