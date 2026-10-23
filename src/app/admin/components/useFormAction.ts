'use client';

import { useState, useTransition, type FormEvent } from 'react';

/**
 * `useActionState` for this React version: runs a server action with the form's data and keeps
 * its returned state (e.g. a validation message). Redirects thrown by the action still navigate.
 */
export function useFormAction<State>(
  action: (state: State, formData: FormData) => Promise<State>,
  initialState: State
) {
  const [state, setState] = useState(initialState);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      setState(await action(state, formData));
    });
  }

  return { state, pending, onSubmit };
}
