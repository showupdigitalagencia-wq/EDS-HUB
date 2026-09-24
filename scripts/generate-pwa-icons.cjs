const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const inputLogo = path.join(__dirname, '../src/assets/eds-logo.png');
const publicDir = path.join(__dirname, '../public');

async function generateIcons() {
  console.log('Generating PWA icons from:', inputLogo);
  const metadata = await sharp(inputLogo).metadata();
  console.log(`Original logo: ${metadata.width}x${metadata.height}`);

  const bgNavy = { r: 8, g: 37, b: 79, alpha: 1 }; // #08254f brand navy

  // 1. Regular 512x512
  {
    const targetW = 420;
    const targetH = Math.round(targetW * (metadata.height / metadata.width));
    const resizedLogo = await sharp(inputLogo)
      .resize(targetW, targetH, { fit: 'contain' })
      .toBuffer();

    await sharp({
      create: {
        width: 512,
        height: 512,
        channels: 4,
        background: bgNavy,
      },
    })
      .composite([{ input: resizedLogo, gravity: 'center' }])
      .png()
      .toFile(path.join(publicDir, 'pwa-512x512.png'));
    console.log('Created pwa-512x512.png');
  }

  // 2. Regular 192x192
  {
    const targetW = 156;
    const targetH = Math.round(targetW * (metadata.height / metadata.width));
    const resizedLogo = await sharp(inputLogo)
      .resize(targetW, targetH, { fit: 'contain' })
      .toBuffer();

    await sharp({
      create: {
        width: 192,
        height: 192,
        channels: 4,
        background: bgNavy,
      },
    })
      .composite([{ input: resizedLogo, gravity: 'center' }])
      .png()
      .toFile(path.join(publicDir, 'pwa-192x192.png'));
    console.log('Created pwa-192x192.png');
  }

  // 3. Maskable 512x512 (Safe zone ~ 70% to prevent edge clipping on Android)
  {
    const targetW = 350;
    const targetH = Math.round(targetW * (metadata.height / metadata.width));
    const resizedLogo = await sharp(inputLogo)
      .resize(targetW, targetH, { fit: 'contain' })
      .toBuffer();

    await sharp({
      create: {
        width: 512,
        height: 512,
        channels: 4,
        background: bgNavy,
      },
    })
      .composite([{ input: resizedLogo, gravity: 'center' }])
      .png()
      .toFile(path.join(publicDir, 'pwa-maskable-512x512.png'));
    console.log('Created pwa-maskable-512x512.png');
  }

  // 4. Maskable 192x192
  {
    const targetW = 130;
    const targetH = Math.round(targetW * (metadata.height / metadata.width));
    const resizedLogo = await sharp(inputLogo)
      .resize(targetW, targetH, { fit: 'contain' })
      .toBuffer();

    await sharp({
      create: {
        width: 192,
        height: 192,
        channels: 4,
        background: bgNavy,
      },
    })
      .composite([{ input: resizedLogo, gravity: 'center' }])
      .png()
      .toFile(path.join(publicDir, 'pwa-maskable-192x192.png'));
    console.log('Created pwa-maskable-192x192.png');
  }

  // 5. Apple Touch Icon 180x180
  {
    const targetW = 146;
    const targetH = Math.round(targetW * (metadata.height / metadata.width));
    const resizedLogo = await sharp(inputLogo)
      .resize(targetW, targetH, { fit: 'contain' })
      .toBuffer();

    await sharp({
      create: {
        width: 180,
        height: 180,
        channels: 4,
        background: bgNavy,
      },
    })
      .composite([{ input: resizedLogo, gravity: 'center' }])
      .png()
      .toFile(path.join(publicDir, 'apple-touch-icon.png'));
    console.log('Created apple-touch-icon.png');
  }

  // 6. Favicon 64x64
  {
    const targetW = 54;
    const targetH = Math.round(targetW * (metadata.height / metadata.width));
    const resizedLogo = await sharp(inputLogo)
      .resize(targetW, targetH, { fit: 'contain' })
      .toBuffer();

    await sharp({
      create: {
        width: 64,
        height: 64,
        channels: 4,
        background: bgNavy,
      },
    })
      .composite([{ input: resizedLogo, gravity: 'center' }])
      .png()
      .toFile(path.join(publicDir, 'favicon.png'));
    console.log('Updated favicon.png');
  }

  console.log('All PWA icons successfully generated.');
}

generateIcons().catch((err) => {
  console.error('Error generating icons:', err);
  process.exit(1);
});
