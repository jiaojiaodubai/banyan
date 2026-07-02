function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatStyleUpdatedTimestamp(date = new Date()): string {
  const offsetMinutes = -date.getTimezoneOffset();
  const offsetSign = offsetMinutes >= 0 ? "+" : "-";
  const offsetAbs = Math.abs(offsetMinutes);

  const datePart = [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("-");
  const timePart = [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join(":");
  const offsetPart = [
    pad(Math.floor(offsetAbs / 60)),
    pad(offsetAbs % 60),
  ].join(":");

  return `${datePart}T${timePart}${offsetSign}${offsetPart}`;
}

export function formatStyleUpdatedDate(updated: string): string {
  const value = String(updated || "").trim();
  return value.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? value;
}

export function updateStyleCodeUpdatedTimestamp(
  code: string,
  timestamp = formatStyleUpdatedTimestamp(),
): string {
  const literal = JSON.stringify(timestamp);
  const updatedPattern =
    /(\bINFO\s*=\s*\{[\s\S]*?\bupdated\s*:\s*)(["'])(?:\\.|(?!\2)[\s\S])*\2/;

  if (updatedPattern.test(code)) {
    return code.replace(updatedPattern, `$1${literal}`);
  }

  const infoEndPattern = /(\bINFO\s*=\s*\{[\s\S]*?)(\r?\n[ \t]*\};?)/;
  return code.replace(infoEndPattern, (_match, body: string, close: string) => {
    const lineEnding = close.startsWith("\r\n") ? "\r\n" : "\n";
    const closingIndent = close.match(/\r?\n([ \t]*)\}/)?.[1] ?? "";
    const trimmedBody = body.trimEnd();
    const separator = /[{,]\s*$/.test(trimmedBody) ? "" : ",";
    return `${trimmedBody}${separator}${lineEnding}${closingIndent}  updated: ${literal},${close}`;
  });
}
