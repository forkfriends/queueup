const POSTER_WIDTH = 1080;
const POSTER_HEIGHT = 1920;
const QR_SIZE = 512;
const LOGO_PATH = '/icon-black.svg';
const FONT_FAMILY = 'Plus Jakarta Sans, "Helvetica Neue", "Segoe UI", sans-serif';

const GRADIENT_SETS: [string, string, number][] = [
  ['#667eea', '#764ba2', 135],
  ['#5f27cd', '#341f97', 180],
  ['#4834df', '#341f97', 45],
  ['#4facfe', '#00537e', 180],
  ['#2e3192', '#1bffff', 225],
  ['#2980b9', '#2c3e50', 90],
  ['#ee0979', '#ff6a00', 135],
  ['#fc466b', '#3f5efb', 45],
  ['#f953c6', '#b91d73', 180],
  ['#11998e', '#38ef7d', 90],
  ['#00b09b', '#96c93d', 135],
  ['#134e5e', '#71b280', 225],
  ['#ff416c', '#ff4b2b', 45],
  ['#f12711', '#f5af19', 180],
  ['#ff5f6d', '#ffc371', 90],
  ['#a044ff', '#6a3093', 135],
  ['#c94b4b', '#4b134f', 225],
  ['#8e44ad', '#c0392b', 45],
  ['#000428', '#004e92', 180],
  ['#1c92d2', '#f2fcfe', 90],
  ['#360033', '#0b8793', 135],
  ['#f46b45', '#eea849', 225],
  ['#dd5e89', '#f7bb97', 45],
  ['#232526', '#414345', 180],
  ['#0f2027', '#203a43', 90],
  ['#3e5151', '#decba4', 135],
];

export type PosterDetailOptions = {
  slug: string;
  joinUrl?: string | null;
  detailLines?: string[];
  blackWhiteMode?: boolean;
};

let cachedLogoDataUri: string | undefined;

function ensureSvgHasDimensions(svgContent: string): string {
  const openingTagMatch = svgContent.match(/<svg\b[^>]*>/i);
  if (!openingTagMatch) {
    return svgContent;
  }

  const absoluteSizeRegex = /^\s*\d+(?:\.\d+)?(?:px)?\s*$/i;
  const openingTag = openingTagMatch[0];
  const widthMatch = openingTag.match(/\bwidth\s*=\s*"([^"]+)"/i);
  const heightMatch = openingTag.match(/\bheight\s*=\s*"([^"]+)"/i);

  const hasWidth = widthMatch && absoluteSizeRegex.test(widthMatch[1]);
  const hasHeight = heightMatch && absoluteSizeRegex.test(heightMatch[1]);

  if (hasWidth && hasHeight) {
    return svgContent;
  }

  const viewBoxMatch = svgContent.match(/viewBox\s*=\s*"([^"]+)"/i);
  let fallbackWidth = 512;
  let fallbackHeight = 512;

  if (viewBoxMatch) {
    const nums = viewBoxMatch[1]
      .trim()
      .split(/\s+/)
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value));
    if (nums.length === 4) {
      fallbackWidth = nums[2] || fallbackWidth;
      fallbackHeight = nums[3] || fallbackHeight;
    }
  }

  let updatedOpeningTag = openingTag;
  const additions: string[] = [];

  if (widthMatch && !hasWidth) {
    updatedOpeningTag = updatedOpeningTag.replace(widthMatch[0], `width="${fallbackWidth}"`);
  } else if (!widthMatch) {
    additions.push(`width="${fallbackWidth}"`);
  }

  if (heightMatch && !hasHeight) {
    updatedOpeningTag = updatedOpeningTag.replace(heightMatch[0], `height="${fallbackHeight}"`);
  } else if (!heightMatch) {
    additions.push(`height="${fallbackHeight}"`);
  }

  if (additions.length) {
    updatedOpeningTag = updatedOpeningTag.replace(/\s*\/?>$/, (match) => ` ${additions.join(' ')}${match}`);
  }

  return svgContent.replace(openingTag, updatedOpeningTag);
}

async function loadLogoDataUri(): Promise<string | undefined> {
  if (cachedLogoDataUri) {
    return cachedLogoDataUri;
  }

  if (typeof fetch === 'undefined') {
    return undefined;
  }

  try {
    const response = await fetch(LOGO_PATH);
    if (!response.ok) {
      return undefined;
    }
    const svgContent = await response.text();
    const patchedSvg = ensureSvgHasDimensions(svgContent);
    let encoded: string | undefined;
    if (typeof window !== 'undefined' && typeof window.btoa === 'function') {
      encoded = window.btoa(unescape(encodeURIComponent(patchedSvg)));
    } else {
      const maybeBuffer = (globalThis as any)?.Buffer;
      if (maybeBuffer?.from) {
        encoded = maybeBuffer.from(patchedSvg, 'utf8').toString('base64');
      } else {
        const base64 = (globalThis as any)?.btoa as ((value: string) => string) | undefined;
        if (typeof base64 === 'function') {
          encoded = base64(unescape(encodeURIComponent(patchedSvg)));
        }
      }
    }
    if (!encoded) {
      return undefined;
    }
    cachedLogoDataUri = `data:image/svg+xml;base64,${encoded}`;
    return cachedLogoDataUri;
  } catch {
    return undefined;
  }
}

function drawRoundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function blobToImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = (error) => {
      URL.revokeObjectURL(url);
      reject(error);
    };
    image.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('Failed to create poster blob'));
      }
    }, 'image/png');
  });
}

async function generateQrBlob(data: string): Promise<Blob> {
  const module = await import('qr-code-styling');
  const QRCodeStylingCtor = (module.default ?? (module as any).QRCodeStyling) as any;
  if (!QRCodeStylingCtor) {
    throw new Error('QR generator unavailable');
  }

  const qrCode = new QRCodeStylingCtor({
    width: QR_SIZE,
    height: QR_SIZE,
    type: 'png',
    data,
    imageOptions: { hideBackgroundDots: true, crossOrigin: 'anonymous' },
    qrOptions: { errorCorrectionLevel: 'H' },
    dotsOptions: { type: 'rounded', color: '#000000' },
    backgroundOptions: { color: '#FFFFFF' },
  });

  const qrData = await qrCode.getRawData('png');
  if (!qrData) {
    throw new Error('Failed to render QR code');
  }

  if (qrData instanceof Blob) {
    return qrData;
  }

  if (qrData instanceof ArrayBuffer) {
    return new Blob([qrData], { type: 'image/png' });
  }

  if (ArrayBuffer.isView(qrData)) {
    return new Blob([qrData.buffer], { type: 'image/png' });
  }

  throw new Error('Unsupported QR data format');
}

