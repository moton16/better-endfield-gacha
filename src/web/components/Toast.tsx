export function Toast({
  message,
  onClose,
}: {
  message: string | null;
  onClose: () => void;
}) {
  if (!message) return null;
  return (
    <div class="toast" role="status" aria-live="polite">
      <span>{message}</span>
      <button type="button" class="btn ghost" onClick={onClose} aria-label="关闭提示">
        ✕
      </button>
    </div>
  );
}
