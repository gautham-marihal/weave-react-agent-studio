// A stand-in for livekit-client, served in place of the real module in the browser. The Test tab's own session code runs for
// real; nothing leaves the browser. It "joins", the agent greets, and a typed message is answered with "You said: …".
export const RoomEvent = { DataReceived: 'dataReceived', ParticipantConnected: 'participantConnected', ParticipantDisconnected: 'participantDisconnected', Reconnecting: 'reconnecting', Reconnected: 'reconnected', MediaDevicesError: 'mediaDevicesError', Disconnected: 'disconnected', TrackSubscribed: 'trackSubscribed', TrackUnsubscribed: 'trackUnsubscribed', LocalTrackPublished: 'localTrackPublished', LocalTrackUnpublished: 'localTrackUnpublished' };
export const Track = { Kind: { Audio: 'audio', Video: 'video' }, Source: { Camera: 'camera' } };
window.__fake = window.__fake || { sent: [], rooms: [], connect: null };
function reader(text, id) { return { info: { id, attributes: {} }, async *[Symbol.asyncIterator]() { for (const part of text.split('|')) { await new Promise((r) => setTimeout(r, 30)); yield part; } } }; }
export class Room {
  constructor() { this.h = {}; this.streams = {}; this.localParticipant = this._lp(); window.__fake.rooms.push(this); }
  on(ev, fn) { (this.h[ev] ||= []).push(fn); return this; }
  removeAllListeners() { this.h = {}; }
  emit(ev, ...a) { (this.h[ev] || []).forEach((fn) => fn(...a)); }
  registerTextStreamHandler(topic, fn) { this.streams[topic] = fn; }
  async connect(url, token) {
    window.__fake.connect = { url, hasToken: !!token };
    await new Promise((r) => setTimeout(r, 40));
    setTimeout(() => { this.emit('participantConnected', { identity: 'agent-1' }); this.say('Hello |there!', 'g1'); }, 150);
  }
  async disconnect() { window.__fake.disconnected = (window.__fake.disconnected || 0) + 1; }
  async startAudio() {}
  say(text, id) { this.streams['lk.transcription'](reader(text, id), { identity: 'agent-1' }); }
  _lp() {
    const room = this;
    return {
      identity: 'tester-1',
      async sendText(text, opts) { window.__fake.sent.push({ kind: 'text', text, topic: opts && opts.topic }); setTimeout(() => room.say('You said: ' + text, 'r' + Math.random()), 80); return {}; },
      async publishData() {}, async sendFile() {}, async setMicrophoneEnabled() {}, async setCameraEnabled() {}, async setScreenShareEnabled() {}, getTrackPublication() { return null; },
    };
  }
}
