// Local UI identifiers are not authentication tokens. Keep creation available
// when randomUUID is missing, including older supported browser engines.
export function createLocalIdFactory({
  crypto = globalThis.crypto,
  now = Date.now,
  random = Math.random,
} = {}) {
  let sequence = 0;
  return (prefix) => {
    try {
      if (typeof crypto?.randomUUID === "function")
        return prefix + crypto.randomUUID().replaceAll("-", "");
      if (typeof crypto?.getRandomValues === "function") {
        const bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        return (
          prefix +
          [...bytes]
            .map((value) => value.toString(16).padStart(2, "0"))
            .join("")
        );
      }
    } catch {
      /* A local draft remains usable if the browser's crypto API fails. */
    }
    sequence++;
    return (
      prefix +
      Math.floor(now()).toString(36) +
      sequence.toString(36) +
      Math.floor(random() * 4294967296).toString(36)
    );
  };
}
