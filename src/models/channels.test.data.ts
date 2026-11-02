// Tests only: what a server answered to GET /channel-types, to feed the readers.
export const WEB_IN = ['audio', 'text', 'image', 'video'];
export const ANSWER = {
  types: [
    { type: 'sip_voice', label: 'Phone line (SIP)', runs_today: true, input: ['audio'], output: ['audio'], voice: true, can_have_keypad: true, can_show_forms: false, entry_fields: ['dnis', 'sip_trunk', 'dispatch_rule'], default_modalities: { input: ['audio'], output: ['audio'] }, note: 'Audio only.' },
    { type: 'web_voice', label: 'Web voice', runs_today: true, input: WEB_IN, output: ['audio', 'text'], voice: true, can_have_keypad: false, can_show_forms: true, entry_fields: ['widget_id', 'allowed_origins'], default_modalities: { input: ['audio'], output: ['audio'] } },
    { type: 'web_chat', label: 'Web chat', runs_today: true, input: WEB_IN, output: ['audio', 'text'], voice: true, can_have_keypad: false, can_show_forms: true, entry_fields: ['widget_id', 'allowed_origins'], default_modalities: { input: ['text'], output: ['text'] } },
    { type: 'whatsapp', label: 'WhatsApp', runs_today: false, input: ['text', 'image'], output: ['text'], voice: false, can_have_keypad: false, can_show_forms: false, entry_fields: ['phone_number_id'], default_modalities: { input: ['text'], output: ['text'] } },
    { type: 'sms', label: 'SMS', runs_today: false, input: ['text'], output: ['text'], voice: false, can_have_keypad: false, can_show_forms: false, entry_fields: [], default_modalities: { input: ['text'], output: ['text'] } },
    { type: 'email', label: 'Email', runs_today: false, input: ['text', 'image'], output: ['text'], voice: false, can_have_keypad: false, can_show_forms: false, entry_fields: [], default_modalities: { input: ['text'], output: ['text'] } },
    { type: 'custom', label: 'Custom', runs_today: true, input: WEB_IN, output: ['audio', 'text'], voice: true, can_have_keypad: true, can_show_forms: true, entry_fields: null, default_modalities: { input: ['text'], output: ['text'] } },
  ],
  note: 'x',
};
