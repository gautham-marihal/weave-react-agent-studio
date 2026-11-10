// A picture's quality, measured in the browser the way the runtime measures it (MEDIA_PROTOCOL; the request_image
// `quality` standard): sharpness is the variance of the picture's edges (a Laplacian) at 640 px wide, brightness its
// average from 0 (black) to 255 (white). Used by the simulated agent, so an author can see the numbers a photo gets
// without a server. Numbers about the picture, never what is on it.

const WIDTH = 640;

// { width, height, sharpness, brightness } of grey values (0–255) laid out row by row.
export function measureGrey(grey, w, h) {
  let sum = 0;
  for (let i = 0; i < grey.length; i += 1) sum += grey[i];
  const brightness = grey.length ? sum / grey.length : 0;
  let n = 0;
  let mean = 0;
  let m2 = 0;
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const i = y * w + x;
      const lap = grey[i - 1] + grey[i + 1] + grey[i - w] + grey[i + w] - 4 * grey[i];
      n += 1;
      const d = lap - mean;
      mean += d / n;
      m2 += d * (lap - mean);
    }
  }
  return { sharpness: n > 1 ? m2 / n : 0, brightness };
}

const round = (v, places = 1) => Math.round(v * 10 ** places) / 10 ** places;

// Draws a picture (an ImageBitmap, image or video element) at 640 px wide and measures it.
function measureDrawable(source, width, height) {
  const w = Math.min(WIDTH, width);
  const h = Math.max(1, Math.round((height * w) / width));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  const grey = new Float32Array(w * h);
  for (let i = 0, p = 0; i < grey.length; i += 1, p += 4) grey[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  const { sharpness, brightness } = measureGrey(grey, w, h);
  return { width, height, sharpness: round(sharpness), brightness: round(brightness) };
}

// A chosen file: its measurements, or { error: 'not_an_image' } when the bytes are not a picture.
export async function measureFile(file) {
  try {
    const bitmap = await createImageBitmap(file);
    const out = measureDrawable(bitmap, bitmap.width, bitmap.height);
    bitmap.close?.();
    return out;
  } catch {
    return { error: 'not_an_image' };
  }
}

// One frame of a playing video (the camera), or null when it has none yet.
export function measureFrame(video) {
  if (!video || !video.videoWidth || !video.videoHeight) return null;
  return measureDrawable(video, video.videoWidth, video.videoHeight);
}
