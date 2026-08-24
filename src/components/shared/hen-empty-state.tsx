"use client";

import { cn } from "@/lib/utils";

/** Noriza logo red — matches the brand mark, readable on both themes. */
const RED = "#EC1C24";

const stroke = {
  stroke: RED,
  strokeWidth: 2.4,
  fill: "none",
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/**
 * Empty-state block with the sleeping hen doodle: drawn in the logo's
 * single-weight red line, breathing slowly with floating z's. The SVG is
 * decorative — the title/subtitle carry the meaning.
 */
export function HenEmptyState({
  title,
  subtitle,
  className,
}: {
  title: string;
  subtitle: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-5 text-center", className)}>
      <svg viewBox="38 4 150 120" className="w-52 overflow-visible sm:w-60" aria-hidden="true">
        <g className="animate-hen-breathe">
          {/* tail plumes */}
          <path {...stroke} d="M62 78 Q42 68 48 46 Q52 34 64 40" />
          <path {...stroke} d="M66 72 Q54 62 58 48" />
          {/* loaf body */}
          <path {...stroke} d="M62 78 Q60 52 90 44 Q122 38 138 54 Q150 68 140 84 Q126 98 94 98 Q66 96 62 78 Z" />
          {/* head resting on chest */}
          <path {...stroke} d="M128 56 Q140 48 146 57 Q151 66 143 72 Q135 76 129 70" />
          {/* comb — solid red, like the logo */}
          <path fill={RED} d="M136 48 Q137 41 142 45 Q144 39 148 44 Q152 41 151 48 Q145 52 136 48 Z" />
          {/* beak */}
          <path fill={RED} d="M146 70 L153 75 L145 76 Z" />
          {/* closed eye */}
          <path {...stroke} d="M136 61 Q140 65 144 62" />
          {/* wing swirl */}
          <path {...stroke} d="M92 70 Q110 64 114 76 Q116 86 100 86 Q90 85 92 76" />
        </g>
        {/* straw nest */}
        <path {...stroke} d="M46 94 Q100 110 154 94 Q150 114 100 118 Q50 114 46 94 Z" />
        <path {...stroke} d="M56 98 Q70 90 78 100 M92 102 Q104 94 114 102 M126 100 Q136 92 144 98" />
        <path {...stroke} d="M52 108 Q100 120 148 108" />
        {/* floating z's */}
        <text className="animate-hen-zzz" x="152" y="44" fontSize="11" fontWeight="700" fill={RED}>
          z
        </text>
        <text
          className="animate-hen-zzz"
          style={{ animationDelay: "0.55s" }}
          x="162"
          y="30"
          fontSize="15"
          fontWeight="700"
          fill={RED}
        >
          z
        </text>
        <text
          className="animate-hen-zzz"
          style={{ animationDelay: "1.1s" }}
          x="174"
          y="16"
          fontSize="19"
          fontWeight="700"
          fill={RED}
        >
          z
        </text>
      </svg>
      <div className="flex flex-col gap-1">
        <p className="font-medium">{title}</p>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>
    </div>
  );
}
