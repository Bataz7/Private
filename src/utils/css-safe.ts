// A banner ends up inside a CSS url(...): quotes, brackets, backslashes and spaces could close it and inject styles.
// Returns '' for such a value, so it is never stored or shown.
export const cssSafeUrl = (value: unknown) => { const text = String(value ?? ''); return /['"()\\\s<>]/.test(text) ? '' : text; };
