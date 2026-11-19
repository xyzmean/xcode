import React, { useRef, useState } from 'react';
import { Box, Link, Text } from '../ink.js';
import { useKeybinding } from '../keybindings/useKeybinding.js';
import { loginWithOpenAIDeviceCode, loginWithOpenAIOAuth } from '../services/oauth/openai.js';
import { Select } from './CustomSelect/select.js';
import { Spinner } from './Spinner.js';
import TextInput from './TextInput.js';

type Props = {
  onDone(): void;
  startingMessage?: string;
};

type OAuthState =
  | { state: 'idle' }
  | { state: 'waiting_for_login'; url?: string; method: 'codex-browser' | 'chatgpt-token-sharing' }
  | { state: 'waiting_for_device_code'; verificationUri?: string; userCode?: string }
  | { state: 'apikey_help' }
  | { state: 'success' }
  | { state: 'error'; message: string };

export function ConsoleOAuthFlow({
  onDone,
  startingMessage,
}: Props): React.ReactNode {
  const [status, setStatus] = useState<OAuthState>({ state: 'idle' });
  const [callbackInput, setCallbackInput] = useState('');
  const [cursorOffset, setCursorOffset] = useState(0);
  const submitCallbackRef = useRef<((value: string) => void) | null>(null);

  useKeybinding(
    'confirm:yes',
    () => {
      if (status.state === 'success') {
        onDone();
      } else if (status.state === 'error' || status.state === 'apikey_help') {
        setStatus({ state: 'idle' });
      }
    },
    {
      context: 'Confirmation',
      isActive: status.state === 'success' || status.state === 'error' || status.state === 'apikey_help',
    },
  );

  const startOpenAILogin = (method: 'codex-browser' | 'chatgpt-token-sharing') => {
    setCallbackInput('');
    setCursorOffset(0);
    submitCallbackRef.current = null;
    setStatus({ state: 'waiting_for_login', method });
    void loginWithOpenAIOAuth({
      method,
      onUrl: url => {
        setStatus({ state: 'waiting_for_login', method, url });
      },
      onSubmitCallback: submit => {
        submitCallbackRef.current = submit;
      },
    })
      .then(() => {
        setStatus({ state: 'success' });
        onDone();
      })
      .catch(err => {
        setStatus({
          state: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      });
  };

  const startDeviceCodeLogin = () => {
    setStatus({ state: 'waiting_for_device_code' });
    void loginWithOpenAIDeviceCode({
      onCode: info => {
        setStatus({
          state: 'waiting_for_device_code',
          verificationUri: info.verificationUri,
          userCode: info.userCode,
        });
      },
    })
      .then(() => {
        setStatus({ state: 'success' });
        onDone();
      })
      .catch(err => {
        setStatus({
          state: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      });
  };

  if (status.state === 'idle') {
    const header =
      startingMessage ??
      'xcode uses your ChatGPT subscription (Plus, Pro, Team) or OPENAI_API_KEY.';
    return (
      <Box flexDirection="column" gap={1} marginTop={1}>
        <Text bold={true}>{header}</Text>
        <Text>Select login method:</Text>
        <Box>
          <Select
            options={[
              {
                label: (
                  <Text>
                    ChatGPT account with subscription ·{' '}
                    <Text dimColor={true}>Plus, Pro, Team (Browser OAuth)</Text>
                    {'\n'}
                  </Text>
                ),
                value: 'openai-browser',
              },
              {
                label: (
                  <Text>
                    ChatGPT device login ·{' '}
                    <Text dimColor={true}>Headless / SSH (Device code)</Text>
                    {'\n'}
                  </Text>
                ),
                value: 'openai-device',
              },
              {
                label: (
                  <Text>
                    OpenAI API key ·{' '}
                    <Text dimColor={true}>Use OPENAI_API_KEY environment variable</Text>
                    {'\n'}
                  </Text>
                ),
                value: 'apikey',
              },
            ]}
            onChange={(value: string) => {
              if (value === 'openai-browser') {
                startOpenAILogin('codex-browser');
              } else if (value === 'openai-device') {
                startDeviceCodeLogin();
              } else {
                setStatus({ state: 'apikey_help' });
              }
            }}
          />
        </Box>
      </Box>
    );
  }

  if (status.state === 'waiting_for_device_code') {
    return (
      <Box flexDirection="column" gap={1} marginTop={1}>
        <Box flexDirection="row" gap={1}>
          <Spinner />
          <Text>Waiting for ChatGPT device authorization…</Text>
        </Box>
        {status.userCode && status.verificationUri ? (
          <Box flexDirection="column" gap={1}>
            <Text>
              1. Open <Link url={status.verificationUri}>{status.verificationUri}</Link>
            </Text>
            <Text>
              2. Enter code: <Text bold={true} color="claude">{status.userCode}</Text>
            </Text>
          </Box>
        ) : (
          <Text dimColor={true}>Requesting device code…</Text>
        )}
      </Box>
    );
  }

  if (status.state === 'waiting_for_login') {
    return (
      <Box flexDirection="column" gap={1} marginTop={1}>
        <Box flexDirection="row" gap={1}>
          <Spinner />
          <Text>
            {status.method === 'codex-browser'
              ? 'Waiting for ChatGPT sign-in in browser…'
              : 'Waiting for ChatGPT device authorization…'}
          </Text>
        </Box>
        {status.url && (
          <Box flexDirection="column">
            <Text dimColor={true}>If the browser did not open, open this URL:</Text>
            <Link url={status.url}>{status.url}</Link>
          </Box>
        )}
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor={true}>
            Over SSH? Paste the callback URL from your browser and press Enter:
          </Text>
          <Box>
            <Text color="claude">{'> '}</Text>
            <TextInput
              value={callbackInput}
              onChange={setCallbackInput}
              onSubmit={value => {
                submitCallbackRef.current?.(value);
              }}
              placeholder="http://127.0.0.1:.../auth/callback?code=..."
              columns={76}
              cursorOffset={cursorOffset}
              onChangeCursorOffset={setCursorOffset}
            />
          </Box>
        </Box>
      </Box>
    );
  }

  if (status.state === 'apikey_help') {
    return (
      <Box flexDirection="column" gap={1} marginTop={1}>
        <Text bold={true}>Using OpenAI API key</Text>
        <Text>Set OPENAI_API_KEY in your environment, then restart xcode.</Text>
        <Text dimColor={true}>
          Press <Text bold={true}>Enter</Text> to go back to login options.
        </Text>
      </Box>
    );
  }

  if (status.state === 'error') {
    return (
      <Box flexDirection="column" gap={1} marginTop={1}>
        <Text color="error">Login failed: {status.message}</Text>
        <Text dimColor={true}>
          Press <Text bold={true}>Enter</Text> to try again.
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" gap={1} marginTop={1}>
      <Text color="success">Successfully signed in with ChatGPT.</Text>
    </Box>
  );
}
