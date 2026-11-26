import { barWidth, pendingTone, TONE_VAR } from "../lib/bar.js";
import { Avatar } from "./Avatar.js";

export function PendingRow({ pending, max }: { pending: number; max: number }) {
  if (pending <= 0) return null;
  return (
    <div class="row">
      <Avatar name="?" rarity={0} />
      <div class="hit-col">
        <div class="barwrap">
          <div
            class="bar"
            style={{ width: `${barWidth(pending, max)}%`, background: TONE_VAR[pendingTone(pending, max)] }}
            role="img"
            aria-label={`当前已垫 ${pending} 抽`}
          >
            {pending}
            <small>抽</small>
          </div>
        </div>
      </div>
    </div>
  );
}
