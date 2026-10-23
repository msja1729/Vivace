"use client";

import { useEffect, useState } from "react";
import type { AiSettings } from "@/types";
import { checkAiSettings, getAiSettings, removeAiSettings, saveAiSettings } from "@/lib/api/auth";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge, Loading, PageHeader } from "@/components/ui/Display";
import { FormError, SelectField, TextField } from "@/components/ui/Field";

const PROVIDERS = [
  { value: "gemini", label: "Google Gemini", keyFrom: "aistudio.google.com", url: "https://aistudio.google.com/apikey" },
  { value: "claude", label: "Anthropic Claude", keyFrom: "console.anthropic.com", url: "https://console.anthropic.com/settings/keys" },
];

export default function SettingsPage() {
  return <RequireAuth role="instructor">{() => <Settings />}</RequireAuth>;
}

function Settings() {
  const [ai, setAi] = useState<AiSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getAiSettings().then(setAi, (e: Error) => setError(e.message));
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Account" title="Settings" />
      <FormError message={error} />
      {ai ? <AiKeyCard ai={ai} onChange={setAi} /> : !error && <Loading />}
    </div>
  );
}

/** The instructor's own AI for their vivas: Co-Pilot topics and questions, grading and reports. */
function AiKeyCard({ ai, onChange }: { ai: AiSettings; onChange: (a: AiSettings) => void }) {
  const [provider, setProvider] = useState(ai.provider ?? "gemini");
  const [model, setModel] = useState(ai.model ?? "");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState<"save" | "check" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const info = PROVIDERS.find((p) => p.value === provider) ?? PROVIDERS[0];
  const models = ai.models[provider] ?? [];
  const keyKept = !!ai.keyHint && ai.provider === provider;

  async function run(action: "save" | "check" | "remove") {
    setBusy(action);
    setError(null);
    setResult(null);
    try {
      if (action === "save") {
        const saved = await saveAiSettings({ provider, model, apiKey: key });
        onChange(saved);
        setModel(saved.model ?? "");
        setKey("");
        setResult(await checkAiSettings());
      } else if (action === "check") {
        setResult(await checkAiSettings());
      } else {
        onChange(await removeAiSettings());
        setKey("");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="space-y-5 rounded-3xl p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">AI for your vivas</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Your own API key runs the Co-Pilot (topics, suggested questions, topic grades), answer grading and the AI
            report in the vivas you conduct. The key is stored encrypted and never shown again.
          </p>
        </div>
        {ai.keyHint ? (
          <Badge tone="success">Using your key ({ai.keyHint})</Badge>
        ) : ai.serverDefault ? (
          <Badge tone="neutral">Using the server&apos;s shared key</Badge>
        ) : (
          <Badge tone="warning">No AI key yet</Badge>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="Provider"
          name="provider"
          value={provider}
          onChange={(e) => {
            setProvider(e.target.value as "gemini" | "claude");
            setModel("");
          }}
        >
          {PROVIDERS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </SelectField>
        <SelectField label="Model" name="model" value={model} onChange={(e) => setModel(e.target.value)}>
          <option value="">Recommended ({models[0] ?? "default"})</option>
          {models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </SelectField>
      </div>

      <TextField
        label="API key"
        name="apiKey"
        type="password"
        autoComplete="off"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        placeholder={keyKept ? `Saved (${ai.keyHint}): leave empty to keep it` : "Paste your API key"}
        hint={`Create one at ${info.keyFrom}.`}
      />
      <a href={info.url} target="_blank" rel="noreferrer" className="-mt-3 inline-block text-xs text-accent hover:underline">
        Get a {info.label} key ↗
      </a>

      <FormError message={error} />
      {result && (
        <p
          role="status"
          className={`rounded-xl border px-3 py-2 text-sm ${
            result.ok ? "border-success/30 bg-success/10 text-success" : "border-warning/30 bg-warning/10 text-warning"
          }`}
        >
          {result.message}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button variant="accent" disabled={!!busy || (!key.trim() && !keyKept)} onClick={() => run("save")}>
          {busy === "save" ? "Saving…" : "Save and check"}
        </Button>
        {ai.keyHint && (
          <>
            <Button variant="outline" disabled={!!busy} onClick={() => run("check")}>
              {busy === "check" ? "Checking…" : "Check key"}
            </Button>
            <Button variant="danger" disabled={!!busy} onClick={() => run("remove")}>
              Remove my key
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}
