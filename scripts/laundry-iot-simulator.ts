/**
 * Simulated smart-machine controller implementing the contract in docs/LAUNDRY_IOT.md.
 * Use it to try "Connected controller" mode without hardware, or as a reference for a vendor.
 *
 *   pnpm laundry-iot-sim                 → http://localhost:4600, 1 minute of cycle = 1 second
 *   LAUNDRY_SIM_PORT=4700 LAUNDRY_SIM_SPEEDUP=1 pnpm laundry-iot-sim   (real-time cycles)
 *
 * Extra test hooks (not part of the contract): POST /machines/{id}/fault puts a machine in error,
 * POST /machines/{id}/offline makes it stop answering.
 */
import { createServer, type Server } from "node:http";

type DeviceState = { state: "idle" | "running" | "done" | "error"; endsAt?: number; program?: string; error?: string; offline?: boolean };

export function startLaundrySimulator(port: number, opts: { speedup?: number; token?: string; log?: boolean } = {}): Promise<{ server: Server; url: string; devices: Map<string, DeviceState> }> {
  const speedup = opts.speedup ?? 60;
  const devices = new Map<string, DeviceState>();
  const json = (res: import("node:http").ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const server = createServer((req, res) => {
    const m = req.url?.match(/^\/machines\/([^/]+)\/(start|status|fault|offline|reset)$/);
    if (!m) return json(res, 404, { error: "not found" });
    if (opts.token && req.headers.authorization !== `Bearer ${opts.token}`) return json(res, 401, { error: "unauthorized" });
    const id = decodeURIComponent(m[1]);
    const action = m[2];
    const dev = devices.get(id) ?? { state: "idle" as const };
    devices.set(id, dev);
    if (dev.offline && action !== "reset") return; // never answers: DryCare must time out safely
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (dev.state === "running" && dev.endsAt && Date.now() >= dev.endsAt) dev.state = "done";
      if (action === "status" && req.method === "GET") {
        return json(res, 200, { state: dev.state, ...(dev.state === "running" && dev.endsAt ? { remainingSeconds: Math.max(0, Math.round((dev.endsAt - Date.now()) / 1000)) } : {}), ...(dev.error ? { error: dev.error } : {}) });
      }
      if (action === "start" && req.method === "POST") {
        if (dev.state === "running") return json(res, 409, { accepted: false, error: "already running" });
        if (dev.state === "error") return json(res, 409, { accepted: false, error: dev.error ?? "machine fault" });
        const cycle = JSON.parse(body || "{}") as { durationMinutes?: number; programName?: string };
        const seconds = Math.max(1, ((cycle.durationMinutes ?? 30) * 60) / speedup);
        Object.assign(dev, { state: "running", endsAt: Date.now() + seconds * 1000, program: cycle.programName, error: undefined });
        if (opts.log) console.log(`[sim] ${id} started ${cycle.programName ?? ""} for ${seconds}s`);
        return json(res, 200, { accepted: true });
      }
      if (action === "fault") { Object.assign(dev, { state: "error", error: "Door sensor fault" }); return json(res, 200, { ok: true }); }
      if (action === "offline") { dev.offline = true; return; }
      if (action === "reset") { devices.set(id, { state: "idle" }); return json(res, 200, { ok: true }); }
      return json(res, 405, { error: "method not allowed" });
    });
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, devices })));
}

if (process.argv[1]?.endsWith("laundry-iot-simulator.ts")) {
  const port = Number(process.env.LAUNDRY_SIM_PORT ?? 4600);
  const speedup = Number(process.env.LAUNDRY_SIM_SPEEDUP ?? 60);
  const { url } = await startLaundrySimulator(port, { speedup, token: process.env.LAUNDRY_IOT_TOKEN, log: true });
  console.log(`DryCare laundry machine simulator on ${url} (cycles run ${speedup}× faster).`);
  console.log("In Laundry setup → Machines → Edit, choose 'Connected controller', address", url, "and any device ID.");
}
