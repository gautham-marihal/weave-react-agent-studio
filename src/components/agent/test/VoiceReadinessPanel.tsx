import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  CheckCircle2Icon,
  CircleAlertIcon,
  CircleDashedIcon,
  LoaderCircleIcon,
  MicIcon,
  RadioIcon,
  RefreshCwIcon,
  XCircleIcon,
} from 'lucide-react';
import { Button } from '../../ui/Button';
import { StatusChip } from '../../ui/StatusChip';
import { api } from '../../../api/client';
import type { AgentConfig } from '../../../types/studio';
import { MIC_NEEDS_SECURE_CONTEXT, micErrorMessage, modelStageCheck, sessionStartError, type ModelStage } from '../../../utils/testSession';

function cn(...classes: (string | boolean | undefined | null)[]) {
  return classes.filter(Boolean).join(' ');
}

type CheckStatus = 'idle' | 'pending' | 'pass' | 'fail' | 'warning';

interface ReadinessCheck {
  id: string;
  title: string;
  status: CheckStatus;
  detail: string;
  fix?: string;
}

interface VoiceReadinessPanelProps {
  botId: string;
  config: AgentConfig;
  onReadyChange?: (ready: boolean) => void;
}

type Result = Omit<ReadinessCheck, 'id' | 'title'>;

const STAGES: ModelStage[] = ['stt', 'tts', 'llm'];

