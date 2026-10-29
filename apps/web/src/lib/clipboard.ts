/**
 * Copies text. Browsers only provide navigator.clipboard on HTTPS or localhost, so on the shop Wi-Fi
 * (e.g. http://192.168.1.24:47321) we fall back to a temporary text box + the older copy command.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (window.isSecureContext && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}
  const box = document.createElement("textarea");
  box.value = text;
  box.setAttribute("readonly", "");
  box.style.position = "fixed";
  box.style.opacity = "0";
  document.body.appendChild(box);
  box.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {}
  box.remove();
  return ok;
}
