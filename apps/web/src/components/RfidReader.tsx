"use client";
import { useEffect, useRef, useState } from "react";
import { Radio } from "lucide-react";
import { normalizeEpc } from "@drycare/shared";
import { Input } from "@/components/ui";

/** How long after the last character a tag number with no ending key counts as finished. */
const IDLE_MS = 300;
/** Tags read within this time go to the server together, so holding the trigger does not send one request per tag. */
const BATCH_MS = 150;
/** The shortest common RFID tag number, used to accept a number when the reader sends nothing after it. */
const FULL_EPC = 24;

function signalRead() {
  try {
    navigator.vibrate?.(30);
    const audio = new AudioContext();
    const tone = audio.createOscillator();
    const gain = audio.createGain();
    gain.gain.value = 0.05;
    tone.frequency.value = 1400;
    tone.connect(gain).connect(audio.destination);
    tone.start();
    tone.stop(audio.currentTime + 0.05);
    tone.onended = () => void audio.close();
  } catch { /* A device with no sound or vibration still reads tags. */ }
}

/**
 * Where a reader types. Handheld terminals and USB readers set to keyboard mode send each tag's number, usually
 * followed by Enter, Tab or a space, and some send nothing after it. A trigger held down sends many tags quickly and
 * repeats them, so this works without re-drawing on each character and passes on each tag once per read.
 * Give it a new `key` to read the same tags again.
 */
export function RfidReader({ onRead, placeholder }: { onRead: (epcs: string[]) => void; placeholder: string }) {
  const [bad, setBad] = useState("");
  const [count, setCount] = useState(0);
  const [hideKeyboard, setHideKeyboard] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const batch = useRef<string[]>([]);
  const seen = useRef(new Set<string>());
  const batchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef(onRead);
  latest.current = onRead;
  useEffect(() => {
    input.current?.focus();
    try { setHideKeyboard(localStorage.getItem("rfid-hide-keyboard") === "1"); } catch { /* Private windows can refuse storage. */ }
    return () => { clearTimeout(batchTimer.current); clearTimeout(idleTimer.current); };
  }, []);
  const take = (text: string) => {
    const parts = text.split(/[\r\n,;\t ]+/).filter(Boolean);
    const good = parts.map(normalizeEpc).filter(Boolean) as string[];
    if (parts.length && good.length < parts.length) setBad(`Not an RFID number: ${parts.find((part) => !normalizeEpc(part))}`);
    else if (good.length) setBad("");
    const fresh = good.filter((epc) => !seen.current.has(epc));
    if (!fresh.length) return;
    for (const epc of fresh) seen.current.add(epc);
    batch.current.push(...fresh);
    setCount(seen.current.size);
    signalRead();
    clearTimeout(batchTimer.current);
    batchTimer.current = setTimeout(() => {
      const list = batch.current;
      batch.current = [];
      if (list.length) latest.current(list);
    }, BATCH_MS);
  };
  const flush = () => {
    const el = input.current;
    if (!el?.value) return;
    const text = el.value;
    el.value = "";
    take(text);
  };
  const toggleKeyboard = (on: boolean) => {
    setHideKeyboard(on);
    try { localStorage.setItem("rfid-hide-keyboard", on ? "1" : "0"); } catch { /* Only a convenience. */ }
    input.current?.focus();
  };
  return (
    <div>
      <div className="relative">
        <Radio className="pointer-events-none absolute left-3 top-3.5 h-5 w-5 text-slate-400" />
        <Input
          ref={input}
          defaultValue=""
          inputMode={hideKeyboard ? "none" : "text"}
          autoCapitalize="characters"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          onInput={(e) => {
            clearTimeout(idleTimer.current);
            const value = e.currentTarget.value;
            // A reader that ends each number with a space, or sends several together.
            if (/[\s,;]/.test(value)) { flush(); return; }
            if (value.length >= FULL_EPC) idleTimer.current = setTimeout(flush, IDLE_MS);
          }}
          onPaste={(e) => { const text = e.clipboardData.getData("text"); if (/[\r\n,;\t ]/.test(text.trim())) { e.preventDefault(); take(text); } }}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); clearTimeout(idleTimer.current); flush(); } }}
          onBlur={(e) => { if (!e.relatedTarget) setTimeout(() => input.current?.focus(), 150); }}
          placeholder={placeholder}
          aria-label="RFID reader input"
          className="h-12 pl-11 font-mono text-base"
        />
      </div>
      {bad && <p className="mt-1 text-sm text-red-700">{bad}</p>}
      <div className="mt-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-slate-500">
        <span>Keep the cursor here and pull the trigger, or type a number and press Enter.{count > 0 && <strong className="ml-1 text-slate-700">{count} read.</strong>}</span>
        <label className="flex min-h-8 items-center gap-1.5"><input type="checkbox" checked={hideKeyboard} onChange={(e) => toggleKeyboard(e.target.checked)} />Hide the on-screen keyboard</label>
      </div>
    </div>
  );
}
