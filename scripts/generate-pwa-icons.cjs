// =============================================================================
// EDS HUB — PWA & iOS App Icon Generator
// =============================================================================
// Generates official Expert Dental Solutions PWA & Apple Touch icons using
// the authentic Athena crest emblem extracted directly from src/assets/eds-logo.png.
//
// Key Specifications:
// - Authentic Athena helmet crest, gold halo, red shield, and blue book
// - Pristine #ffffff canvas matching the original asset's native background
// - Preserves 100% natural anti-aliasing without color fringing or dark bleed
// - Safe-zone compliance for iOS rounded squares (~22.5% corner radius)
// - Android maskable safe zone (central 80% circle)
// - Zero generic "E" or text truncation
// =============================================================================

const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const inputLogo = path.join(__dirname, '../src/assets/eds-logo.png');
const emblemPath = path.join(__dirname, '../src/assets/eds-emblem.png');
const publicDir = path.join(__dirname, '../public');

async function generateAllIcons() {
  console.log('--- Generating Official Expert Dental Solutions PWA Icons ---');

  // 1. Extract the authentic Athena crest symbol from the left of the horizontal logo (x: 0 to 126, y: 0 to 160)
  await sharp(inputLogo)
    .extract({ left: 0, top: 0, width: 126, height: 160 })
    .png()
    .toFile(emblemPath);

  const emblemMetadata = await sharp(emblemPath).metadata();
  console.log(`Extracted emblem: ${emblemMetadata.width}x${emblemMetadata.height}`);

  const bgWhite = { r: 255, g: 255, b: 255, alpha: 1 }; // Clean #ffffff matching native logo design

  // Helper to create centered icon on crisp white background
  async function createSquareIcon(size, emblemScaleRatio, outputFile) {
    const emblemTargetHeight = Math.round(size * emblemScaleRatio);
    const emblemTargetWidth = Math.round(
      emblemTargetHeight * (emblemMetadata.width / emblemMetadata.height)
    );

    const resizedEmblem = await sharp(emblemPath)
      .resize(emblemTargetWidth, emblemTargetHeight, {
        fit: 'contain',
        kernel: sharp.kernel.lanczos3,
      })
      .toBuffer();

    await sharp({
      create: {
        width: size,
        height: size,
        channels: 4,
        background: bgWhite,
      },
    })
      .composite([{ input: resizedEmblem, gravity: 'center' }])
      .png()
      .toFile(path.join(publicDir, outputFile));

    console.log(`Generated ${outputFile} (${size}x${size}, scale: ${Math.round(emblemScaleRatio * 100)}%)`);
  }

  // 2. Regular PWA Icons (76% emblem height for clean margins)
  await createSquareIcon(512, 0.76, 'pwa-512x512.png');
  await createSquareIcon(192, 0.76, 'pwa-192x192.png');

  // 3. Apple Touch Icon for iOS / iPadOS Home Screen (74% emblem height, solid #ffffff, iOS squircle safe)
  await createSquareIcon(180, 0.74, 'apple-touch-icon.png');

  // 4. Android Maskable Icons (62% emblem height, strictly inside central 80% circle safe zone)
  await createSquareIcon(512, 0.62, 'pwa-maskable-512x512.png');
  await createSquareIcon(192, 0.62, 'pwa-maskable-192x192.png');

  // 5. Browser Favicon
  await createSquareIcon(64, 0.82, 'favicon.png');

  // Clean up any test files
  const testFiles = ['test-white.png', 'test-navy.png'];
  for (const tf of testFiles) {
    const p = path.join(publicDir, tf);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }

  console.log('--- All Official PWA Icons Generated Successfully ---');
}

generateAllIcons().catch((err) => {
  console.error('Failed to generate icons:', err);
  process.exit(1);
});
