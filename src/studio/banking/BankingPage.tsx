import Icon from '../../ui/Icon.jsx';
import Button from '../../ui/Button.tsx';
import { Section } from '../agent/PageShell.jsx';
import VoicePicker from '../agent/pickers/VoicePicker.jsx';
import { usesVoice } from '../setup/setupModel.js';
import GatewayToolsCard from './GatewayToolsCard.tsx';
import { BANKING_NAME_CONSTANT, BANKING_NAME_MAX, bankDisplayName, withBankingName } from './bankingProfile.ts';
import { usesGateway, type AgentConfig } from './gatewayConfig.ts';
import { panelClass } from './ui.tsx';
import '../setup/setup.css';

/**
 * Build → Banking: the bank this agent speaks for. Everything here is an ordinary edit of the draft (undo works, Save
 * keeps it, publishing versions it):
 *   - the bank's name (constants.banking_name), heard in the greeting and shown wherever the bank is named;
 *   - the agent's voice, with the same picker and setting as the Agent page (one voice, not a second one);
 *   - the banking gateway's tools, connection and session events (GatewayToolsCard).
 */
export default function BankingPage({ config, set, onTest }: { config: AgentConfig; set: (next: AgentConfig) => void; onTest: () => void }) {
  const rawName = config.constants?.[BANKING_NAME_CONSTANT];
  const name = typeof rawName === 'string' ? rawName : '';
  const banking = usesGateway(config);
  const speaks = Boolean(usesVoice(config));

  return (
    <>
      <Section
        action={null}
        title="Banking name"
        lead="The bank this agent speaks for. Callers hear it in the greeting, and it names the bank wherever the agent is tested."
      >
        <div className={`suFields ${panelClass}`}>
          <label className="suField">
            <span>Banking name</span>
            <small>
              For example “Acme Bank Business Banking”. Saved with the draft (Save, or Ctrl+S). The runtime can use it as{' '}
              <code>{'{{const.banking_name}}'}</code>.
            </small>
            <input
              className="stFInput"
              value={name}
              maxLength={BANKING_NAME_MAX}
              placeholder={bankDisplayName({ ...config, constants: { ...config.constants, [BANKING_NAME_CONSTANT]: '' } })}
              autoComplete="off"
              onChange={(event) => set(withBankingName(config, event.target.value))}
            />
          </label>
        </div>
      </Section>

      <Section
        action={null}
        title="Agent voice"
        lead="How the agent sounds to callers. This is the agent’s one voice: choosing it here changes it on the Agent page too, and real conversations speak with it."
      >
        <div className={panelClass}>
          {speaks ? (
            <>
              <VoicePicker config={config} set={set} />
              <p className="tw-mb-0 tw-mt-3 tw-text-xs tw-text-muted">
                Tests → Banking speaks through your browser, with its closest voice to this one (the same language and gender).
              </p>
            </>
          ) : (
            <p className="tw-m-0 tw-text-sm tw-text-ink-soft">
              It only types, so it needs no voice yet. Switch on talking or phone calls on the Channels page, and you choose its voice here.
            </p>
          )}
        </div>
      </Section>

      <Section
        action={null}
        title="Banking gateway"
        lead="Sign-in, balances, cheques, rates and appointments run in the bank’s gateway; these tools let the agent call it."
      >
        <GatewayToolsCard config={config} onChange={set} />
      </Section>

      <Section action={null} title="Try it" lead="Talk to the banking assistant by chat or voice, sign in with a test login, and watch what the gateway does.">
        <div className={`tw-flex tw-flex-wrap tw-items-center tw-justify-between tw-gap-3 ${panelClass}`}>
          <p className="tw-m-0 tw-text-sm tw-text-ink-soft">
            {banking ? `Opens Tests → Banking for ${bankDisplayName(config)}.` : 'Add the banking gateway’s tools above first.'}
          </p>
          <Button type="button" variant="primary" size="compact" onClick={onTest} disabled={!banking}>
            <Icon name="test" size={14} />
            Test Banking
          </Button>
        </div>
      </Section>
    </>
  );
}
