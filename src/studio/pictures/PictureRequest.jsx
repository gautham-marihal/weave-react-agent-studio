import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../../ui/Icon.jsx';
import Button from '../../ui/Button.tsx';
import { GetReadyStage, SharedStage, TakePictureStage } from './CameraStage.jsx';
import { acceptWords, clockText, formatBytes, secondsLeft } from './pictureProtocol.js';
import './pictures.css';

// The card a picture request shows in a test conversation (the Test page, the side Try it, the guided setup's Try it),
// wherever the conversation is: what the agent wants, how long it will wait, the upload or the camera, why a photo was
// turned down (the agent's own sentence; the request stays open). It goes when the request ends, leaving a PictureLine.
//   request      the open request (pictures/pictureProtocol.js openRequest)
//   onSend       (file) => Promise<string>: sends a photo, or says why it wasn't sent
//   onCamera     (on) => Promise<string>: switches the camera, or says why it didn't start
//   cameraOn     whether the camera is on
//   attachCamera (videoElement) shows the camera in the card
//   simulated    a simulation in the browser: nothing leaves it

// what the screen may say about pictures: the facts the server guarantees (MEDIA_PROTOCOL section 4)
// only what MEDIA_PROTOCOL section 4 guarantees: memory only, never saved or logged, gone at the end or sooner
export const PRIVACY_LINE = 'Kept only in this call’s memory, never saved or logged, and forgotten when the call ends or sooner.';
const SIMULATED_LINE = 'A simulation: the photo stays in your browser and nothing is sent anywhere.';

const RING = 2 * Math.PI * 19;
function Countdown({ request, icon }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!request.timeoutS) return undefined;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [request.timeoutS, request.id]);
  const left = secondsLeft(request, now);
  const share = left === null ? 1 : left / request.timeoutS;
  return (
    <>
      <span className="pcClock" aria-hidden="true">
        <svg viewBox="0 0 44 44" width="44" height="44">
          <circle cx="22" cy="22" r="19" className="pcRingTrack" />
          {left !== null && (
            <circle cx="22" cy="22" r="19" className="pcRing" strokeDasharray={RING.toFixed(1)} strokeDashoffset={((1 - share) * RING).toFixed(1)} />
          )}
        </svg>
        <span className="pcGlyph">
          <Icon name={icon} size={16} />
        </span>
      </span>
      {left !== null && (
        <span className={`pcLeft ${left <= 15 ? 'low' : ''}`} title="How long the agent will still wait">
          <span className="srOnly">Time left: </span>
          {clockText(left)}
        </span>
      )}
    </>
  );
}

function Foot({ simulated }) {
  return (
    <p className="pcFoot">
      <Icon name="lock" size={13} />
      <span>{simulated ? SIMULATED_LINE : PRIVACY_LINE}</span>
    </p>
  );
}

function Thumb({ sent, blur = false, checking = false }) {
  return (
    <span className={`pcThumb ${blur ? 'dim' : ''}`} aria-hidden="true">
      {sent?.thumb ? <img src={sent.thumb} alt="" /> : <Icon name="image" size={18} />}
      {checking && <span className="pcSheen" />}
    </span>
  );
}

function UploadBody({ request, onSend, simulated }) {
  const fileRef = useRef(null);
  const [note, setNote] = useState('');
  const [over, setOver] = useState(false);
  const [taking, setTaking] = useState(false);
  const busy = request.phase === 'sending' || request.phase === 'sent';
  const types = acceptWords(request.accept);
  const send = async (file) => {
    if (!file) return;
    setNote('');
    setNote((await onSend(file)) || '');
  };
  const choose = () => fileRef.current?.click();
  const drop = {
    onDragOver: (event) => {
      event.preventDefault();
      if (!busy) setOver(true);
    },
    onDragLeave: () => setOver(false),
    onDrop: (event) => {
      event.preventDefault();
      setOver(false);
      if (!busy) send(event.dataTransfer?.files?.[0]);
    },
  };
  const picker = (
    <input
      ref={fileRef}
      type="file"
      hidden
      accept={(request.accept.length ? request.accept : ['image/*']).join(',')}
      aria-label="Choose a photo to send"
      onChange={(event) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        send(file);
      }}
    />
  );
  return (
    <>
      {request.sent && (
        <div className="pcChosen">
          <Thumb sent={request.sent} checking={busy} blur={!!request.rejection} />
          <span>
            <b>{request.sent.name}</b>
            <small>
              {request.phase === 'sending'
                ? 'Sending…'
                : request.phase === 'sent'
                  ? `Sent${request.sent.size ? ` · ${formatBytes(request.sent.size)}` : ''}. The agent is checking it…`
                  : 'Not used'}
            </small>
          </span>
        </div>
      )}
      {(request.rejection || note) && (
        <p className="pcVerdict" role="alert">
          <Icon name="alert" size={15} />
          <span>{note || request.rejection.message}</span>
        </p>
      )}
      {!busy && (
        <div className={`pcDrop ${request.sent || note ? 'again' : ''} ${over ? 'over' : ''}`} {...drop}>
          {!request.sent && !note && <span className="pcCardArt" aria-hidden="true" />}
          <Button type="button" variant="primary" size="compact" onClick={choose}>
            <Icon name="upload" size={15} />
            {request.sent || note ? 'Choose another photo' : simulated ? 'Choose a photo to try' : 'Choose a photo'}
          </Button>
          <Button type="button" size="compact" onClick={() => setTaking(true)}>
            <Icon name="camera" size={15} />
            Take a picture
          </Button>
          {!request.sent && !note && <small className="pcOr">or drop a photo here</small>}
          {(types.length > 0 || request.maxBytes > 0) && (
            <span className="pcTypes" aria-label="What it takes">
              {types.map((t) => (
                <span key={t}>{t}</span>
              ))}
              {request.maxBytes > 0 && <span>up to {formatBytes(request.maxBytes)}</span>}
            </span>
          )}
          {picker}
        </div>
      )}
      {taking &&
        createPortal(
          <TakePictureStage
            request={request}
            onSend={onSend}
            onClose={() => setTaking(false)}
            timer={<Countdown request={request} icon="image" />}
            privacy={simulated ? SIMULATED_LINE : PRIVACY_LINE}
          />,
          document.body,
        )}
    </>
  );
}

