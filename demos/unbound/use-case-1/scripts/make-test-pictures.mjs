// Test pictures for use case 1: a card photo to upload, and a camera video (MJPEG, 1280x720) of a person holding the same
// card, for Chrome's --use-file-for-fake-video-capture.
//   no argument      → test-pictures/: a drawn SPECIMEN identity card (surname TAN, given names WEI MING)
//   a card image     → test-pictures/custom/: that image as the upload (a bank card works too), and the camera video
//                      of it held up (run-e2e.mjs uses it with UB_PICTURES=custom)
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

//   bank             → test-pictures/bank/: a drawn virtual debit card of a FICTIONAL bank, 506 x 319 like a banking
//                      app's card image, with a name (WEI MING TAN) and a test card number
// Usage (from the project folder): node demos/unbound/use-case-1/scripts/make-test-pictures.mjs [card image | bank]
const root = new URL('../test-pictures', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const bank = process.argv[2] === 'bank';
const OUT = bank ? `${root}/bank` : process.argv[2] ? `${root}/custom` : root;
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: process.env.E2E_CHANNEL || 'chrome' });
const page = await browser.newPage();
await page.setContent('<canvas id="c"></canvas>');
if (bank) {
  const drawnCard = await page.evaluate(() => {
    const c = document.getElementById('c');
    c.width = 506;
    c.height = 319;
    const g = c.getContext('2d');
    const bg = g.createLinearGradient(0, 0, 506, 319);
    bg.addColorStop(0, '#4b1d6b');
    bg.addColorStop(1, '#c2185b');
    g.fillStyle = bg;
    g.beginPath();
    g.roundRect(0, 0, 506, 319, 18);
    g.fill();
    g.fillStyle = '#ffffff';
    g.font = 'bold 22px Arial';
    g.fillText('UNBOUND BANK', 28, 44);
    g.font = '15px Arial';
    g.fillText('VIRTUAL DEBIT CARD', 28, 68);
    g.fillStyle = '#e8c35a';
    g.fillRect(28, 96, 52, 38);
    g.fillStyle = '#ffffff';
    g.font = '30px Courier New';
    g.fillText('4000 0012 3456 7899', 28, 186);
    g.font = '12px Arial';
    g.fillText('VALID THRU', 28, 214);
    g.font = '16px Courier New';
    g.fillText('12/30', 110, 216);
    g.font = '22px Courier New';
    g.fillText('WEI MING TAN', 28, 262);
    g.font = 'bold 20px Arial';
    g.fillText('DEBIT', 420, 296);
    g.font = 'bold 13px Arial';
    g.fillStyle = 'rgba(255,255,255,0.75)';
    g.fillText('TEST CARD', 400, 44);
    return c.toDataURL('image/png').split(',')[1];
  });
  fs.writeFileSync(`${OUT}/source.png`, Buffer.from(drawnCard, 'base64'));
}
const given = bank ? `${OUT}/source.png` : process.argv[2];

let picture = null;
if (given) {
  const ext = path.extname(given).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  for (const old of fs.readdirSync(OUT).filter((f) => f.startsWith('card.'))) fs.rmSync(`${OUT}/${old}`);
  fs.copyFileSync(given, `${OUT}/card${ext === '.jpeg' ? '.jpg' : ext}`);
  picture = `data:${mime};base64,${fs.readFileSync(given).toString('base64')}`;
}

