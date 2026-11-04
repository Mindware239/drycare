/** Builds a print job in TSPL, the language TSC label printers understand, from labels drawn as 1-bit images. */
export type TsplLabel = {
  widthDots: number;
  heightDots: number;
  /** One row after another, 8 pixels per byte, leftmost pixel in the highest bit. A 0 bit prints a black dot. */
  bitmap: Uint8Array;
};
export type TsplJob = { widthMm: number; heightMm: number; gapMm: number; density: number; speed: number; copies: number; labels: TsplLabel[] };

export const bytesPerRow = (widthDots: number) => Math.ceil(widthDots / 8);

const encoder = new TextEncoder();

export function buildTsplJob(job: TsplJob): Uint8Array {
  const parts: Uint8Array[] = [];
  const line = (text: string) => parts.push(encoder.encode(`${text}\r\n`));
  line(`SIZE ${job.widthMm} mm,${job.heightMm} mm`);
  line(`GAP ${job.gapMm} mm,0 mm`);
  line("DIRECTION 1");
  line("REFERENCE 0,0");
  line(`SPEED ${job.speed}`);
  line(`DENSITY ${job.density}`);
  line("SET TEAR ON");
  for (const label of job.labels) {
    const rowBytes = bytesPerRow(label.widthDots);
    if (label.bitmap.length !== rowBytes * label.heightDots) throw new Error("Label image size does not match its dimensions");
    line("CLS");
    parts.push(encoder.encode(`BITMAP 0,0,${rowBytes},${label.heightDots},0,`));
    parts.push(label.bitmap);
    parts.push(encoder.encode("\r\n"));
    line(`PRINT 1,${job.copies}`);
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}
