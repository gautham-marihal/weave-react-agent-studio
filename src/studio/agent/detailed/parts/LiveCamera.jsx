import React, { useEffect, useRef, useState } from 'react';
import Icon from '../../../../ui/Icon.jsx';
import Button from '../../../../ui/Button.tsx';
import { measureFrame } from '../../../pictures/measure.js';
import { STRICTNESS } from '../../../pictures/strictness.js';
import { pictureSteps } from '../../../pictures/mediaModel.js';
import { qualityVerdict } from '../../../../demo/simulatedPictures.js';

// what a refusal means, for the line under a check
const WHY = { too_small: 'too small', too_blurry: 'too blurred', too_dark: 'too dark', too_bright: 'too bright' };

// The camera, as a customer's video check sees it: the person's own camera, live and large, with the numbers the server
// measures on a frame (size, sharpness and brightness) beside each video check's whole standard, judged the way the
// runtime judges it (qualityVerdict). Nothing is recorded or sent: the picture stays in this browser and the camera is
// switched off on leaving.

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

export default function LiveCamera({ ctx }) {
  const video = useRef(null);
  const stream = useRef(null);
  const [state, setState] = useState('off'); // off | starting | on | denied | none
  const [numbers, setNumbers] = useState(null);
  const stop = () => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setState('off');
    setNumbers(null);
  };
  const start = async () => {
    if (!navigator.mediaDevices?.getUserMedia) return setState('none');
    setState('starting');
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      if (video.current) video.current.srcObject = stream.current;
      setState('on');
    } catch (error) {
      setState(error?.name === 'NotAllowedError' ? 'denied' : 'none');
    }
    return undefined;
  };
  // measured twice a second while it is on
  useEffect(() => {
    if (state !== 'on') return undefined;
    const timer = window.setInterval(() => {
      const v = video.current;
      if (!v || v.readyState < 2) return;
      try {
        setNumbers(measureFrame(v));
      } catch {
        /* a frame that couldn't be read: the next one is */
      }
    }, 500);
    return () => window.clearInterval(timer);
  }, [state]);
  // the camera goes off with the page
  useEffect(() => () => stream.current?.getTracks().forEach((t) => t.stop()), []);

  // the bars the agent's own video checks set, else the standard one
  const checks = pictureSteps(ctx.config)
    .filter((h) => h.step.type === 'request_image' && h.step.kind === 'camera')
    .map((h) => ({ into: h.step.into, quality: isObj(h.step.quality) ? h.step.quality : {} }));
  const bars = checks.length ? checks : [{ into: 'the standard check', quality: STRICTNESS.camera.standard }];
  const sharp = numbers ? Math.round(numbers.sharpness) : null;
  const bright = numbers ? Math.round(numbers.brightness) : null;

  return (
    <div className="mvCam">
      <div className={`mvCamStage ${state}`}>
        <video ref={video} autoPlay playsInline muted aria-label="Your camera, live" />
        {state !== 'on' && (
          <div className="mvCamOff">
            <Icon name={state === 'denied' || state === 'none' ? 'cameraOff' : 'camera'} size={30} />
            <b>
              {state === 'denied'
                ? 'The browser wasn’t allowed to use the camera'
                : state === 'none'
                  ? 'No camera was found'
                  : state === 'starting'
                    ? 'Starting the camera…'
                    : 'See what a video check sees'}
            </b>
            <span>
              {state === 'denied'
                ? 'Allow the camera for this site in the browser’s address bar, then try again.'
                : 'Hold a card beside your face, as a customer would. Nothing is recorded or sent anywhere.'}
            </span>
            {state !== 'starting' && (
              <Button type="button" variant="primary" size="small" onClick={start}>
                <Icon name="camera" size={14} />
                {state === 'off' ? 'Turn on my camera' : 'Try again'}
              </Button>
            )}
          </div>
        )}
      </div>
      <div className="mvCamSide">
        <div className="cnField">
          <span className="cnLabel">Measured now</span>
          <dl className="mvFacts">
            <dt>Sharpness</dt>
            <dd>{sharp ?? '—'}</dd>
            <dt>Brightness</dt>
            <dd>{bright === null ? '—' : `${bright} of 255`}</dd>
            <dt>Size</dt>
            <dd>{numbers ? `${numbers.width} × ${numbers.height} px` : '—'}</dd>
          </dl>
        </div>
        <div className="cnField">
          <span className="cnLabel">{checks.length ? 'Its video checks' : 'The standard video check'}</span>
          <ul className="mvChecks">
            {bars.map((b, i) => {
              const q = b.quality;
              // the whole standard, as the runtime checks a frame: its size, sharpness and brightness
              const code = numbers ? qualityVerdict(q, numbers) : '';
              const asks = [
                typeof q.min_dimension === 'number' && `at least ${q.min_dimension} px`,
                `sharpness ${typeof q.min_sharpness === 'number' ? q.min_sharpness : 'not checked'}`,
                typeof q.min_brightness === 'number' && `brightness ${q.min_brightness}`,
                typeof q.max_brightness === 'number' && `at most ${q.max_brightness} bright`,
              ].filter(Boolean);
              return (
                <li key={`${b.into}-${i}`} className={numbers ? (code ? 'bad' : 'good') : ''}>
                  <Icon name={!numbers ? 'camera' : code ? 'close' : 'check'} size={12} />
                  <span>
                    {b.into ? `Kept as ${b.into}` : ''}: {asks.join(', ')}
                    {!numbers ? '' : code ? ` · this frame is ${WHY[code] || 'refused'}` : ' · this frame passes'}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
        <small className="mvNote">Video is compressed, so even a blurred frame scores about 10. Keep the card still and close to read a passing number.</small>
        {state === 'on' && (
          <Button type="button" variant="secondary" size="small" onClick={stop}>
            <Icon name="cameraOff" size={14} />
            Turn off my camera
          </Button>
        )}
      </div>
    </div>
  );
}