const drawn = await page.evaluate(async (given) => {
  const image = given
    ? await new Promise((done) => {
        const img = new Image();
        img.onload = () => done(img);
        img.src = given;
      })
    : null;
  const card = (g, x, y, w) => {
    const h = Math.round(w * 0.63);
    const s = w / 1000;
    g.save();
    g.translate(x, y);
    g.fillStyle = '#e9eef6';
    g.beginPath();
    g.roundRect(0, 0, w, h, 28 * s);
    g.fill();
    g.fillStyle = '#1f3b70';
    g.fillRect(0, 0, w, 110 * s);
    g.fillStyle = '#ffffff';
    g.font = `bold ${44 * s}px Arial`;
    g.fillText('UNBOUND REPUBLIC  ·  IDENTITY CARD', 40 * s, 72 * s);
    // the photo on the card
    g.fillStyle = '#c4cede';
    g.fillRect(40 * s, 150 * s, 250 * s, 320 * s);
    g.fillStyle = '#6b5446';
    g.beginPath();
    g.arc(165 * s, 270 * s, 70 * s, 0, Math.PI * 2);
    g.fill();
    g.fillRect(85 * s, 360 * s, 160 * s, 110 * s);
    g.fillStyle = '#111827';
    const row = (label, value, ty) => {
      g.font = `${26 * s}px Arial`;
      g.fillStyle = '#4b5563';
      g.fillText(label, 330 * s, ty * s);
      g.font = `bold ${42 * s}px Arial`;
      g.fillStyle = '#111827';
      g.fillText(value, 330 * s, (ty + 44) * s);
    };
    row('Surname', 'TAN', 170);
    row('Given names', 'WEI MING', 270);
    row('Card number', 'S8512345D', 370);
    row('Date of birth', '14 MAR 1985', 470);
    g.font = `${26 * s}px Arial`;
    g.fillStyle = '#4b5563';
    g.fillText('Date of expiry  14 MAR 2031', 40 * s, 560 * s);
    g.fillStyle = 'rgba(190, 30, 45, 0.55)';
    g.font = `bold ${36 * s}px Arial`;
    g.fillText('SPECIMEN', 760 * s, 600 * s);
    g.restore();
  };
  const c = document.getElementById('c');
  // the photo the customer uploads
  c.width = 1000;
  c.height = 630;
  const g = c.getContext('2d');
  card(g, 0, 0, 1000);
  const photo = c.toDataURL('image/png').split(',')[1];
  // the camera: a person (drawn) holding the card up beside their face
  const frames = [];
  c.width = 1280;
  c.height = 720;
  for (let i = 0; i < 30; i++) {
    g.fillStyle = '#d8d2c8';
    g.fillRect(0, 0, 1280, 720);
    g.fillStyle = '#b9b0a3';
    g.fillRect(0, 520, 1280, 200);
    // the person: head and shoulders, a small sway frame to frame
    const dx = Math.sin(i / 5) * 6;
    g.fillStyle = '#6b5446';
    g.beginPath();
    g.arc(330 + dx, 280, 120, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#2e4a7d';
    g.beginPath();
    g.roundRect(150 + dx, 420, 360, 320, 80);
    g.fill();
    // a face drawn with its parts (hair, ears, eyes, brows, nose, mouth), facing the camera
    const fx = 330 + dx;
    g.fillStyle = '#1f1a17';
    g.beginPath();
    g.ellipse(fx, 200, 124, 70, 0, Math.PI, 0);
    g.fill();
    g.fillStyle = '#6b5446';
    g.beginPath();
    g.ellipse(fx - 122, 285, 18, 30, 0, 0, Math.PI * 2);
    g.ellipse(fx + 122, 285, 18, 30, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.ellipse(fx - 42, 262, 20, 12, 0, 0, Math.PI * 2);
    g.ellipse(fx + 42, 262, 20, 12, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#2b2b2b';
    g.beginPath();
    g.arc(fx - 42, 262, 8, 0, Math.PI * 2);
    g.arc(fx + 42, 262, 8, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#2b2118';
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(fx - 64, 236);
    g.lineTo(fx - 22, 230);
    g.moveTo(fx + 22, 230);
    g.lineTo(fx + 64, 236);
    g.stroke();
    g.strokeStyle = '#4a382e';
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(fx, 272);
    g.lineTo(fx - 12, 312);
    g.lineTo(fx + 8, 314);
    g.stroke();
    g.strokeStyle = '#7a2e2e';
    g.lineWidth = 6;
    g.beginPath();
    g.arc(fx, 330, 30, 0.15 * Math.PI, 0.85 * Math.PI);
    g.stroke();
    // the card, held up, large enough to read
    if (image) g.drawImage(image, 560, 150 + dx / 2, 660, Math.round((660 * image.height) / image.width));
    else card(g, 560, 150 + dx / 2, 660);
    frames.push(c.toDataURL('image/jpeg', 0.92).split(',')[1]);
  }
  return { photo, frames };
}, picture);
if (!given) fs.writeFileSync(`${OUT}/id-card.png`, Buffer.from(drawn.photo, 'base64'));
fs.writeFileSync(`${OUT}/camera.mjpeg`, Buffer.concat(drawn.frames.map((f) => Buffer.from(f, 'base64'))));
await page.setContent(`<img src="data:image/jpeg;base64,${drawn.frames[0]}" style="width:1280px">`);
await page.setViewportSize({ width: 1280, height: 720 });
await page.screenshot({ path: `${OUT}/camera-frame.png` });
await browser.close();
console.log('written:', fs.readdirSync(OUT).join(', '));
