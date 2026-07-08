// git blob hash = SHA-1 over the header `blob ` + the byte length + a 0x00 byte,
// followed by the raw file content. Equals `git hash-object <file>` for files with no
// .gitattributes/autocrlf text filters — true for guest-room today (no
// .gitattributes at the repo root). If guest-room ever adds text filters, this
// direct computation would diverge from git's; fall back to shelling
// `git hash-object` inside the checked-out tree at that point.
export async function gitBlobHash(bytes: Uint8Array): Promise<string> {
  const header = new TextEncoder().encode(`blob ${bytes.length}\0`);
  const buf = new Uint8Array(header.length + bytes.length);
  buf.set(header, 0);
  buf.set(bytes, header.length);
  const digest = await crypto.subtle.digest("SHA-1", buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
