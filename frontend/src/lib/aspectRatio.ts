export const ASPECT_RATIOS = ['9:16', '16:9', '1:1'] as const;

const EXPORT_RESOLUTIONS: Record<(typeof ASPECT_RATIOS)[number], readonly string[]> = {
  '9:16': ['1080x1920', '720x1280'],
  '16:9': ['1920x1080', '1280x720', '640x360'],
  '1:1': ['1080x1080', '720x720'],
};

export function exportResolutionsForAspectRatio(ratio: string): readonly string[] {
  return EXPORT_RESOLUTIONS[ratio as keyof typeof EXPORT_RESOLUTIONS] ?? EXPORT_RESOLUTIONS['16:9'];
}

export function getAspectRatioCssValue(ratio: string): string {
  if (ratio === '9:16' || ratio === '16:9' || ratio === '1:1') {
    return ratio.replace(':', ' / ');
  }
  return '16 / 9';
}

export function detectPromptAspectRatioConflict(
  prompt: string,
  masterRatio: string,
): { detected: string[]; conflict: boolean } {
  // Normalize the full-width punctuation users commonly paste from
  // Chinese prompts, while keeping the original prompt untouched.
  const normalizedPrompt = prompt.replace(/[：]/g, ':').replace(/\s*:\s*/g, ':');
  const detected = ASPECT_RATIOS.filter((ratio) => {
    const escaped = ratio.replace(':', '\\:');
    return new RegExp(`(?:^|\\s|[,(])${escaped}(?=$|\\s|[.),])`).test(normalizedPrompt);
  });
  return { detected, conflict: detected.some((ratio) => ratio !== masterRatio) };
}

export function resolutionMatchesAspectRatio(resolution: string, ratio: string): boolean {
  const match = /^(\d+)x(\d+)$/.exec(resolution);
  if (!match || !ASPECT_RATIOS.includes(ratio as (typeof ASPECT_RATIOS)[number])) return false;
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  const width = Number(match[1]);
  const height = Number(match[2]);
  const [ratioWidth, ratioHeight] = ratio.split(':').map(Number);
  const divisor = gcd(width, height);
  const ratioDivisor = gcd(ratioWidth, ratioHeight);
  return width / divisor === ratioWidth / ratioDivisor && height / divisor === ratioHeight / ratioDivisor;
}
