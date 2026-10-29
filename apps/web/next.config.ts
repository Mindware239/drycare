import type { NextConfig } from "next";
import { networkInterfaces } from "node:os";

/** This PC's own IPv4 addresses (e.g. 192.168.1.24), so phones and other PCs on the shop network can open the dev server. */
const lanAddresses = Object.values(networkInterfaces()).flat().filter((a) => a && a.family === "IPv4" && !a.internal).map((a) => a!.address);

const API = process.env.API_INTERNAL_URL ?? "http://localhost:4000";
/** `pnpm build:static` produces plain files in ./out, served by the API inside the desktop app. */
const staticExport = process.env.NEXT_OUTPUT === "export";

const config: NextConfig = {
  transpilePackages: ["@drycare/shared"],
  ...(staticExport
    ? { output: "export", images: { unoptimized: true } }
    : {
        // Dev only: lets the dev server be opened at 127.0.0.1 and at this PC's network address from phones/PCs
        // on the shop network, e.g. http://192.168.1.24:3210. Production builds do not use this.
        allowedDevOrigins: ["127.0.0.1", ...lanAddresses],
        // Dev: same-origin API proxy so the session cookie stays first-party and SameSite works.
        async rewrites() {
          return [{ source: "/api/v1/:path*", destination: `${API}/api/v1/:path*` }];
        },
      }),
};

export default config;
