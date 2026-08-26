export function downloadImage(dataUrl: string, filename: string): void {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename.replace(/[^a-z0-9_.-]+/gi, '-');
  link.click();
}
