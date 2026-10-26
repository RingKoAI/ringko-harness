import { isIP } from "node:net";

function ipv4(value: string): string | undefined {
  if (isIP(value) === 4) return value;
  const mapped = /^::ffff:([a-f\d]{1,4}):([a-f\d]{1,4})$/i.exec(value);
  if (!mapped) return undefined;
  const high = parseInt(mapped[1], 16), low = parseInt(mapped[2], 16);
  return [high >>> 8, high & 255, low >>> 8, low & 255].join(".");
}
function hostname(value: string): string { return value.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, ""); }

/** HTTP catalog mirrors are accepted only on literal loopback addresses/names. */
export function isLoopbackHost(value: string): boolean {
  const host = hostname(value), address = ipv4(host);
  return host === "localhost" || host.endsWith(".localhost") || host === "::1" || (address?.startsWith("127.") ?? false);
}

/** Local deployments need an explicit catalog mapping instead of guessed lab capacities. */
export function isLocalModelHost(value: string): boolean {
  const host = hostname(value);
  if (isLoopbackHost(host) || host.endsWith(".local") || host === "local" || host === "::") return true;
  const address = ipv4(host);
  if (address) {
    const [first, second] = address.split(".").map(Number);
    return first === 0 || first === 10 || (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) || (first === 169 && second === 254) || (first === 100 && second >= 64 && second <= 127);
  }
  return isIP(host) === 6 && (/^f[cd]/.test(host) || /^fe[89ab]/.test(host));
}
