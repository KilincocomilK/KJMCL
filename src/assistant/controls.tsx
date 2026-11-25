import { useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';

export function errorText(e: unknown) {
  return (e instanceof Error ? e.message : String(e)).replace(
    /^Error invoking remote method '[^']+': (?:Error: )?/,
    '',
  );
}
export function useAction() {
  const locked = useRef(false);
  const [busy, setBusy] = useState('');
  const [feedback, setFeedback] = useState({ text: '', error: false });
  async function act(name: string, work: () => Promise<void | string>) {
    if (locked.current) return false;
    locked.current = true;
    setBusy(name);
    setFeedback({ text: '', error: false });
    try {
      setFeedback({ text: (await work()) || '', error: false });
      return true;
    } catch (e) {
      setFeedback({ text: errorText(e), error: true });
      return false;
    } finally {
      locked.current = false;
      setBusy('');
    }
  }
  return { act, busy, feedback };
}
export function Feedback({ feedback }: Pick<ReturnType<typeof useAction>, 'feedback'>) {
  if (!feedback.text) return null;
  return (
    <p
      className={'ai-feedback' + (feedback.error ? ' failed' : '')}
      role={feedback.error ? 'alert' : 'status'}
    >
      {feedback.text}
    </p>
  );
}
export const Spinner = () => <LoaderCircle size={15} className="spin" aria-hidden="true" />;
