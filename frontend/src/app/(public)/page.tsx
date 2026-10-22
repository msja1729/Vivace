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
  { title: "Register", text: "Sign in with your school Microsoft account and choose Student or Instructor." },
  { title: "Create or join a class", text: "Instructors create classes and share a code. Students join with that code." },
  { title: "Run the viva", text: "Collect submissions, set up the viva, and review each student's report." },
];

export default function LandingPage() {
  return (
    <>
      <section className="flex flex-col items-center py-24 text-center sm:py-32">
        <span className="rounded-full border border-border-strong bg-white/5 px-3 py-1 text-xs text-muted">
          AI oral exams for your class
        </span>
        <h1 className="mt-6 max-w-3xl text-4xl font-bold tracking-tight sm:text-6xl">
          Test real understanding, not memorised answers.
        </h1>
        <p className="mt-5 max-w-xl text-muted">
          An AI viva that asks every student about their own projects, grades them on your criteria and hands you an
          honest report.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button href="/register">Get started</Button>
          <Button href="/#how-it-works" variant="outline">
            How it works
          </Button>
        </div>
      </section>

      <section id="features" className="scroll-mt-20">
        <div className="grid gap-4 md:grid-cols-3">
          {FEATURES.map((f) => (
            <Card key={f.title}>
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent-soft text-accent">{f.icon}</span>
              <h3 className="mt-4 font-semibold">{f.title}</h3>
              <p className="mt-1.5 text-sm text-muted">{f.text}</p>
            </Card>
          ))}
        </div>
      </section>

      <section id="how-it-works" className="scroll-mt-20 pt-24">
        <h2 className="text-2xl font-bold tracking-tight">How it works</h2>
        <ol className="mt-6 grid gap-4 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="panel rounded-xl p-5">
              <span className="text-xs font-semibold text-accent">Step {i + 1}</span>
              <h3 className="mt-1 font-semibold">{s.title}</h3>
              <p className="mt-1.5 text-sm text-muted">{s.text}</p>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
