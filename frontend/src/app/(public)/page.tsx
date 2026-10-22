import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ClipboardIcon, MicIcon, ChartIcon } from "@/components/ui/Icons";

const FEATURES = [
  {
    icon: <ClipboardIcon className="h-5 w-5" />,
    title: "Collect resumes & projects",
    text: "Ask your class for resumes, GitHub links and Claude session transcripts, with a deadline and live tracking.",
  },
  {
    icon: <MicIcon className="h-5 w-5" />,
    title: "AI viva on their own work",
    text: "You tell the AI how to interview and grade. It asks about each student's projects and probes shallow answers.",
  },
  {
    icon: <ChartIcon className="h-5 w-5" />,
    title: "Honest reports",
    text: "A per-student report in your format, plus class-wide summary statistics.",
  },
];

const STEPS = [
  { title: "Register", text: "Create an account with your school email and choose Student or Instructor." },
  { title: "Create or join a class", text: "Instructors create classes and share a code. Students join with that code." },
  { title: "Run the viva", text: "Collect submissions, set up the viva, and review each student's report." },
];

export default function LandingPage() {
  return (
    <>
      <section className="flex flex-col items-center py-24 text-center sm:py-32">
        <span className="rounded-full border border-border-strong bg-tint px-3 py-1 text-[11px] font-semibold tracking-[0.18em] text-muted uppercase">
          AI oral exams for your class
        </span>
        <h1 className="mt-6 max-w-3xl text-4xl font-semibold tracking-tight sm:text-6xl">
          Test real understanding, not memorised answers.
        </h1>
        <p className="mt-5 max-w-xl text-muted">
          An AI viva that asks every student about their own projects, grades them on your criteria and hands you an
          honest report.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button href="/register" className="px-6 py-2.5">
            Create an account
          </Button>
          <Button href="/login" variant="outline" className="px-6 py-2.5">
            Log in
          </Button>
        </div>
        <a href="#how-it-works" className="mt-4 text-xs text-subtle transition hover:text-text">
          How it works ↓
        </a>
      </section>

      <section id="features" className="scroll-mt-20">
        <div className="grid gap-4 md:grid-cols-3">
          {FEATURES.map((f) => (
            <Card key={f.title} className="rounded-2xl">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent-soft text-accent">{f.icon}</span>
              <h3 className="mt-4 font-semibold">{f.title}</h3>
              <p className="mt-1.5 text-sm text-muted">{f.text}</p>
            </Card>
          ))}
        </div>
      </section>

      <section id="how-it-works" className="scroll-mt-20 pt-24">
        <h2 className="text-2xl font-semibold tracking-tight">How it works</h2>
        <ol className="mt-6 grid gap-4 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className={`rounded-2xl p-5 ${i === 1 ? "featured" : "panel"}`}>
              <span className={`text-[11px] font-semibold tracking-[0.18em] uppercase ${i === 1 ? "text-white/70" : "text-accent"}`}>
                Step {i + 1}
              </span>
              <h3 className="mt-1 font-semibold">{s.title}</h3>
              <p className={`mt-1.5 text-sm ${i === 1 ? "text-white/80" : "text-muted"}`}>{s.text}</p>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
