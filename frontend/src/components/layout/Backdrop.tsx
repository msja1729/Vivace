/**
 * The colour behind the glass: large blurred glows that drift slowly, plus a few glossy
 * spheres (as in UI.png). Fixed behind every page; purely decorative.
 */
export function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden print:hidden">
      {/* Glows: pastel in light mode, deeper in dark mode */}
      <div className="animate-drift absolute -top-[18%] -left-[12%] h-[70vh] w-[55vw] rounded-full bg-[#b9a2ff] opacity-70 blur-[110px] dark:bg-[#6d3df0] dark:opacity-45" />
      <div
        className="animate-drift absolute -top-[10%] -right-[14%] h-[65vh] w-[50vw] rounded-full bg-[#ffb3dc] opacity-80 blur-[110px] dark:bg-[#c42a8f] dark:opacity-35"
        style={{ animationDelay: "-7s" }}
      />
      <div
        className="animate-drift absolute -bottom-[22%] left-[8%] h-[60vh] w-[45vw] rounded-full bg-[#a9c4ff] opacity-70 blur-[120px] dark:bg-[#2f4fd8] dark:opacity-35"
        style={{ animationDelay: "-13s" }}
      />
      <div
        className="animate-drift absolute right-[4%] -bottom-[18%] h-[50vh] w-[38vw] rounded-full bg-[#ffc9a8] opacity-60 blur-[110px] dark:bg-[#8b2fd6] dark:opacity-40"
        style={{ animationDelay: "-4s" }}
      />
      <div className="absolute top-[38%] left-[38%] h-[40vh] w-[30vw] rounded-full bg-[#e3b8ff] opacity-50 blur-[120px] dark:bg-[#5a2bb8] dark:opacity-30" />

      {/* Glossy spheres */}
      <span className="orb animate-bob absolute top-[62%] left-[2.5%] h-12 w-12" />
      <span className="orb-pink orb animate-bob absolute top-[14%] right-[3%] h-7 w-7" style={{ animationDelay: "-3s" }} />
      <span className="orb animate-bob absolute right-[2%] bottom-[18%] h-14 w-14" style={{ animationDelay: "-5s" }} />
      <span className="orb-blue orb animate-bob absolute bottom-[6%] left-[24%] h-6 w-6" style={{ animationDelay: "-2s" }} />
      <span className="orb-pink orb animate-bob absolute top-[8%] left-[44%] h-4 w-4 opacity-80" style={{ animationDelay: "-6s" }} />
    </div>
  );
}
