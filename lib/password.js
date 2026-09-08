import { pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";

const ITERATIONS = 210000;
const KEYLEN = 32;
const DIGEST = "sha256";

export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(password, salt, ITERATIONS, KEYLEN, DIGEST);
  return `pbkdf2_sha256$${ITERATIONS}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export function verifyPassword(password, encoded) {
  try {
    const [scheme, iterationText, saltText, hashText] = encoded.split("$");
    if (scheme !== "pbkdf2_sha256") return false;
    const iterations = Number(iterationText);
    const salt = Buffer.from(saltText, "base64url");
    const expected = Buffer.from(hashText, "base64url");
    const actual = pbkdf2Sync(password, salt, iterations, expected.length, DIGEST);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}
