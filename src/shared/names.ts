/** The household knows each other: only first names are shown ("Luca Nuber" → "Luca"). */
export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] || fullName;
}
