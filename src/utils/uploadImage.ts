const MAX_DIM = 1400;

async function optimizeImageBlob(blob: Blob): Promise<{ buf: ArrayBuffer; contentType: string }> {
  // Keep small images untouched if already JPEG/PNG/WebP/GIF under 1.5MB
  if (blob.size <= 1.5 * 1024 * 1024 && blob.type.startsWith('image/')) {
    return {
      buf: await blob.arrayBuffer(),
      contentType: blob.type || 'image/jpeg',
    };
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(blob);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height, 1));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas 2D unavailable for image resizing.'));
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        async (outBlob) => {
          if (!outBlob) {
            reject(new Error('Image compression failed.'));
            return;
          }
          resolve({
            buf: await outBlob.arrayBuffer(),
            contentType: 'image/jpeg',
          });
        },
        'image/jpeg',
        0.88,
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Could not decode selected image file.'));
    };
    img.src = objectUrl;
  });
}

async function postImageBuffer(buf: ArrayBuffer, contentType: string): Promise<string> {
  const imageId = `thumb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const resp = await fetch(`/api/images/${imageId}`, {
    method: 'POST',
    headers: { 'Content-Type': contentType || 'image/jpeg' },
    body: buf,
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(errText || `Upload failed (${resp.status})`);
  }
  const data = (await resp.json()) as { endpoint?: string };
  return data.endpoint || `/api/images/${imageId}`;
}

export async function uploadImageFile(file: File): Promise<string> {
  if (!file.type.startsWith('image/') && !/\.(png|jpe?g|webp|gif)$/i.test(file.name)) {
    throw new Error('Please choose a valid PNG, JPG, WebP, or GIF image.');
  }
  const { buf, contentType } = await optimizeImageBlob(file);
  return postImageBuffer(buf, contentType);
}

export async function uploadDataUrlImage(dataUrl: string): Promise<string> {
  if (!dataUrl.startsWith('data:image/')) {
    return dataUrl;
  }
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  const { buf, contentType } = await optimizeImageBlob(blob);
  return postImageBuffer(buf, contentType);
}