function CameraBody({ request, onCamera, cameraOn, attachCamera, simulated }) {
  const videoRef = useRef(null);
  const [note, setNote] = useState('');
  const [starting, setStarting] = useState(false);
  // 'ready': the private preview and the countdown before the camera is shared with the agent
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (cameraOn && videoRef.current) attachCamera?.(videoRef.current);
  }, [cameraOn, attachCamera]);
  const turn = useCallback(
    async (on) => {
      setNote('');
      setStarting(on);
      const problem = await onCamera(on);
      setStarting(false);
      setNote(problem || '');
    },
    [onCamera],
  );
  // the countdown ended (or Share now): the preview closes and the camera is shared
  const share = useCallback(() => {
    setReady(false);
    turn(true);
  }, [turn]);
  const timer = <Countdown request={request} icon="camera" />;
  const privacy = simulated ? SIMULATED_LINE : PRIVACY_LINE;
  if (!cameraOn)
    return (
      <>
        <div className="pcCamOff">
          <Icon name="camera" size={28} />
          <Button type="button" variant="primary" size="compact" onClick={() => setReady(true)} disabled={starting || ready}>
            {starting ? 'Turning on…' : 'Turn on camera'}
          </Button>
          <small>
            {simulated
              ? 'Your browser asks first. You get a few seconds to get ready. The picture stays in your browser.'
              : 'Your browser asks first. You get a few seconds to get ready, then the agent takes the picture itself.'}
          </small>
        </div>
        {(note || request.rejection) && (
          <p className="pcVerdict" role="alert">
            <Icon name="alert" size={15} />
            <span>{note || request.rejection.message}</span>
          </p>
        )}
        {ready &&
          createPortal(<GetReadyStage request={request} onGo={share} onCancel={() => setReady(false)} timer={timer} privacy={privacy} />, document.body)}
      </>
    );
  // the camera is shared: the large view stays open while the agent takes its frames
  return (
    <>
      <p className="pcStageNote">
        <Icon name="camera" size={15} />
        Camera on: shown in the large view
      </p>
      {createPortal(<SharedStage request={request} videoRef={videoRef} note={note} onOff={() => turn(false)} timer={timer} privacy={privacy} />, document.body)}
    </>
  );
}

export default function PictureRequest({ request, onSend, onCamera, cameraOn = false, attachCamera, simulated = false }) {
  if (!request) return null;
  const camera = request.kind === 'camera';
  const title = camera ? 'The agent needs your camera' : 'The agent needs a photo';
  return (
    <section className={`pcCard ${camera ? 'camera' : 'upload'}`} aria-label={title} data-request={request.id}>
      <header className="pcHead">
        <Countdown request={request} icon={camera ? 'camera' : 'image'} />
        <span className="pcTitle">
          <b>{title}</b>
          <small>{camera ? 'It takes the picture from your camera itself' : 'From your device'}</small>
        </span>
      </header>
      {request.prompt && (
        <p className="pcPrompt">
          <Icon name="chat" size={15} />
          <span>{request.prompt}</span>
        </p>
      )}
      {camera ? (
        <CameraBody request={request} onCamera={onCamera} cameraOn={cameraOn} attachCamera={attachCamera} simulated={simulated} />
      ) : (
        <UploadBody request={request} onSend={onSend} simulated={simulated} />
      )}
      <Foot simulated={simulated} />
    </section>
  );
}

const LINE_WORDS = {
  received: { upload: ['Photo received', ''], camera: ['Picture taken from your camera', 'Camera switched off'] },
  sent: { upload: ['You sent a photo', ''], camera: ['You sent a photo', ''] },
  timeout: {
    upload: ['The agent stopped waiting', 'No photo came in time'],
    camera: ['The agent stopped waiting', 'No usable picture came in time. Camera switched off'],
  },
  cancelled: { upload: ['The photo request ended', 'The agent moved on'], camera: ['The camera request ended', 'The agent moved on. Camera switched off'] },
};

// The line a finished request leaves in the conversation: { kind, status, sent }.
export function PictureLine({ picture }) {
  const status = LINE_WORDS[picture?.status] ? picture.status : 'cancelled';
  const kind = picture?.kind === 'camera' ? 'camera' : 'upload';
  const [title, sub] = LINE_WORDS[status][kind];
  const good = status === 'received' || status === 'sent';
  const detail = sub || picture?.sent?.name || '';
  return (
    <div className={`pcLine ${good ? 'good' : 'grey'}`}>
      {kind === 'upload' && picture?.sent ? (
        <Thumb sent={picture.sent} />
      ) : (
        <span className="pcThumb" aria-hidden="true">
          <Icon name={kind === 'camera' ? 'camera' : 'image'} size={18} />
        </span>
      )}
      <span>
        <b>{title}</b>
        {detail && <small>{detail}</small>}
      </span>
      {good && (
        <span className="pcTick" aria-hidden="true">
          <Icon name="check" size={14} />
        </span>
      )}
    </div>
  );
}
