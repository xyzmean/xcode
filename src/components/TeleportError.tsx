import React, { useCallback, useEffect, useState } from 'react';
import { checkIsGitClean, checkNeedsClaudeAiLogin } from 'src/utils/background/remote/preconditions.js';
import { gracefulShutdownSync } from 'src/utils/gracefulShutdown.js';
import { Text } from '../ink.js';
import { Dialog } from './design-system/Dialog.js';
import { TeleportStash } from './TeleportStash.js';

export type TeleportLocalErrorType = 'needsLogin' | 'needsGitStash';

const EMPTY_ERRORS_TO_IGNORE: ReadonlySet<TeleportLocalErrorType> = new Set();

export function TeleportError({
  onComplete,
  errorsToIgnore = EMPTY_ERRORS_TO_IGNORE
}: {
  onComplete: () => void;
  errorsToIgnore?: ReadonlySet<TeleportLocalErrorType>;
}): React.ReactNode {
  const [error, setError] = useState<TeleportLocalErrorType | null>(null);
  const checkErrors = useCallback(async () => {
    const errors = await getTeleportErrors();
    const nextError = [...errors].find(item => !errorsToIgnore.has(item));
    if (nextError) setError(nextError);
    else onComplete();
  }, [errorsToIgnore, onComplete]);
  useEffect(() => {
    void checkErrors();
  }, [checkErrors]);

  const exit = () => gracefulShutdownSync(error === 'needsLogin' ? 1 : 0);
  if (error === 'needsLogin') {
    return <Dialog title="Teleport unavailable" onCancel={exit}>
      <Text>Claude Code remote sessions are not supported in xCode. Press Esc to exit.</Text>
    </Dialog>;
  }
  if (error === 'needsGitStash') {
    return <TeleportStash onStashAndContinue={() => void checkErrors()} onCancel={exit} />;
  }
  return null;
}

export async function getTeleportErrors(): Promise<Set<TeleportLocalErrorType>> {
  const [needsLogin, isGitClean] = await Promise.all([checkNeedsClaudeAiLogin(), checkIsGitClean()]);
  const errors = new Set<TeleportLocalErrorType>();
  if (needsLogin) errors.add('needsLogin');
  if (!isGitClean) errors.add('needsGitStash');
  return errors;
}
