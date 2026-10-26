export const newId = () => crypto.randomUUID();

/** 32 random bytes, base64url: used for iCal feed tokens. */
export function newSecretToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