function loadImageFromSrc(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function addLogoToQr(qrImage: HTMLImageElement, logoDataUri?: string): Promise<HTMLImageElement> {
  if (!logoDataUri) {
    return qrImage;
  }

  const canvas = document.createElement('canvas');
  canvas.width = QR_SIZE;
  canvas.height = QR_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return qrImage;
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(qrImage, 0, 0, QR_SIZE, QR_SIZE);

  try {
    const logoImg = await loadImageFromSrc(logoDataUri);
    const logoSize = QR_SIZE * 0.3;
    const logoX = (QR_SIZE - logoSize) / 2;
    const logoY = (QR_SIZE - logoSize) / 2;
    const margin = 6;
    const plaqueSize = logoSize + margin * 2;
    const plaqueX = logoX - margin;
    const plaqueY = logoY - margin;
    const plaqueRadius = Math.round(POSTER_WIDTH * 0.035);

    ctx.fillStyle = '#FFFFFF';
    drawRoundedRect(ctx, plaqueX, plaqueY, plaqueSize, plaqueSize, plaqueRadius);
    ctx.fill();

    ctx.drawImage(logoImg, logoX, logoY, logoSize, logoSize);

    const blob = await canvasToBlob(canvas);
    return blobToImage(blob);
  } catch {
    return qrImage;
  }
}

type PosterContext = {
  ctx: CanvasRenderingContext2D;
  canvas: HTMLCanvasElement;
};

async function drawPoster(opts: {
  qrImage: HTMLImageElement;
  logoDataUri?: string;
  detailLines: string[];
  gradient: [string, string, number];
  blackWhiteMode: boolean;
}): Promise<PosterContext> {
  const canvas = document.createElement('canvas');
  canvas.width = POSTER_WIDTH;
  canvas.height = POSTER_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas context unavailable');
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const posterRadius = Math.round(POSTER_WIDTH * 0.035);
  drawRoundedRect(ctx, 0, 0, POSTER_WIDTH, POSTER_HEIGHT, posterRadius);
  ctx.clip();

  if (opts.blackWhiteMode) {
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, POSTER_WIDTH, POSTER_HEIGHT);
  } else {
    const [color1, color2, angle] = opts.gradient;
    const angleRad = (angle * Math.PI) / 180;
    const x1 = POSTER_WIDTH / 2 + Math.cos(angleRad) * POSTER_WIDTH;
    const y1 = POSTER_HEIGHT / 2 + Math.sin(angleRad) * POSTER_HEIGHT;
    const x2 = POSTER_WIDTH / 2 - Math.cos(angleRad) * POSTER_WIDTH;
    const y2 = POSTER_HEIGHT / 2 - Math.sin(angleRad) * POSTER_HEIGHT;
    const grad = ctx.createLinearGradient(x1, y1, x2, y2);
    grad.addColorStop(0, color1);
    grad.addColorStop(1, color2);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, POSTER_WIDTH, POSTER_HEIGHT);
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = opts.blackWhiteMode ? '#000000' : '#fdf7f0';

  const brandFontSize = Math.round(POSTER_WIDTH * 0.1);
  ctx.font = `700 ${brandFontSize}px ${FONT_FAMILY}`;
  const brandText = 'QueueUp';
  const brandTextMetrics = ctx.measureText(brandText);
  const brandIconSize = Math.round(brandFontSize * 2);
  const brandGap = Math.round(brandIconSize * 0.1);
  const totalWidth = brandIconSize + brandGap + brandTextMetrics.width;
  const startX = (POSTER_WIDTH - totalWidth) / 2;
  const brandY = POSTER_HEIGHT * 0.12 + brandFontSize * 0.35;

  if (opts.logoDataUri) {
    const logoImg = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = opts.logoDataUri!;
    });
    const iconCanvas = document.createElement('canvas');
    iconCanvas.width = brandIconSize;
    iconCanvas.height = brandIconSize;
    const iconCtx = iconCanvas.getContext('2d');
    if (iconCtx) {
      iconCtx.drawImage(logoImg, 0, 0, brandIconSize, brandIconSize);
      iconCtx.globalCompositeOperation = 'source-in';
      iconCtx.fillStyle = opts.blackWhiteMode ? '#000000' : '#fdf7f0';
      iconCtx.fillRect(0, 0, brandIconSize, brandIconSize);
      const metrics = ctx.measureText(brandText);
      const textCenterY =
        brandY - ((metrics.actualBoundingBoxAscent || brandFontSize) - (metrics.actualBoundingBoxDescent || 0)) / 2;
      const iconY = textCenterY - brandIconSize / 2;
      ctx.drawImage(iconCanvas, startX, iconY, brandIconSize, brandIconSize);
    }
  }

  const textX = startX + brandIconSize + brandGap + brandTextMetrics.width / 2;
  ctx.fillText(brandText, textX, brandY);

  const plaqueWidth = POSTER_WIDTH * 0.72;
  const plaqueHeight = plaqueWidth;
  const plaqueX = (POSTER_WIDTH - plaqueWidth) / 2;
  const plaqueY = POSTER_HEIGHT * 0.29;
  const plaqueRadius = Math.round(POSTER_WIDTH * 0.035);

  ctx.fillStyle = '#FFFFFF';
  drawRoundedRect(ctx, plaqueX, plaqueY, plaqueWidth, plaqueHeight, plaqueRadius);
  ctx.fill();

  if (opts.blackWhiteMode) {
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = Math.round(POSTER_WIDTH * 0.01);
    drawRoundedRect(ctx, plaqueX, plaqueY, plaqueWidth, plaqueHeight, plaqueRadius);
    ctx.stroke();
  }

  const qrMargin = plaqueWidth * 0.1;
  const qrSize = plaqueWidth - qrMargin * 2;
  ctx.drawImage(opts.qrImage, plaqueX + qrMargin, plaqueY + qrMargin, qrSize, qrSize);

  if (opts.detailLines.length) {
    ctx.fillStyle = opts.blackWhiteMode ? '#000000' : '#fdf7f0';
    const baseFontSize = Math.round(POSTER_WIDTH * 0.048);
    let currentY = plaqueY + plaqueHeight + POSTER_HEIGHT * 0.1;
    opts.detailLines.forEach((line, index) => {
      const fontSize = index === 0 ? Math.round(baseFontSize * 1.6) : baseFontSize;
      ctx.font = `${index === 0 ? '700' : '400'} ${fontSize}px ${FONT_FAMILY}`;
      ctx.fillText(line, POSTER_WIDTH / 2, currentY);
      currentY += Math.round(fontSize * 1.2);
    });
  }

  return { ctx, canvas };
}

export async function generatePosterImage(options: PosterDetailOptions): Promise<Blob> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('Poster generation is only available in the browser.');
  }

  if (!options.slug || options.slug.trim().length === 0) {
    throw new Error('Missing queue slug');
  }

  const normalizedSlug = options.slug.trim();
  const qrTarget = options.joinUrl?.trim() || `${window.location.origin}/queue/${normalizedSlug}`;

  const detailLines = (options.detailLines ?? [])
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (detailLines.length === 0) {
    detailLines.push(`Code ${normalizedSlug}`);
    detailLines.push('Scan to join the queue');
  }

  const gradient = GRADIENT_SETS[Math.floor(Math.random() * GRADIENT_SETS.length)];
  const qrBlob = await generateQrBlob(qrTarget);
  const logoDataUri = await loadLogoDataUri();
  let qrImage = await blobToImage(qrBlob);
  qrImage = await addLogoToQr(qrImage, logoDataUri);

  const { canvas } = await drawPoster({
    qrImage,
    logoDataUri,
    detailLines,
    gradient,
    blackWhiteMode: Boolean(options.blackWhiteMode),
  });

  return canvasToBlob(canvas);
}
