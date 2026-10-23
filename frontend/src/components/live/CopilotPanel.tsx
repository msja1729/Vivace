"use client";

import { useState } from "react";
import type { CopilotState, CopilotTopic, Suggestion } from "@/types";
import type { LiveMessage } from "@/lib/live/room";
import { Button } from "@/components/ui/Button";
import { Section } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Display";
import { inputClass } from "@/components/ui/Field";
import { SparkleIcon } from "@/components/ui/Icons";

const LEVEL: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  strong: { label: "Strong", tone: "success" },
  partial: { label: "Partial", tone: "warning" },
  weak: { label: "Weak", tone: "danger" },
  not_demonstrated: { label: "Not shown", tone: "neutral" },
};

const MODE_LABEL: Record<Suggestion["kind"], string> = {
  opening: "Opening questions",
  follow_up: "Follow-ups on the last answer",
  different: "A different part of this topic",
};

/**
 * The Co-Pilot, topic by topic. The examiner picks a topic from the student's work; the AI suggests
 * questions (opening, follow-up on the last answer, or a different part); every question and answer on
 * the topic is weighed, and the AI says when it is confident enough to grade. Moving to another topic
 * grades the previous one.
 */
export function CopilotPanel({
  c,
  live,
  send,
  ask,
}: {
  c: CopilotState;
  live: boolean;
  send: (m: LiveMessage) => void;
  ask: (text: string) => void;
}) {
  const [question, setQuestion] = useState("");
  const current = c.topics.find((t) => t.id === c.current) ?? null;

  return (
    <Section
      title="Co-Pilot"
      description="Pick a topic from the student's work. Ask a suggested question or your own."
      actions={
        c.topics.length > 0 && (
          <Button size="sm" variant="ghost" disabled={!!c.busy} onClick={() => send({ type: "topics_refresh" })}>
            <SparkleIcon className="h-3.5 w-3.5" /> Re-read work
          </Button>
        )
      }
    >
      {c.error && <p className="mb-3 text-xs text-warning">{c.error}</p>}
      {c.notice && (
        <div role="status" className="mb-3 rounded-xl border border-success/30 bg-success/10 p-3 text-sm text-success">
          {c.notice}
        </div>
      )}

      {/* 1. Topics */}
      {c.topics.length === 0 ? (
        <p className="text-sm text-muted">{c.busy === "topics" ? "Reading the student's work…" : "No topics yet."}</p>
      ) : (
        <ul className="space-y-1.5">
          {c.topics.map((t) => (
            <TopicRow key={t.id} t={t} onPick={() => send({ type: "topic", id: t.id })} disabled={!!c.busy} />
          ))}
        </ul>
      )}

      {/* 2. Questions on the current topic */}
      {current && (
        <div className="mt-5 space-y-3 border-t border-border pt-4">
          <div>
            <p className="text-[11px] font-semibold tracking-[0.16em] text-subtle uppercase">Now on</p>
            <p className="font-medium">{current.name}</p>
            {current.assessment && !current.grade && (
              <p className="mt-0.5 text-xs text-muted">
                So far: {LEVEL[current.assessment.level]?.label ?? current.assessment.level}, {current.assessment.score}/10
                {current.assessment.missing && !current.ready ? ` · still to check: ${current.assessment.missing}` : ""}
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button
              size="sm"
              variant={c.mode === "follow_up" ? "primary" : "outline"}
              disabled={!!c.busy || current.asked === 0}
              onClick={() => send({ type: "suggest", mode: "follow_up" })}
              title={current.asked === 0 ? "Available once the student has answered" : "Probe the last answer"}
            >
              Follow-up
            </Button>
            <Button
              size="sm"
              variant={c.mode === "different" ? "primary" : "outline"}
              disabled={!!c.busy}
              onClick={() => send({ type: "suggest", mode: "different" })}
            >
              Different question
            </Button>
          </div>
          {c.busy === "questions" ? (
            <p className="text-sm text-muted">Thinking…</p>
          ) : (
            c.suggestions.length > 0 && (
              <div className="space-y-2">
                {c.mode && <p className="text-xs text-subtle">{MODE_LABEL[c.mode]}</p>}
                {c.suggestions.map((q, i) => (
                  <div key={i} className="rounded-xl border border-border bg-tint p-3">
                    <p className="text-sm">{q.question}</p>
                    <p className="mt-1 text-xs text-muted">
                      {q.why}
                      {q.criterion && <span className="text-subtle"> · {q.criterion}</span>}
                    </p>
                    <Button size="sm" variant="outline" className="mt-2" disabled={!live} onClick={() => ask(q.question)}>
                      Show to student
                    </Button>
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      )}

      {/* 3. Your own question */}
      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          ask(question);
          setQuestion("");
        }}
      >
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Type your own question"
          aria-label="Your own question"
          className={inputClass}
          disabled={!live}
        />
        <Button type="submit" size="sm" variant="outline" disabled={!live || !question.trim()}>
          Show
        </Button>
      </form>
      <p className="mt-2 text-xs text-subtle">
        Ask out loud as usual; &quot;Show&quot; also puts the question on the student&apos;s screen. Answers count towards the
        topic you&apos;re on.
      </p>
    </Section>
  );
}

function TopicRow({ t, onPick, disabled }: { t: CopilotTopic; onPick: () => void; disabled: boolean }) {
  const level = t.grade ? LEVEL[t.grade.level] : null;
  return (
    <li>
      <button
        type="button"
        onClick={onPick}
        disabled={disabled || t.status === "current"}
        className={`w-full rounded-xl border px-3 py-2 text-left transition disabled:cursor-default ${
          t.status === "current" ? "border-accent bg-accent-soft" : "border-border bg-tint hover:bg-raised"
        }`}
      >
        <span className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate text-sm font-medium">{t.name}</span>
          {t.grade && level ? (
            <Badge tone={level.tone}>
              {level.label} {t.grade.score}/10{t.grade.limited ? " · limited" : ""}
            </Badge>
          ) : t.ready ? (
            <Badge tone="success">Ready to grade</Badge>
          ) : t.status === "current" ? (
            <Badge tone="accent">Now</Badge>
          ) : t.asked > 0 ? (
            <Badge>{t.asked} asked</Badge>
          ) : null}
        </span>
        <span className="mt-0.5 block truncate text-xs text-muted">
          <span className="capitalize">{t.kind}</span> · {t.summary}
        </span>
      </button>
    </li>
  );
}
