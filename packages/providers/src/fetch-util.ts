/** Normalize any `HeadersInit` into a mutable `Headers` copy. */
export function copyHeaders(init: HeadersInit | undefined): Headers {
  const headers = new Headers();
  if (init instanceof Headers) {
    init.forEach((value, key) => headers.set(key, value));
  } else if (Array.isArray(init)) {
    for (const [key, value] of init) headers.set(key, value);
  } else if (init) {
    for (const [key, value] of Object.entries(init)) headers.set(key, value);
  }
  return headers;
}
