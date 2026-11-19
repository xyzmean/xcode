import type { TextBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import * as React from 'react';
import { BLACK_CIRCLE } from '../../constants/figures.js';
import { Box, Text, type TextProps } from '../../ink.js';
import { extractTag } from '../../utils/messages.js';

type Props = {
  addMargin: boolean;
  param: TextBlockParam;
};

function getStatusColor(status: string | null): TextProps['color'] {
  switch (status) {
    case 'completed':
      return 'success';
    case 'failed':
      return 'error';
    case 'killed':
      return 'warning';
    default:
      return 'text';
  }
}

function parseMonitorNotification(
  text: string,
): { description: string; body: string } | null {
  const match = text.match(
    /<monitor-notification\b[^>]*description="([^"]*)"[^>]*>([\s\S]*?)<\/monitor-notification>/,
  );
  if (!match) return null;
  return {
    description: match[1] ?? 'monitor',
    body: (match[2] ?? '').trim(),
  };
}

export function UserAgentNotificationMessage({
  addMargin,
  param,
}: Props): React.ReactNode {
  const { text } = param;
  const monitor = parseMonitorNotification(text);
  if (monitor) {
    const isError =
      monitor.body.startsWith('[stderr]') ||
      monitor.body.startsWith('[WebSocket error]');
    return (
      <Box marginTop={addMargin ? 1 : 0}>
        <Text>
          <Text color={isError ? 'warning' : 'success'}>{BLACK_CIRCLE}</Text>{' '}
          <Text bold>{monitor.description}</Text>
          {monitor.body ? <Text dimColor>: {monitor.body}</Text> : null}
        </Text>
      </Box>
    );
  }

  const summary = extractTag(text, 'summary');
  if (!summary) {
    return null;
  }
  const status = extractTag(text, 'status');
  const color = getStatusColor(status);
  return (
    <Box marginTop={addMargin ? 1 : 0}>
      <Text>
        <Text color={color}>{BLACK_CIRCLE}</Text> {summary}
      </Text>
    </Box>
  );
}
