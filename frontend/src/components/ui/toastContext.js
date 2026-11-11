import { createContext, useContext } from 'react';

export const ToastContext = createContext(null);

/**
 * const { toast, dismiss } = useToast();
 * toast({ kind: 'success' | 'neutral' | 'warning', message, action: { label, onClick } })
 * returns the toast's id; dismiss(id) removes it early.
 */
export function useToast() {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToast needs a ToastProvider above it');
  return value;
}