// The first checks run on their own (reads, and the read-only POST /validate). Starting a session and asking for the
// microphone only happen when the person presses their button: one creates a session on the server, the other a
// browser prompt.
const initialChecks: ReadinessCheck[] = [
  { id: 'health', title: '1. API server reachable', status: 'pending', detail: 'Checking GET /health…' },
  { id: 'validation', title: '2. Bot draft valid', status: 'pending', detail: 'Validating configuration…' },
  { id: 'stt', title: '3. Speech-to-text provider', status: 'pending', detail: 'Checking provider, model and key…' },
  { id: 'tts', title: '4. Text-to-speech provider', status: 'pending', detail: 'Checking provider, model and key…' },
  { id: 'llm', title: '5. Language model provider', status: 'pending', detail: 'Checking provider, model and key…' },
  { id: 'channel', title: '6. Web voice channel enabled', status: 'pending', detail: 'Looking for an enabled web voice channel…' },
  { id: 'session', title: '7. LiveKit connection', status: 'idle', detail: 'Not run yet. Asks the server for a voice test session; nothing joins the room.' },
  { id: 'mic', title: '8. Microphone', status: 'idle', detail: 'Not run yet. Your browser will ask for microphone access.' },
];

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function VoiceReadinessPanel({ botId, config, onReadyChange }: VoiceReadinessPanelProps) {
  const [running, setRunning] = useState(false);
  const [checks, setChecks] = useState<ReadinessCheck[]>(initialChecks);
  const runRef = useRef(0);
  // Checked when the tab opens or on Re-check, not on every edit.
  const configRef = useRef(config);
  configRef.current = config;

  const update = useCallback((id: string, result: Result) => {
    setChecks((prev) => prev.map((c) => (c.id === id ? { ...c, ...result, fix: result.fix } : c)));
  }, []);

  const runAutomaticChecks = useCallback(async () => {
    const config = configRef.current;
    const run = (runRef.current += 1);
    const current = () => run === runRef.current;
    setRunning(true);
    setChecks((prev) => prev.map((c) => (c.id === 'session' || c.id === 'mic' ? c : { ...c, status: 'pending', fix: undefined })));
    const results: Record<string, Result> = {};

    const health = api
      .health()
      .then((h): Result => (h.ok ? { status: 'pass', detail: 'The API answers GET /health.' } : { status: 'fail', detail: 'The API answered, but says it is not healthy.', fix: 'Check the Agent Builder server.' }))
      .catch((e): Result => ({ status: 'fail', detail: messageOf(e), fix: 'Check that Studio can reach the Agent Builder API.' }));

    const validation = api
      .validate(config)
      .then((report): Result =>
        report.valid
          ? { status: 'pass', detail: 'The server’s checks found no errors.' }
          : {
              status: 'fail',
              detail: `${report.errors.length} ${report.errors.length === 1 ? 'error' : 'errors'}: ${report.errors.map((err) => err.message).join('; ')}`,
              fix: 'Fix the listed errors in Build.',
            }
      )
      .catch((e): Result => ({ status: 'warning', detail: `Could not validate: ${messageOf(e)}` }));

    const providers = api
      .providers()
      .then((answer) => Object.fromEntries(STAGES.map((stage) => [stage, modelStageCheck(stage, config.defaults?.models?.[stage], answer.providers) as Result])))
      .catch((e) => Object.fromEntries(STAGES.map((stage) => [stage, { status: 'warning', detail: `Could not read the server’s providers: ${messageOf(e)}` } as Result])));

    const voiceChannel = config.channels?.find((c) => c.type === 'web_voice' && c.enabled);
    results.channel = voiceChannel
      ? { status: 'pass', detail: `Web voice channel “${voiceChannel.id}” is enabled.` }
      : { status: 'fail', detail: 'The draft has no enabled web voice channel.', fix: 'Turn on web voice under Build → Where it is available.' };

    const [h, v, p] = await Promise.all([health, validation, providers]);
    if (!current()) return;
    Object.assign(results, { health: h, validation: v }, p);
    Object.entries(results).forEach(([id, r]) => update(id, r));
    setRunning(false);
  }, [update]);

  const testConnection = async () => {
    // The server picks a channel by its id ("web-voice"), not its type.
    const voiceChannel = configRef.current.channels?.find((c) => c.type === 'web_voice' && c.enabled);
    if (!voiceChannel) {
      update('session', { status: 'fail', detail: 'The draft has no enabled web voice channel to test.', fix: 'Turn on web voice under Build → Where it is available.' });
      return;
    }
    update('session', { status: 'pending', detail: 'Asking the server for a voice test session…' });
    try {
      const sess = await api.startSession(botId, { ref: 'draft', channel: voiceChannel.id });
      update(
        'session',
        sess?.token && sess.livekit_url
          ? { status: 'pass', detail: `The server issued a LiveKit token for room ${sess.room} on ${sess.livekit_url.replace(/^wss?:\/\//, '')}.` }
          : { status: 'warning', detail: 'The server answered without a LiveKit address or token.' }
      );
    } catch (e) {
      const { message, detail } = sessionStartError(e);
      update('session', { status: 'fail', detail: message, fix: detail });
    }
  };

  const testMicrophone = async () => {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      update('mic', { status: 'fail', detail: MIC_NEEDS_SECURE_CONTEXT });
      return;
    }
    update('mic', { status: 'pending', detail: 'Waiting for your browser’s microphone prompt…' });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const label = stream.getAudioTracks()[0]?.label;
      stream.getTracks().forEach((t) => t.stop());
      update('mic', { status: 'pass', detail: `Microphone access granted${label ? ` (${label})` : ''}.` });
    } catch (e) {
      update('mic', { status: 'fail', detail: micErrorMessage(e) });
    }
  };

  useEffect(() => {
    void runAutomaticChecks();
    return () => {
      runRef.current += 1;
    };
  }, [botId, runAutomaticChecks]);

  useEffect(() => {
    if (checks.some((c) => c.status === 'pending')) return;
    onReadyChange?.(checks.every((c) => c.status === 'pass' || c.status === 'warning' || c.status === 'idle'));
  }, [checks, onReadyChange]);

  const sessionCheck = checks.find((c) => c.id === 'session');
  const micCheck = checks.find((c) => c.id === 'mic');

  return (
    <div className="rounded-xl border border-line bg-surface p-5 shadow-panel">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
        <div className="flex items-center gap-2">
          <RadioIcon className="h-4 w-4 text-accent" />
          <h3 className="text-sm font-semibold text-ink">Voice Readiness Diagnostics</h3>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={testConnection} disabled={sessionCheck?.status === 'pending'}>
            <RadioIcon className="h-3.5 w-3.5" aria-hidden />
            Test connection
          </Button>
          <Button variant="secondary" size="sm" onClick={testMicrophone} disabled={micCheck?.status === 'pending'}>
            <MicIcon className="h-3.5 w-3.5" aria-hidden />
            Test microphone
          </Button>
          <Button variant="ghost" size="sm" onClick={runAutomaticChecks} disabled={running}>
            <RefreshCwIcon className={cn('h-3.5 w-3.5', running && 'animate-spin')} />
            Re-check
          </Button>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {checks.map((chk) => (
          <div key={chk.id} className="rounded-lg border border-line bg-canvas p-3 text-xs">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                {chk.status === 'pass' ? (
                  <CheckCircle2Icon className="h-4 w-4 text-green-500 shrink-0" />
                ) : chk.status === 'fail' ? (
                  <XCircleIcon className="h-4 w-4 text-red-500 shrink-0" />
                ) : chk.status === 'warning' ? (
                  <CircleAlertIcon className="h-4 w-4 text-amber-500 shrink-0" />
                ) : chk.status === 'idle' ? (
                  <CircleDashedIcon className="h-4 w-4 text-muted shrink-0" />
                ) : (
                  <LoaderCircleIcon className="h-4 w-4 animate-spin text-muted shrink-0" />
                )}
                <span className="font-medium text-ink">{chk.title}</span>
              </div>
              <StatusChip
                tone={
                  chk.status === 'pass'
                    ? 'success'
                    : chk.status === 'fail'
                    ? 'danger'
                    : chk.status === 'warning'
                    ? 'warning'
                    : 'neutral'
                }
              >
                {chk.status === 'idle' ? 'not run' : chk.status}
              </StatusChip>
            </div>
            <p className="mt-1 text-ink-soft ml-6 leading-relaxed">{chk.detail}</p>
            {chk.fix && (
              <p className="mt-1.5 text-accent ml-6 font-medium">
                {chk.status === 'fail' && chk.id === 'session' ? 'Detail: ' : 'Fix: '}
                {chk.fix}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
