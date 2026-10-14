import { visibleReplyLines, stylistProse } from "@/lib/stylist-page";
import type { StylistMessage } from "@/lib/types";

/** The visible lines of a reply: plain ink, never a LOOK row or a bare occasion id on top. */
export function replyLines(text: string): string[] {
  const lines = visibleReplyLines(text);
  return lines.length ? lines : [stylistProse(text)];
}

/** Messages created in this session: at or after `since` (an ISO instant). */
export function sessionMessages(messages: readonly StylistMessage[], since: string): StylistMessage[] {
  return messages.filter((m) => m.createdAt >= since);
}

/**
 * The chat as it was said, in order: the user's own question as a bubble on the right, the
 * stylist's answer on the left. Pure markup, no store, no router.
 */
export function StylistThread({ messages }: { messages: readonly StylistMessage[] }) {
  if (!messages.length) return null;
  return (
    <ol data-stylist-thread className="mt-3 space-y-2 border-t border-hairline px-4 pt-3">
      {messages.map((m) =>
        m.role === "user" ? (
          <li key={m.id} data-stylist-user className="flex justify-end">
            <p className="max-w-[85%] bg-paper-deep px-3 py-2 text-sm text-ink">{m.text}</p>
          </li>
        ) : (
          <li key={m.id} data-stylist-reply className="flex justify-start">
            <div className="max-w-[85%] space-y-1">
              {replyLines(m.text).map((l, i) => (
                <p key={`${i}-${l}`} className="text-sm leading-relaxed text-ink">
                  {l}
                </p>
              ))}
            </div>
          </li>
        ),
      )}
    </ol>
  );
}
