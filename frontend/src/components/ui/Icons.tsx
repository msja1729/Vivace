// Small inline icons (no icon library needed).

type IconProps = { className?: string };
const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;

const icon = (paths: React.ReactNode, defaultClass = "h-4 w-4") =>
  function Icon({ className = defaultClass }: IconProps) {
    return (
      <svg viewBox="0 0 24 24" className={className} {...stroke} aria-hidden>
        {paths}
      </svg>
    );
  };

export const PlusIcon = icon(<path d="M12 5v14M5 12h14" />);
export const DoorIcon = icon(<path d="M14 3H6v18h8M14 3l5 2v14l-5 2V3zM11 12h.01" />);
export const TargetIcon = icon(
  <>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="5" />
    <circle cx="12" cy="12" r="1" />
  </>,
);
export const HomeIcon = icon(<path d="M3 11l9-7 9 7M5 10v10h5v-6h4v6h5V10" />);
export const GridIcon = icon(<path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />);
export const UsersIcon = icon(
  <>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20c.6-3.4 3.2-5.5 6.5-5.5s5.9 2.1 6.5 5.5M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14.8c1.9.7 3.2 2.5 3.5 5.2" />
  </>,
);
export const ClipboardIcon = icon(
  <>
    <rect x="5" y="4" width="14" height="17" rx="2" />
    <path d="M9 4V3h6v1M9 10h6M9 14h6M9 18h3" />
  </>,
);
export const MicIcon = icon(
  <>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </>,
);
export const FolderIcon = icon(<path d="M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6z" />);
export const FileIcon = icon(<path d="M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6" />);
export const LogoutIcon = icon(<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10" />);
export const ChevronLeftIcon = icon(<path d="M15 6l-6 6 6 6" />);
export const ChevronRightIcon = icon(<path d="M9 6l6 6-6 6" />);
export const UploadIcon = icon(<path d="M12 16V4M7 9l5-5 5 5M4 20h16" />);
export const DownloadIcon = icon(<path d="M12 4v12M7 11l5 5 5-5M4 20h16" />);
export const TrashIcon = icon(<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />);
export const CalendarIcon = icon(
  <>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </>,
);
export const CheckIcon = icon(<path d="M5 12.5l4.5 4.5L19 7.5" />, "h-3.5 w-3.5");
export const ChartIcon = icon(<path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />);
export const SlidersIcon = icon(<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4" />);
export const CopyIcon = icon(
  <>
    <rect x="8" y="8" width="12" height="12" rx="2" />
    <path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" />
  </>,
);
export const MenuIcon = icon(<path d="M4 7h16M4 12h16M4 17h16" />, "h-5 w-5");
export const XIcon = icon(<path d="M6 6l12 12M18 6L6 18" />);
export const LinkIcon = icon(<path d="M10 14a4 4 0 0 0 6 .5l3-3a4 4 0 0 0-5.7-5.7L12 7M14 10a4 4 0 0 0-6-.5l-3 3a4 4 0 0 0 5.7 5.7L12 17" />);
export const SearchIcon = icon(
  <>
    <circle cx="11" cy="11" r="6" />
    <path d="M20 20l-4.5-4.5" />
  </>,
);
export const ArrowDownIcon = icon(<path d="M12 5v14M6 13l6 6 6-6" />);
export const GraduationIcon = icon(
  <>
    <path d="M2 9l10-5 10 5-10 5L2 9z" />
    <path d="M6 11v5c0 1.5 3 3 6 3s6-1.5 6-3v-5M22 9v6" />
  </>,
  "h-7 w-7",
);
export const BoardIcon = icon(
  <>
    <rect x="3" y="4" width="18" height="12" rx="1.5" />
    <path d="M8 20l4-4 4 4M7 8h6M7 11h10" />
  </>,
  "h-7 w-7",
);
export const BriefcaseIcon = icon(
  <>
    <rect x="3" y="7" width="18" height="13" rx="2" />
    <path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18" />
  </>,
  "h-5 w-5",
);
export const BookIcon = icon(
  <>
    <path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5z" />
    <path d="M4 19a2 2 0 0 1 2-2h13M9 7h6" />
  </>,
  "h-5 w-5",
);

export const MicrosoftIcon = ({ className = "h-4 w-4" }: IconProps) => (
  <svg viewBox="0 0 23 23" className={className} aria-hidden>
    <path fill="#f35325" d="M1 1h10v10H1z" />
    <path fill="#81bc06" d="M12 1h10v10H12z" />
    <path fill="#05a6f0" d="M1 12h10v10H1z" />
    <path fill="#ffba08" d="M12 12h10v10H12z" />
  </svg>
);
export const VideoIcon = icon(<path d="M3 7a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7zM16 10l5-3v10l-5-3" />);
export const AlertIcon = icon(<path d="M12 4l9 16H3l9-16zM12 10v4M12 17h.01" />);
export const SparkleIcon = icon(<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16z" />);
export const PrinterIcon = icon(<path d="M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z" />);
export const PlayIcon = icon(<path d="M7 4l13 8-13 8V4z" />);
export const StopIcon = icon(<path d="M6 6h12v12H6z" />);
