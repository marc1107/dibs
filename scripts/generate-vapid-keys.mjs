// Generates a VAPID key pair for Web Push.
// Public key  -> wrangler.jsonc var VAPID_PUBLIC_KEY (also used by the browser).
// Private key -> Worker secret VAPID_PRIVATE_KEY (JWK JSON, keep it secret).
import { generateKeyPairSync } from "node:crypto";

const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const pub = publicKey.export({ format: "jwk" });
const rawPublic = Buffer.concat([
  Buffer.from([4]),
  Buffer.from(pub.x, "base64url"),
  Buffer.from(pub.y, "base64url"),
]).toString("base64url");

console.log("VAPID_PUBLIC_KEY (wrangler.jsonc var):");
console.log(rawPublic);
console.log("\nVAPID_PRIVATE_KEY (wrangler secret put VAPID_PRIVATE_KEY):");
console.log(JSON.stringify(privateKey.export({ format: "jwk" })));
