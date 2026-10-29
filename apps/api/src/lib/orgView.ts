/** Organization rows without the logo bytes (served separately), plus whether a logo exists. */
export function orgView<T extends { logoData?: unknown; logoMimeType?: string | null }>(row: T) {
  const { logoData, ...rest } = row;
  return { ...rest, hasLogo: Boolean(logoData && row.logoMimeType) };
}
