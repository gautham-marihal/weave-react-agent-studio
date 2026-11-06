import React, { useCallback, useEffect, useRef, useState } from 'react';
import Icon from '../../ui/Icon.jsx';
import FocusBox from '../../ui/FocusBox.jsx';
import Button from '../../ui/Button.tsx';

// The large camera view over the page (like a video call), so a face and a card both fit in one frame. Three uses:
//   GetReadyStage   before the camera is shared with the agent: a private preview and a short countdown, so the person
//                   can get their face and the card in view (the agent takes its frames as soon as the camera is shared)
//   SharedStage     the camera shared with the agent, while it takes its frames
//   TakePictureStage a private preview with a shutter: the person takes the picture, which is sent as a photo
// The preview is mirrored, as people expect to see themselves; a picture taken is not (writing on a card stays readable).

// A frame for all three: title, line, what is shown, the buttons. Escape runs onClose.
function Stage({ title, line, timer, children, note, privacy, actions, onClose, label }) {
  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  };
  return (
    <div className="pcStageScrim">
      <FocusBox
        className="pcStage"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onKeyDown={onKeyDown}
        initial={() => document.querySelector('.pcStage .pcStageMain')}
      >
        <header className="pcStageHead">
          <div>
            <strong>{title}</strong>
            {line && <span>{line}</span>}
          </div>
          {timer && <span className="pcStageTime">{timer}</span>}
        </header>
        <div className="pcView">{children}</div>
        {note && (
          <p className="pcVerdict" role="alert">
            <Icon name="alert" size={15} />
            <span>{note}</span>
          </p>
        )}
        <footer className="pcStageFoot">
          <small>
            <Icon name="lock" size={13} />
            {privacy}
          </small>
          <span className="pcStageActions">{actions}</span>
        </footer>
      </FocusBox>
    </div>
  );
}

// The camera in this browser only (not shared with anyone): a preview, and a picture taken from it.
function useLocalCamera() {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [problem, setProblem] = useState('');
  const [live, setLive] = useState(false);
  useEffect(() => {
    let gone = false;
    navigator.mediaDevices
      ?.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
      .then((stream) => {
        if (gone) return stream.getTracks().forEach((t) => t.stop());
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setLive(true);
      })
      .catch((err) =>
        setProblem(
          /denied|permission|notallowed/i.test(`${err.name} ${err.message}`)
            ? 'The browser was not allowed to use the camera. Allow it in the address bar, then try again.'
            : `The camera didn’t start: ${err.message}`,
        ),
      );
    return () => {
      gone = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);
  // a still from the preview, as a JPEG file (not mirrored)
  const capture = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return null;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((done) => canvas.toBlob(done, 'image/jpeg', 0.92));
    return blob ? new File([blob], `camera-picture-${Date.now()}.jpg`, { type: 'image/jpeg' }) : null;
  }, []);
  return { videoRef, problem, live, capture };
}

const PREVIEW_NOTE = 'Only you see this preview. Nothing is shared until';

// Before the camera is shared: a countdown while the person gets ready (or "Share now" to skip it).
export function GetReadyStage({ request, seconds = 5, onGo, onCancel, timer, privacy }) {
  const { videoRef, problem, live } = useLocalCamera();
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    if (!live) return undefined;
    if (left <= 0) {
      onGo();
      return undefined;
    }
    const id = window.setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => window.clearTimeout(id);
  }, [live, left, onGo]);
  return (
    <Stage
      label="Get ready for the camera"
      title="Get ready: your face and the card in view"
      line={request.prompt || 'Hold the card beside your face, close enough to read'}
      timer={timer}
      note={problem}
      privacy={`${PREVIEW_NOTE} the countdown ends. ${privacy}`}
      onClose={onCancel}
      actions={
        <>
          <Button type="button" size="compact" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" variant="primary" size="compact" className="pcStageMain" onClick={onGo} disabled={!live}>
            <Icon name="camera" size={15} />
            Share now
          </Button>
        </>
      }
    >
      <video ref={videoRef} autoPlay muted playsInline aria-label="Your camera preview" />
      {live && (
        <span className="pcReady" role="status">
          <span className="srOnly">The camera is shared with the agent in {seconds} seconds.</span>
          <b aria-hidden="true">{left}</b>
          <small aria-hidden="true">Sharing with the agent in {left}…</small>
        </span>
      )}
    </Stage>
  );
}

// The camera shared with the agent, which takes its frames itself.
export function SharedStage({ request, videoRef, note, onOff, timer, privacy }) {
  return (
    <Stage
      label="Your camera"
      title="The agent is looking"
      line={request.prompt || 'Your face and the card side by side'}
      timer={timer}
      note={note}
      privacy={privacy}
      onClose={onOff}
      actions={
        <Button type="button" size="compact" className="pcStageOff pcStageMain" onClick={onOff}>
          <Icon name="cameraOff" size={15} />
          Turn camera off
        </Button>
      }
    >
      <video ref={videoRef} autoPlay muted playsInline aria-label="Your camera" />
      <span className="pcLive">
        <i aria-hidden="true" />
        Camera on
      </span>
      {request.rejection && (
        <span className="pcToast" role="alert">
          {request.rejection.message}
        </span>
      )}
      <span className="pcTip">Hold still: your face and the card side by side, the card close enough to read</span>
    </Stage>
  );
}

// The person takes the picture: a preview and a shutter; the still is sent as the photo.
export function TakePictureStage({ request, onSend, onClose, timer, privacy }) {
  const { videoRef, problem, live, capture } = useLocalCamera();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const take = async () => {
    setBusy(true);
    setNote('');
    const file = await capture();
    if (!file) {
      setBusy(false);
      setNote('No picture came from the camera. Try again.');
      return;
    }
    const why = await onSend(file);
    setBusy(false);
    if (why) setNote(why);
    else onClose();
  };
  return (
    <Stage
      label="Take a picture"
      title="Take a picture"
      line={request.prompt || 'When everything is in view, press Take picture'}
      timer={timer}
      note={problem || note}
      privacy={`${PREVIEW_NOTE} you press Take picture. ${privacy}`}
      onClose={onClose}
      actions={
        <>
          <Button type="button" size="compact" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" variant="primary" size="compact" className="pcStageMain" onClick={take} disabled={!live || busy}>
            <Icon name="camera" size={15} />
            {busy ? 'Sending…' : 'Take picture'}
          </Button>
        </>
      }
    >
      <video ref={videoRef} autoPlay muted playsInline aria-label="Your camera preview" />
      {request.rejection && (
        <span className="pcToast" role="alert">
          {request.rejection.message}
        </span>
      )}
    </Stage>
  );
}
