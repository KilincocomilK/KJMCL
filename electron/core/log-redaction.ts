export function redact(text: string, secrets: string[] = []) {
  let s = text;
  for (const secret of secrets) if (secret.length > 1) s = s.split(secret).join('[REDACTED]');
  return s
    .replace(/(Bearer\s+|--accessToken[=\s]+)[^\s]+/gi, '$1[REDACTED]')
    .replace(
      /((?:access_?token|refresh_?token|client_?secret)["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi,
      '$1[REDACTED]',
    );
}
