/**
 * Reads one weight from a USB-serial weighing scale via the browser's Web Serial API
 * (Chrome / Edge). Most counter scales send lines like "  4.25 kg" or "ST,GS,  4250 g".
 */
export type ScaleReading = { kg: number; raw: string };

export const scaleSupported = () => typeof navigator !== "undefined" && "serial" in navigator;

export async function readScale(opts: { baudRate?: number; timeoutMs?: number } = {}): Promise<ScaleReading> {
  const serial = (navigator as unknown as { serial?: { requestPort: () => Promise<any> } }).serial;
  if (!serial) throw new Error("This browser cannot talk to a USB scale. Use Chrome or Edge on Windows, or type the weight.");
  const port = await serial.requestPort();
  await port.open({ baudRate: opts.baudRate ?? 9600 });
  const reader = port.readable.getReader();
  const decoder = new TextDecoder();
  let text = "";
  const deadline = Date.now() + (opts.timeoutMs ?? 4000);
  try {
    while (Date.now() < deadline && !/\d+(?:\.\d+)?\s*(?:kg|g)?\s*[\r\n]/i.test(text)) {
      const { value, done } = await Promise.race([reader.read(), new Promise<{ value?: Uint8Array; done: boolean }>((r) => setTimeout(() => r({ done: true }), Math.max(0, deadline - Date.now())))]);
      if (done) break;
      if (value) text += decoder.decode(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
    await port.close().catch(() => undefined);
  }
  const m = text.match(/(\d+(?:\.\d+)?)\s*(kg|g)?/i);
  if (!m) throw new Error(text.trim() ? `The scale sent "${text.trim().slice(0, 40)}", which is not a weight.` : "The scale did not send anything. Check the cable, the baud rate and that the scale is set to send weight.");
  const value = Number(m[1]);
  return { kg: m[2]?.toLowerCase() === "g" ? value / 1000 : value, raw: text.trim().slice(0, 80) };
}
