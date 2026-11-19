import * as React from 'react';
import { Text } from '../../ink.js';
import { clearOpenAIOAuthTokens } from '../../services/oauth/openai.js';
import { gracefulShutdownSync } from '../../utils/gracefulShutdown.js';

export async function call(): Promise<React.ReactNode> {
  clearOpenAIOAuthTokens();
  setTimeout(() => {
    gracefulShutdownSync(0, 'logout');
  }, 200);
  return <Text>Stored ChatGPT credentials cleared.{process.env.OPENAI_API_KEY ? ' Unset OPENAI_API_KEY to stop signing in with the environment API key.' : ''}</Text>;
}
