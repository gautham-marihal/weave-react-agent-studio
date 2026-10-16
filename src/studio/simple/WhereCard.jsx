import React, { useState } from 'react';
import AddPicker from '../form/AddPicker.jsx';
import { Switch } from '../form/fields.jsx';
import { pickerFor } from '../form/pickerOptions.js';
import RecordingNoticeOffer from '../records/RecordingNoticeOffer.jsx';
import { addChannel, channelName, readSimple, setChannelEnabled, setRecordingNotice } from './simpleModel.js';

const list = (v) => (Array.isArray(v) ? v : []);
const WHAT = {
  sip_voice: 'Callers dial a number',
  web_voice: 'Visitors talk in the browser',
  web_chat: 'A chat box on a website',
  whatsapp: 'People message on WhatsApp',
  sms: 'People text the agent',
  email: 'People write by email',
};

// Where the agent can be reached: its channels, each switched on or off, and a way to add one. Adding a voice channel asks whether callers
// should be told they may be recorded. The finer settings of a channel (its greeting, what it can hear and say) are in its detailed settings.
export default function WhereCard({ config, set }) {
  const read = readSimple(config);
  const channels = list(config?.channels).filter((c) => c && typeof c === 'object');
  const [offer, setOffer] = useState(false);
  const transfers = list(config?.telephony?.transfers).length;
  const options = pickerFor('channels', { takenIds: channels.map((c) => c.id), botId: config?.meta?.id || '' });
  return (
    <div className="smFields">
      <div className="smField">
        <span>Channels</span>
        {channels.length === 0 ? (
          <p className="smNote">None yet. A channel is a way people reach the agent: a phone line, a chat box on your website.</p>
        ) : (
          <ul className="smChannels" aria-label="Channels">
            {channels.map((channel, index) => (
              <li key={channel.id || index} className={channel.enabled === false ? 'off' : ''}>
                <span className="smChannelName">
                  <strong>{channelName(channel.type)}</strong>
                  <small>{WHAT[channel.type] || channel.id}</small>
                </span>
                <Switch
                  checked={channel.enabled !== false}
                  label={`${channelName(channel.type)} ${channel.id || ''} is switched on`}
                  onChange={(on) => set(setChannelEnabled(config, index, on))}
                />
              </li>
            ))}
          </ul>
        )}
        <AddPicker
          what="a channel"
          options={options}
          onPick={(option, made) => {
            set(addChannel(config, made));
            if (['sip_voice', 'web_voice'].includes(option.type)) setOffer(true);
          }}
        />
        {offer && !read.recordingNotice && <RecordingNoticeOffer onAdd={(text) => set(setRecordingNotice(config, text))} onDone={() => setOffer(false)} />}
      </div>
      <div className="smField">
        <span>Phone transfers</span>
        <p className="smNote">
          {transfers === 0
            ? 'None set up. A transfer is where a caller is passed to a person or another number.'
            : `${transfers} transfer${transfers === 1 ? '' : 's'} set up.`}{' '}
          Set them up in the detailed settings.
        </p>
      </div>
    </div>
  );
}
