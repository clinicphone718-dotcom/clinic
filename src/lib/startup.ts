export function isDirectAudioUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    const videoHosts = ['youtube.com', 'youtu.be', 'youtube-nocookie.com'];
    const isVideoHost = videoHosts.some((domain) =>
      hostname === domain || hostname.endsWith(`.${domain}`),
    );
    return url.protocol === 'https:' &&
      !isVideoHost &&
      /\.(mp3|m4a|ogg|wav)$/i.test(url.pathname);
  } catch {
    return false;
  }
}

export function isDirectImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && /\.(jpg|jpeg|png|webp|gif|avif)$/i.test(url.pathname);
  } catch {
    return false;
  }
}
