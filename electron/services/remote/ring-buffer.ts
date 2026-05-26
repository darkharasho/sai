/**
 * Append-only ring buffer of UTF-8 strings with a byte-length cap.
 * Oldest chunks are evicted when the total exceeds `capBytes`.
 * A single push larger than `capBytes` is truncated to its tail.
 */
export class RingBuffer {
  private chunks: string[] = [];
  private byteLength = 0;

  constructor(private readonly capBytes: number) {}

  get size(): number { return this.byteLength; }

  push(data: string): void {
    if (!data) return;
    let incoming = data;
    let incomingLen = Buffer.byteLength(incoming, 'utf8');

    if (incomingLen > this.capBytes) {
      incoming = incoming.slice(incoming.length - this.capBytes);
      incomingLen = Buffer.byteLength(incoming, 'utf8');
      this.chunks = [incoming];
      this.byteLength = incomingLen;
      return;
    }

    this.chunks.push(incoming);
    this.byteLength += incomingLen;

    while (this.byteLength > this.capBytes && this.chunks.length > 1) {
      const oldest = this.chunks.shift()!;
      this.byteLength -= Buffer.byteLength(oldest, 'utf8');
    }
  }

  snapshot(): string {
    return this.chunks.join('');
  }

  clear(): void {
    this.chunks = [];
    this.byteLength = 0;
  }
}
