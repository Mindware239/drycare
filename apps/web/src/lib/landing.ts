import { api } from "@/lib/api";

/** The first screen a freshly signed-in account may use (kiosk tablets go straight to the customer screen). */
export async function landingPath() {
  const session = await api<{ permissions: string[] }>("/auth/session").catch(() => null);
  const has = (p: string) => session?.permissions.includes(p) ?? true;
  return has("reports.view") ? "/dashboard"
    : has("orders.create") ? "/pos"
    : has("orders.read") ? "/orders"
    : has("laundry.operate") ? "/laundry-kiosk"
    : has("laundry.view") ? "/laundry"
    : "/dashboard";
}
