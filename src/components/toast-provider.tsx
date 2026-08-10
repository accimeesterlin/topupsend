'use client';

import { Toaster, useToast } from '@topupsend/ui';

export function ToastProvider() {
  const { toasts } = useToast();

  return <Toaster toasts={toasts} />;
}
